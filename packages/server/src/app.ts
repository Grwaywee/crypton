import {
  DownloadRequestSchema,
  generateCek,
  LoginRequestSchema,
  OpenRequestSchema,
  PublishRequestSchema,
  PurchaseRequestSchema,
  RegisterRequestSchema,
  uniqueValue,
  uuidv7,
  type AccessTokenClaims,
  type AuthResponse,
  type AuthUser,
  type NotifyEvent,
  type Title,
} from '@crypton/core';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { TokenAuthority } from './authority';
import { Notifier } from './notify';
import { hashPassword, verifyPassword } from './passwords';
import { MemoryStore } from './store/memory';
import type { Store, TitleRecord, UserRecord } from './store/types';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessTokenClaims;
    user: AccessTokenClaims;
  }
}

export interface AppConfig {
  masterSecret: Buffer;
  tokenTtlSeconds: number;
  serverUrl: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  corsOrigins: string[];
}

export interface BuildAppOptions {
  config: AppConfig;
  store?: Store;
  notifier?: Notifier;
  logger?: boolean;
  /** rate limiting is on by default (secure default); tests pass false */
  rateLimit?: boolean;
}

function toTitle(t: TitleRecord): Title {
  return { doc: t.doc, title: t.title, priceCents: t.priceCents, ownerId: t.ownerId };
}

