import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { buildApp } from '@crypton/server';
import { buildPlatform } from '@crypton/platform';

async function stack() {
  const security = await buildApp({
    config: { masterSecret: randomBytes(32), tokenTtlSeconds: 3600, serverUrl: 'http://sec' },
  });
  await security.listen({ port: 0, host: '127.0.0.1' });
  const { port } = security.server.address() as AddressInfo;
  const platform = await buildPlatform({ securityServer: `http://127.0.0.1:${port}` });
  return { security, platform };
}

function post(app: Awaited<ReturnType<typeof buildPlatform>>, url: string, body: unknown) {
  return app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json' }, payload: JSON.stringify(body) });
}

test('platform forwards publish + catalog and gates download on purchase', async (t) => {
  const { security, platform } = await stack();
  t.after(async () => {
    await platform.close();
    await security.close();
  });

  const content = Buffer.from('hello platform', 'utf8');
  const pub = await post(platform, '/api/titles', {
    title: 'P',
    contentBase64: content.toString('base64'),
    priceCents: 500,
    ownerId: 'pub',
  });
  assert.equal(pub.statusCode, 201);
  const doc = pub.json().doc as string;

  const list = (await platform.inject({ method: 'GET', url: '/api/titles' })).json();
  assert.ok(list.some((x: { doc: string }) => x.doc === doc));

  // download is refused until a purchase exists (gate forwarded from the security server)
  const denied = await post(platform, '/api/download', { userId: 'alice', doc });
  assert.equal(denied.statusCode, 402);

  await post(platform, '/api/purchase', { userId: 'alice', doc });
  const ok = await post(platform, '/api/download', { userId: 'alice', doc });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().container.manifest.doc, doc);
});

test('platform serves the storefront SPA at /', async (t) => {
  const { security, platform } = await stack();
  t.after(async () => {
    await platform.close();
    await security.close();
  });
  const res = await platform.inject({ method: 'GET', url: '/' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /crypton/);
});
