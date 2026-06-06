import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';

export interface PlatformOptions {
  /** base URL of the @crypton/server security server to forward to */
  securityServer: string;
  logger?: boolean;
}

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

/**
 * The 전자서점 storefront. It serves the marketplace SPA and forwards auth/catalog/
 * commerce/open calls to the security server, so the browser stays same-origin (no CORS)
 * and the security server URL is never exposed to the client.
 */
export async function buildPlatform(opts: PlatformOptions): Promise<FastifyInstance> {
  const securityServer = opts.securityServer.replace(/\/+$/, '');
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 32 * 1024 * 1024 });

  // Security headers. The SPA loads only same-origin assets and uses WebCrypto, so a
  // tight default-src 'self' policy is sufficient.
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'connect-src': ["'self'"],
        'img-src': ["'self'", 'data:'],
      },
    },
  });
  await app.register(fastifyCors, { origin: false }); // same-origin only
  await app.register(fastifyStatic, { root: PUBLIC_DIR, prefix: '/' });

  async function forward(
    req: FastifyRequest,
    reply: FastifyReply,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<FastifyReply> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    // Pass the caller's bearer token straight through — the security server is the
    // single source of identity.
    if (typeof req.headers.authorization === 'string') {
      headers.authorization = req.headers.authorization;
    }
    const res = await fetch(`${securityServer}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return reply
      .code(res.status)
      .header('content-type', res.headers.get('content-type') ?? 'application/json')
      .send(text);
  }

  app.post('/api/auth/register', (req, reply) => forward(req, reply, 'POST', '/auth/register', req.body));
  app.post('/api/auth/login', (req, reply) => forward(req, reply, 'POST', '/auth/login', req.body));
  app.get('/api/titles', (req, reply) => forward(req, reply, 'GET', '/titles'));
  app.post('/api/titles', (req, reply) => forward(req, reply, 'POST', '/titles', req.body));
  app.post('/api/purchase', (req, reply) => forward(req, reply, 'POST', '/purchase', req.body));
  app.post('/api/download', (req, reply) => forward(req, reply, 'POST', '/download', req.body));
  app.post('/api/open', (req, reply) => forward(req, reply, 'POST', '/open', req.body));

  return app;
}
