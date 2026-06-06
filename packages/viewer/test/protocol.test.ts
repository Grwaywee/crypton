import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import type { CryptonContainer } from '@crypton/core';
import { buildApp } from '@crypton/server';
import { MemoryCekCache, ViewerClient } from '@crypton/viewer';

async function startServer() {
  const app = await buildApp({
    config: { masterSecret: randomBytes(32), tokenTtlSeconds: 3600, serverUrl: 'http://placeholder' },
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  return { app, base: `http://127.0.0.1:${port}` };
}

async function postJson(base: string, path: string, body: unknown): Promise<any> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function provision(base: string, text = 'classified payload'): Promise<CryptonContainer> {
  const content = Buffer.from(text, 'utf8');
  const { doc } = await postJson(base, '/titles', {
    title: 'Doc',
    contentBase64: content.toString('base64'),
    priceCents: 100,
    ownerId: 'pub',
  });
  await postJson(base, '/purchase', { userId: 'alice', doc });
  const { container } = await postJson(base, '/download', { userId: 'alice', doc });
  return container as CryptonContainer;
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

test('viewer opens online: renders content and rotates the embedded token', async (t) => {
  const { app, base } = await startServer();
  t.after(() => app.close());
  const container = await provision(base, 'classified payload');
  const t1 = container.manifest.token.tid;

  const client = new ViewerClient();
  const outcome = await client.open(container, { serverBase: base });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.title, 'Doc');
  assert.equal(outcome.content?.toString('utf8'), 'classified payload');
  assert.notEqual(outcome.container?.manifest.token.tid, t1); // rotated forward
});

test('a shared, already-rotated copy is denied (single-live-token)', async (t) => {
  const { app, base } = await startServer();
  t.after(() => app.close());
  const container = await provision(base);

  const client = new ViewerClient();
  const first = await client.open(container, { serverBase: base }); // rotates the live token
  assert.equal(first.ok, true);

  // Someone reopens the *original* container (its token is now stale).
  const stale = await client.open(container, { serverBase: base });
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'stale-token');
});

test('offline grace: a cached CEK renders within the window, then expires', async (t) => {
  const { app, base } = await startServer();
  t.after(() => app.close());
  const container = await provision(base, 'offline-readable');

  const cache = new MemoryCekCache();
  const online = new ViewerClient({ cache });
  const r1 = await online.open(container, { serverBase: base });
  assert.ok(r1.ok && r1.container);
  const rotated = r1.container;

  // Server unreachable (refused port) → falls back to offline grace using the cached CEK.
  const offline = new ViewerClient({ cache });
  const r2 = await offline.open(rotated, { serverBase: 'http://127.0.0.1:1' });
  assert.equal(r2.ok, true);
  assert.equal(r2.offline, true);
  assert.equal(r2.content?.toString('utf8'), 'offline-readable');

  // Past the token's validity, offline grace is refused.
  const expired = new ViewerClient({
    cache,
    now: () => (rotated.manifest.token.exp + 60) * 1000,
  });
  const r3 = expired.openOffline(rotated);
  assert.equal(r3.ok, false);
  assert.equal(r3.reason, 'offline-grace-expired');
});

test('a rotation notifies websocket subscribers of the copy', async (t) => {
  const { app, base } = await startServer();
  t.after(() => app.close());
  const container = await provision(base);
  const copyId = container.manifest.copyId;

  const ws = new WebSocket(`${base.replace('http', 'ws')}/notify?copyId=${copyId}`);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('ws failed to open'));
  });
  const nextEvent = new Promise<{ type: string; copyId: string; tid: string }>((resolve) => {
    ws.onmessage = (m) => resolve(JSON.parse(String(m.data)));
  });

  const outcome = await new ViewerClient().open(container, { serverBase: base });
  assert.ok(outcome.ok);

  const event = await Promise.race([nextEvent, timeout(2000)]);
  assert.equal(event.type, 'opened');
  assert.equal(event.copyId, copyId);
  assert.equal(event.tid, outcome.container?.manifest.token.tid);
  ws.close();
});