function toAuthUser(u: UserRecord): AuthUser {
  return { id: u.id, email: u.email, role: u.role, displayName: u.displayName };
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const cfg = opts.config;
  const store = opts.store ?? new MemoryStore();
  const notifier = opts.notifier ?? new Notifier();
  const authority = new TokenAuthority(store, {
    masterSecret: cfg.masterSecret,
    tokenTtlSeconds: cfg.tokenTtlSeconds,
    serverUrl: cfg.serverUrl,
  });

  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 32 * 1024 * 1024 });

  await app.register(fastifyHelmet);
  await app.register(fastifyCors, { origin: cfg.corsOrigins.length > 0 ? cfg.corsOrigins : false });
  if (opts.rateLimit !== false) {
    await app.register(fastifyRateLimit, { max: 100, timeWindow: '1 minute' });
  }
  await app.register(fastifyJwt, { secret: cfg.jwtSecret });
  await app.register(fastifyWebsocket);

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      await reply.code(401).send({ error: 'unauthorized' });
    }
  });

  function issueAuth(user: UserRecord): AuthResponse {
    const claims: AccessTokenClaims = { sub: user.id, email: user.email, role: user.role };
    return { token: app.jwt.sign(claims, { expiresIn: cfg.jwtExpiresIn }), user: toAuthUser(user) };
  }

  app.get('/healthz', async () => ({ ok: true }));

  // --- auth ---------------------------------------------------------------
  app.post(
    '/auth/register',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsed = RegisterRequestSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid-request' });
      const email = parsed.data.email.trim().toLowerCase();
      if (await store.getUserByEmail(email)) return reply.code(409).send({ error: 'email-taken' });
      const user: UserRecord = {
        id: uuidv7(),
        email,
        passwordHash: hashPassword(parsed.data.password),
        role: 'user',
        displayName: parsed.data.displayName,
        createdAt: Date.now(),
      };
      await store.putUser(user);
      return reply.code(201).send(issueAuth(user));
    },
  );

  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsed = LoginRequestSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid-request' });
      const user = await store.getUserByEmail(parsed.data.email);
      // verify even when the user is missing would be ideal to avoid enumeration; we keep
      // a single generic error either way.
      if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
        return reply.code(401).send({ error: 'invalid-credentials' });
      }
      return reply.send(issueAuth(user));
    },
  );

  // --- catalog (public read) ---------------------------------------------
  app.get('/titles', async () => (await store.listTitles()).map(toTitle));

  app.get('/titles/:doc', async (req, reply) => {
    const { doc } = req.params as { doc: string };
    const t = await store.getTitle(doc);
    if (!t) return reply.code(404).send({ error: 'not-found' });
    return toTitle(t);
  });

  // --- publish (authenticated; owner derived from the token) -------------
  app.post('/titles', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = PublishRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid-request', detail: parsed.error.issues });
    }
    const content = Buffer.from(parsed.data.contentBase64, 'base64');
    if (content.length === 0) return reply.code(400).send({ error: 'empty-content' });
    const doc = uniqueValue(content);
    const existing = await store.getTitle(doc);
    const record: TitleRecord = {
      doc,
      title: parsed.data.title,
      ownerId: req.user.sub, // identity from the verified token, never the body
      priceCents: parsed.data.priceCents,
      cek: existing?.cek ?? generateCek().toString('base64'),
      content: content.toString('base64'),
      createdAt: existing?.createdAt ?? Date.now(),
    };
    await store.putTitle(record);
    return reply.code(201).send(toTitle(record));
  });

  // --- commerce (authenticated) ------------------------------------------
  app.post('/purchase', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = PurchaseRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-request' });
    const title = await store.getTitle(parsed.data.doc);
    if (!title) return reply.code(404).send({ error: 'not-found' });
    // (a payment gateway charge would happen here — payment precedes any transfer)
    await store.putEntitlement({
      userId: req.user.sub,
      doc: parsed.data.doc,
      source: 'purchase',
      grantedAt: Date.now(),
    });
    return reply.code(201).send({ ok: true, userId: req.user.sub, doc: parsed.data.doc });
  });

  app.post('/download', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = DownloadRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-request' });
    const title = await store.getTitle(parsed.data.doc);
    if (!title) return reply.code(404).send({ error: 'not-found' });
    if (!(await store.hasEntitlement(req.user.sub, parsed.data.doc))) {
      return reply.code(402).send({ error: 'payment-required' }); // download is gated on purchase
    }
    const { container } = await authority.issueCopy(title, req.user.sub);
    return reply.send({ container });
  });

  // --- the heart: open → authenticate (by copy token) + rotate -----------
  // Note: /open is authenticated by the rotating *copy token*, not a user session —
  // that is what makes "share the file, the recipient opens it" transfer access.
  app.post('/open', async (req, reply) => {
    const parsed = OpenRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ viewStart: false, reason: 'invalid-request' });
    const result = await authority.open(parsed.data);
    if (result.viewStart) {
      const event: NotifyEvent = {
        type: 'opened',
        copyId: parsed.data.copyId,
        doc: result.token.doc,
        tid: result.token.tid,
        at: Date.now(),
      };
      notifier.publish(event);
    }
    return reply.send(result);
  });

  // --- audit (authenticated + ownership) ---------------------------------
  app.get('/audit/copy/:copyId', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { copyId } = req.params as { copyId: string };
    const copy = await store.getCopy(copyId);
    if (!copy) return reply.code(404).send({ error: 'not-found' });
    if (copy.userId !== req.user.sub && req.user.role !== 'admin') {
      return reply.code(403).send({ error: 'forbidden' });
    }
    return store.auditByCopy(copyId);
  });

  app.get('/audit/doc/:doc', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { doc } = req.params as { doc: string };
    const title = await store.getTitle(doc);
    if (!title) return reply.code(404).send({ error: 'not-found' });
    if (title.ownerId !== req.user.sub && req.user.role !== 'admin') {
      return reply.code(403).send({ error: 'forbidden' });
    }
    return store.auditByDoc(doc);
  });

  // --- notify (websocket): a displaced holder learns its token went stale -
  app.get('/notify', { websocket: true }, (socket, req) => {
    const copyId = (req.query as { copyId?: string }).copyId;
    if (!copyId) {
      socket.close();
      return;
    }
    const unsubscribe = notifier.subscribe(copyId, (e) => {
      try {
        socket.send(JSON.stringify(e));
      } catch {
        /* ignore writes to a closing socket */
      }
    });
    socket.on('close', unsubscribe);
    socket.on('error', unsubscribe);
  });

  return app;
}
