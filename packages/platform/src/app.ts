import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';

export interface PlatformOptions {
  /** base URL of the @crypton/server security server to forward to */
  securityServer: string;
  logger?: boolean;
}

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

/**
 * The 전자서점 storefront. It serves the marketplace SPA and forwards catalog/commerce/
 * open calls to the security server, so the browser stays same-origin (no CORS) and the
 * security server URL is never hard-coded into the client.
 */
export async function buildPlatform(opts: PlatformOptions): Promise<FastifyInstance> {
  const securityServer = opts.securityServer.replace(/\/+$/, '');
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 32 * 1024 * 1024 });
  await app.register(fastifyStatic, { root: PUBLIC_DIR, prefix: '/' });

  async function forward(
    reply: FastifyReply,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<FastifyReply> {
    const res = await fetch(`${securityServer}${path}`, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return reply
      .code(res.status)
      .header('content-type', res.headers.get('content-type') ?? 'application/json')
      .send(text);
  }

  app.get('/api/config', async () => ({ securityServer }));
  app.get('/api/titles', (_req, reply) => forward(reply, 'GET', '/titles'));
  app.post('/api/titles', (req, reply) => forward(reply, 'POST', '/titles', req.body));
  app.post('/api/purchase', (req, reply) => forward(reply, 'POST', '/purchase', req.body));
  app.post('/api/download', (req, reply) => forward(reply, 'POST', '/download', req.body));
  app.post('/api/open', (req, reply) => forward(reply, 'POST', '/open', req.body));

  return app;
}
