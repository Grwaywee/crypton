import {
  DownloadRequestSchema,
  generateCek,
  OpenRequestSchema,
  PublishRequestSchema,
  PurchaseRequestSchema,
  uniqueValue,
  type NotifyEvent,
  type Title,
} from '@crypton/core';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { TokenAuthority, type AuthorityConfig } from './authority';
import { Notifier } from './notify';
import { MemoryStore } from './store/memory';
import type { Store, TitleRecord } from './store/types';

export interface BuildAppOptions {
  config: AuthorityConfig;
  store?: Store;
  notifier?: Notifier;
  logger?: boolean;
}

function toTitle(t: TitleRecord): Title {
  return { doc: t.doc, title: t.title, priceCents: t.priceCents, ownerId: t.ownerId };
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const store = opts.store ?? new MemoryStore();
  const notifier = opts.notifier ?? new Notifier();
  const authority = new TokenAuthority(store, opts.config);

  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 32 * 1024 * 1024 });
  await app.register(fastifyWebsocket);

  app.get('/healthz', async () => ({ ok: true }));

  // --- catalog / 전자서점 -------------------------------------------------
  app.post('/titles', async (req, reply) => {
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
      ownerId: parsed.data.ownerId,
      priceCents: parsed.data.priceCents,
      // keep the CEK stable if identical content is re-published
      cek: existing?.cek ?? generateCek().toString('base64'),
      content: content.toString('base64'),
      createdAt: existing?.createdAt ?? Date.now(),
    };
    await store.putTitle(record);
    return reply.code(201).send(toTitle(record));
  });

  app.get('/titles', async () => (await store.listTitles()).map(toTitle));

  app.get('/titles/:doc', async (req, reply) => {
    const { doc } = req.params as { doc: string };
    const t = await store.getTitle(doc);
    if (!t) return reply.code(404).send({ error: 'not-found' });
    return toTitle(t);
  });

  // --- commerce -----------------------------------------------------------
  app.post('/purchase', async (req, reply) => {
    const parsed = PurchaseRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-request' });
    const title = await store.getTitle(parsed.data.doc);
    if (!title) return reply.code(404).send({ error: 'not-found' });
    // (a payment gateway charge would happen here — payment precedes any transfer)
    await store.putEntitlement({
      userId: parsed.data.userId,
      doc: parsed.data.doc,
      source: 'purchase',
      grantedAt: Date.now(),
    });
    return reply.code(201).send({ ok: true, userId: parsed.data.userId, doc: parsed.data.doc });
  });

  app.post('/download', async (req, reply) => {
    const parsed = DownloadRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-request' });
    const title = await store.getTitle(parsed.data.doc);
    if (!title) return reply.code(404).send({ error: 'not-found' });
    if (!(await store.hasEntitlement(parsed.data.userId, parsed.data.doc))) {
      return reply.code(402).send({ error: 'payment-required' }); // download is gated on purchase
    }
    const { container } = await authority.issueCopy(title, parsed.data.userId);
    return reply.send({ container });
  });

  // --- the heart: open → authenticate + rotate ---------------------------
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

  // --- audit --------------------------------------------------------------
  app.get('/audit/copy/:copyId', async (req) => {
    const { copyId } = req.params as { copyId: string };
    return store.auditByCopy(copyId);
  });
  app.get('/audit/doc/:doc', async (req) => {
    const { doc } = req.params as { doc: string };
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
