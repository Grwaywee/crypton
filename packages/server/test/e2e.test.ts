import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { decryptPayload, type CryptonContainer, type Token } from '@crypton/core';
import { buildApp, type AppConfig } from '@crypton/server';
import type { FastifyInstance } from 'fastify';

function config(): AppConfig {
  return {
    masterSecret: randomBytes(32),
    tokenTtlSeconds: 3600,
    serverUrl: 'http://test.local',
    jwtSecret: 'test-jwt-secret-test-jwt-secret-0123456789',
    jwtExpiresIn: '1h',
    corsOrigins: [],
  };
}

function freshApp(rateLimit = false) {
  return buildApp({ config: config(), rateLimit });
}

function postJson(app: FastifyInstance, url: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return app.inject({ method: 'POST', url, headers, payload: JSON.stringify(body) });
}

function getJson(app: FastifyInstance, url: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return app.inject({ method: 'GET', url, headers });
}

async function registerUser(app: FastifyInstance, email = 'pub@x.com', password = 'password123') {
  const res = await postJson(app, '/auth/register', { email, password });
  assert.equal(res.statusCode, 201);
  return res.json().token as string;
}

async function publishDoc(app: FastifyInstance, token: string, text = 'top-secret quarterly report') {
  const content = Buffer.from(text, 'utf8');
  const res = await postJson(
    app,
    '/titles',
    { title: 'Q4', contentBase64: content.toString('base64'), priceCents: 1999 },
    token,
  );
  assert.equal(res.statusCode, 201);
  return { doc: res.json().doc as string, content };
}

async function purchaseAndDownload(app: FastifyInstance, token: string, doc: string) {
  await postJson(app, '/purchase', { doc }, token);
  const res = await postJson(app, '/download', { doc }, token);
  assert.equal(res.statusCode, 200);
  return res.json().container as CryptonContainer;
}

const open = (app: FastifyInstance, copyId: string, token: Token) =>
  postJson(app, '/open', { copyId, token });

// --- authentication ------------------------------------------------------

test('register issues a token and never returns the password hash', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());
  const res = await postJson(app, '/auth/register', { email: 'u@x.com', password: 'password123' });
  assert.equal(res.statusCode, 201);
  assert.ok(res.json().token);
  assert.equal(res.json().user.email, 'u@x.com');
  assert.equal('passwordHash' in res.json().user, false);
});

test('duplicate email and bad credentials are rejected', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());
  await postJson(app, '/auth/register', { email: 'u@x.com', password: 'password123' });
  assert.equal((await postJson(app, '/auth/register', { email: 'u@x.com', password: 'password123' })).statusCode, 409);
  assert.equal((await postJson(app, '/auth/login', { email: 'u@x.com', password: 'password123' })).statusCode, 200);
  assert.equal((await postJson(app, '/auth/login', { email: 'u@x.com', password: 'nope' })).statusCode, 401);
});

test('protected routes reject unauthenticated requests', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());
  const c = Buffer.from('x').toString('base64');
  assert.equal((await postJson(app, '/titles', { title: 'x', contentBase64: c, priceCents: 0 })).statusCode, 401);
  assert.equal((await postJson(app, '/purchase', { doc: 'd' })).statusCode, 401);
  assert.equal((await postJson(app, '/download', { doc: 'd' })).statusCode, 401);
  assert.equal((await getJson(app, '/audit/doc/whatever')).statusCode, 401);
});

test('identity is taken from the token, not the request body', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());
  const alice = await registerUser(app, 'alice@x.com');
  const bob = await registerUser(app, 'bob@x.com');
  const { doc } = await publishDoc(app, alice);
  await postJson(app, '/purchase', { doc }, alice);
  // bob never purchased → cannot download alice's entitlement
  assert.equal((await postJson(app, '/download', { doc }, bob)).statusCode, 402);
  assert.equal((await postJson(app, '/download', { doc }, alice)).statusCode, 200);
});

// --- catalog & commerce --------------------------------------------------

test('catalog listing never leaks server-held secrets (cek / content)', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());
  const token = await registerUser(app);
  const { doc } = await publishDoc(app, token);
  const list = (await getJson(app, '/titles')).json();
  const entry = list.find((x: { doc: string }) => x.doc === doc);
  assert.ok(entry);
  assert.equal('cek' in entry, false);
  assert.equal('content' in entry, false);
});

test('download is gated on purchase (payment precedes transfer)', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());
  const token = await registerUser(app);
  const { doc } = await publishDoc(app, token);
  assert.equal((await postJson(app, '/download', { doc }, token)).statusCode, 402);
  await postJson(app, '/purchase', { doc }, token);
  assert.equal((await postJson(app, '/download', { doc }, token)).statusCode, 200);
});

// --- the invention: rotation, transfer, single-live-token ----------------

test('the issued container carries a token + copyId but never the CEK', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());
  const token = await registerUser(app);
  const { doc } = await publishDoc(app, token);
  const container = await purchaseAndDownload(app, token, doc);
  assert.equal(container.manifest.doc, doc);
  assert.ok(container.manifest.copyId);
  assert.ok(container.manifest.token.sig);
  assert.equal(JSON.stringify(container).includes('"cek"'), false);
});

