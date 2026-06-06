import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { buildApp } from '@crypton/server';
import { buildPlatform } from '@crypton/platform';

async function stack() {
  const security = await buildApp({
    config: {
      masterSecret: randomBytes(32),
      tokenTtlSeconds: 3600,
      serverUrl: 'http://sec',
      jwtSecret: 'test-jwt-secret-test-jwt-secret-0123456789',
      jwtExpiresIn: '1h',
      corsOrigins: [],
    },
    rateLimit: false,
  });
  await security.listen({ port: 0, host: '127.0.0.1' });
  const { port } = security.server.address() as AddressInfo;
  const platform = await buildPlatform({ securityServer: `http://127.0.0.1:${port}` });
  return { security, platform };
}

function post(app: Awaited<ReturnType<typeof buildPlatform>>, url: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return app.inject({ method: 'POST', url, headers, payload: JSON.stringify(body) });
}

test('platform forwards auth + publish + catalog and gates download on purchase', async (t) => {
  const { security, platform } = await stack();
  t.after(async () => {
    await platform.close();
    await security.close();
  });

  // register through the platform forwarder
  const reg = await post(platform, '/api/auth/register', { email: 'pub@x.com', password: 'password123' });
  assert.equal(reg.statusCode, 201);
  const token = reg.json().token as string;

  const content = Buffer.from('hello platform', 'utf8');
  const pub = await post(platform, '/api/titles', {
    title: 'P',
    contentBase64: content.toString('base64'),
    priceCents: 500,
  }, token);
  assert.equal(pub.statusCode, 201);
  const doc = pub.json().doc as string;

  const list = (await platform.inject({ method: 'GET', url: '/api/titles' })).json();
  assert.ok(list.some((x: { doc: string }) => x.doc === doc));

  // publishing without a token is rejected by the security server (forwarded 401)
  const noAuth = await post(platform, '/api/titles', { title: 'X', contentBase64: content.toString('base64'), priceCents: 0 });
  assert.equal(noAuth.statusCode, 401);

  // download is refused until purchase
  assert.equal((await post(platform, '/api/download', { doc }, token)).statusCode, 402);
  await post(platform, '/api/purchase', { doc }, token);
  const ok = await post(platform, '/api/download', { doc }, token);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().container.manifest.doc, doc);
});

test('platform serves the storefront SPA with security headers', async (t) => {
  const { security, platform } = await stack();
  t.after(async () => {
    await platform.close();
    await security.close();
  });
  const res = await platform.inject({ method: 'GET', url: '/' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /crypton/);
  // helmet is active
  assert.ok(res.headers['content-security-policy']);
  assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
});
