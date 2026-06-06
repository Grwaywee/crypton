import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { decryptPayload, type CryptonContainer, type Token } from '@crypton/core';
import { buildApp, type AuthorityConfig } from '@crypton/server';
import type { FastifyInstance } from 'fastify';

function config(): AuthorityConfig {
  return { masterSecret: randomBytes(32), tokenTtlSeconds: 3600, serverUrl: 'http://test.local' };
}

function postJson(app: FastifyInstance, url: string, body: unknown) {
  return app.inject({
    method: 'POST',
    url,
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(body),
  });
}

async function freshApp() {
  return buildApp({ config: config() });
}

async function publishDoc(app: FastifyInstance, text = 'top-secret quarterly report', title = 'Q4') {
  const content = Buffer.from(text, 'utf8');
  const res = await postJson(app, '/titles', {
    title,
    contentBase64: content.toString('base64'),
    priceCents: 1999,
    ownerId: 'pub-1',
  });
  assert.equal(res.statusCode, 201);
  return { doc: res.json().doc as string, content };
}

async function purchaseAndDownload(app: FastifyInstance, doc: string, userId: string) {
  await postJson(app, '/purchase', { userId, doc });
  const res = await postJson(app, '/download', { userId, doc });
  assert.equal(res.statusCode, 200);
  return res.json().container as CryptonContainer;
}

function open(app: FastifyInstance, copyId: string, token: Token) {
  return postJson(app, '/open', { copyId, token });
}

test('catalog listing never leaks server-held secrets (cek / content)', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());
  const { doc } = await publishDoc(app);
  const list = (await app.inject({ method: 'GET', url: '/titles' })).json();
  const entry = list.find((x: { doc: string }) => x.doc === doc);
  assert.ok(entry);
  assert.equal('cek' in entry, false);
  assert.equal('content' in entry, false);
});

test('download is gated on purchase (payment precedes transfer)', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());
  const { doc } = await publishDoc(app);
  const denied = await postJson(app, '/download', { userId: 'eve', doc });
  assert.equal(denied.statusCode, 402);

  await postJson(app, '/purchase', { userId: 'eve', doc });
  const ok = await postJson(app, '/download', { userId: 'eve', doc });
  assert.equal(ok.statusCode, 200);
});

test('the issued container carries a token + copyId but never the CEK', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());
  const { doc } = await publishDoc(app);
  const container = await purchaseAndDownload(app, doc, 'alice');
  assert.equal(container.manifest.doc, doc);
  assert.ok(container.manifest.copyId);
  assert.ok(container.manifest.token.sig);
  assert.ok(container.ciphertext.length > 0);
  assert.equal(JSON.stringify(container).includes('"cek"'), false);
});

test('opening authenticates, rotates (T1 ≠ T2) and releases the CEK to decrypt', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());
  const { doc, content } = await publishDoc(app);
  const container = await purchaseAndDownload(app, doc, 'alice');
  const t1 = container.manifest.token;

  const res = (await open(app, container.manifest.copyId, t1)).json();
  assert.equal(res.viewStart, true);
  assert.notEqual(res.token.tid, t1.tid); // rotation: T1 ≠ T2
  assert.equal(res.token.doc, doc);

  const plain = decryptPayload(container, Buffer.from(res.cek, 'base64'));
  assert.deepEqual(plain, content); // the released CEK actually decrypts the payload
});

test('a stale (already-rotated) token is rejected on re-open', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());
  const { doc } = await publishDoc(app);
  const container = await purchaseAndDownload(app, doc, 'alice');
  const t1 = container.manifest.token;

  assert.equal((await open(app, container.manifest.copyId, t1)).json().viewStart, true);
  const reuse = (await open(app, container.manifest.copyId, t1)).json();
  assert.equal(reuse.viewStart, false);
  assert.equal(reuse.reason, 'stale-token');
});

test('redistribution transfers access instead of multiplying it (도4)', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());
  const { doc, content } = await publishDoc(app);
  const container = await purchaseAndDownload(app, doc, 'alice');
  const copyId = container.manifest.copyId;

  // Alice opens → her token rotates T1 → T2.
  const a1 = (await open(app, copyId, container.manifest.token)).json();
  assert.equal(a1.viewStart, true);
  const aliceToken: Token = a1.token; // T2 (Alice's file now embeds T2)

  // Alice shares the file; Bob receives the same container holding T2 and opens it.
  const b1 = (await open(app, copyId, aliceToken)).json();
  assert.equal(b1.viewStart, true);
  const bobToken: Token = b1.token; // T3 — Bob is now the live holder

  // Alice opens again with her now-stale T2 → access has moved to Bob.
  const a2 = (await open(app, copyId, aliceToken)).json();
  assert.equal(a2.viewStart, false);
  assert.equal(a2.reason, 'stale-token');

  // Bob (the live holder) still views, and the CEK decrypts the original content.
  const b2 = (await open(app, copyId, bobToken)).json();
  assert.equal(b2.viewStart, true);
  assert.deepEqual(decryptPayload(container, Buffer.from(b2.cek, 'base64')), content);
});

test('concurrent opens of one copy yield exactly one winner (single-live-token)', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());
  const { doc } = await publishDoc(app);
  const container = await purchaseAndDownload(app, doc, 'alice');
  const t1 = container.manifest.token;

  const racers = Array.from({ length: 12 }, () => open(app, container.manifest.copyId, t1));
  const bodies = (await Promise.all(racers)).map((r) => r.json());
  const winners = bodies.filter((b) => b.viewStart === true);
  assert.equal(winners.length, 1);
  assert.equal(bodies.filter((b) => b.viewStart === false).length, 11);
});

test('a forged token signature is rejected', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());
  const { doc } = await publishDoc(app);
  const container = await purchaseAndDownload(app, doc, 'alice');
  const forged: Token = { ...container.manifest.token, exp: container.manifest.token.exp + 99999 };
  const res = (await open(app, container.manifest.copyId, forged)).json();
  assert.equal(res.viewStart, false);
  assert.equal(res.reason, 'bad-signature');
});

test("one copy's live token cannot open a different copy of the same title", async (t) => {
  const app = await freshApp();
  t.after(() => app.close());
  const { doc } = await publishDoc(app);
  const a = await purchaseAndDownload(app, doc, 'alice');
  const b = await purchaseAndDownload(app, doc, 'bob');
  // Alice's valid live token presented against Bob's copyId.
  const res = (await open(app, b.manifest.copyId, a.manifest.token)).json();
  assert.equal(res.viewStart, false);
  assert.equal(res.reason, 'stale-token');
});

test('an unknown copy is rejected', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());
  const { doc } = await publishDoc(app);
  const container = await purchaseAndDownload(app, doc, 'alice');
  const res = (await open(app, 'no-such-copy', container.manifest.token)).json();
  assert.equal(res.viewStart, false);
  assert.equal(res.reason, 'unknown-copy');
});

test('the audit log records issue, rotate and deny events', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());
  const { doc } = await publishDoc(app);
  const container = await purchaseAndDownload(app, doc, 'alice');
  const copyId = container.manifest.copyId;
  await open(app, copyId, container.manifest.token); // rotate
  await open(app, copyId, container.manifest.token); // stale → deny

  const log = (await app.inject({ method: 'GET', url: `/audit/copy/${copyId}` })).json();
  const events = log.map((e: { event: string }) => e.event);
  assert.ok(events.includes('issue'));
  assert.ok(events.includes('rotate'));
  assert.ok(events.includes('deny'));
});