test('opening authenticates, rotates (T1 ≠ T2) and releases the CEK to decrypt', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());
  const token = await registerUser(app);
  const { doc, content } = await publishDoc(app, token);
  const container = await purchaseAndDownload(app, token, doc);
  const t1 = container.manifest.token;

  const res = (await open(app, container.manifest.copyId, t1)).json();
  assert.equal(res.viewStart, true);
  assert.notEqual(res.token.tid, t1.tid);
  const plain = decryptPayload(container, Buffer.from(res.cek, 'base64'));
  assert.deepEqual(plain, content);
});

test('a stale (already-rotated) token is rejected on re-open', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());
  const token = await registerUser(app);
  const { doc } = await publishDoc(app, token);
  const container = await purchaseAndDownload(app, token, doc);
  const t1 = container.manifest.token;
  assert.equal((await open(app, container.manifest.copyId, t1)).json().viewStart, true);
  const reuse = (await open(app, container.manifest.copyId, t1)).json();
  assert.equal(reuse.viewStart, false);
  assert.equal(reuse.reason, 'stale-token');
});

test('redistribution transfers access instead of multiplying it (도4)', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());
  const token = await registerUser(app);
  const { doc, content } = await publishDoc(app, token);
  const container = await purchaseAndDownload(app, token, doc);
  const copyId = container.manifest.copyId;

  const a1 = (await open(app, copyId, container.manifest.token)).json();
  assert.equal(a1.viewStart, true);
  const aliceToken: Token = a1.token;

  const b1 = (await open(app, copyId, aliceToken)).json(); // Bob opens the shared T2
  assert.equal(b1.viewStart, true);
  const bobToken: Token = b1.token;

  const a2 = (await open(app, copyId, aliceToken)).json(); // Alice's T2 is now stale
  assert.equal(a2.viewStart, false);
  assert.equal(a2.reason, 'stale-token');

  const b2 = (await open(app, copyId, bobToken)).json();
  assert.equal(b2.viewStart, true);
  assert.deepEqual(decryptPayload(container, Buffer.from(b2.cek, 'base64')), content);
});

test('concurrent opens of one copy yield exactly one winner (single-live-token)', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());
  const token = await registerUser(app);
  const { doc } = await publishDoc(app, token);
  const container = await purchaseAndDownload(app, token, doc);
  const racers = Array.from({ length: 12 }, () => open(app, container.manifest.copyId, container.manifest.token));
  const bodies = (await Promise.all(racers)).map((r) => r.json());
  assert.equal(bodies.filter((b) => b.viewStart === true).length, 1);
});

test('a forged token signature is rejected', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());
  const token = await registerUser(app);
  const { doc } = await publishDoc(app, token);
  const container = await purchaseAndDownload(app, token, doc);
  const forged: Token = { ...container.manifest.token, exp: container.manifest.token.exp + 99999 };
  const res = (await open(app, container.manifest.copyId, forged)).json();
  assert.equal(res.viewStart, false);
  assert.equal(res.reason, 'bad-signature');
});

test("one copy's live token cannot open a different copy", async (t) => {
  const app = await freshApp();
  t.after(() => app.close());
  const token = await registerUser(app);
  const { doc } = await publishDoc(app, token);
  await postJson(app, '/purchase', { doc }, token);
  const a = (await postJson(app, '/download', { doc }, token)).json().container as CryptonContainer;
  const b = (await postJson(app, '/download', { doc }, token)).json().container as CryptonContainer;
  const res = (await open(app, b.manifest.copyId, a.manifest.token)).json();
  assert.equal(res.viewStart, false);
  assert.equal(res.reason, 'stale-token');
});

test('an unknown copy is rejected', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());
  const token = await registerUser(app);
  const { doc } = await publishDoc(app, token);
  const container = await purchaseAndDownload(app, token, doc);
  const res = (await open(app, 'no-such-copy', container.manifest.token)).json();
  assert.equal(res.viewStart, false);
  assert.equal(res.reason, 'unknown-copy');
});

// --- audit (ownership) ---------------------------------------------------

test('audit records issue/rotate/deny and is owner-scoped', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());
  const alice = await registerUser(app, 'alice@x.com');
  const bob = await registerUser(app, 'bob@x.com');
  const { doc } = await publishDoc(app, alice);
  const container = await purchaseAndDownload(app, alice, doc);
  const copyId = container.manifest.copyId;
  await open(app, copyId, container.manifest.token); // rotate
  await open(app, copyId, container.manifest.token); // stale → deny

  // bob cannot read alice's copy audit
  assert.equal((await getJson(app, `/audit/copy/${copyId}`, bob)).statusCode, 403);

  const log = (await getJson(app, `/audit/copy/${copyId}`, alice)).json();
  const events = log.map((e: { event: string }) => e.event);
  assert.ok(events.includes('issue'));
  assert.ok(events.includes('rotate'));
  assert.ok(events.includes('deny'));
});

// --- rate limiting -------------------------------------------------------

test('login is rate limited (anti-brute-force)', async (t) => {
  const app = await buildApp({ config: config(), rateLimit: true });
  t.after(() => app.close());
  let limited = false;
  for (let i = 0; i < 8; i++) {
    const res = await postJson(app, '/auth/login', { email: 'none@x.com', password: 'x' });
    if (res.statusCode === 429) {
      limited = true;
      break;
    }
  }
  assert.equal(limited, true);
});
