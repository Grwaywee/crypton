import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import {
  canonicalPayload,
  deriveDocKey,
  isExpired,
  issueToken,
  verifyTokenSig,
} from '@crypton/core';

const master = randomBytes(32);
const doc = 'a'.repeat(64);

test('an issued token verifies under its own document key', () => {
  const t = issueToken({ doc, sid: 'copy-1', ttlSeconds: 3600, masterSecret: master, now: 1_000_000 });
  assert.equal(verifyTokenSig(t, deriveDocKey(master, doc)).ok, true);
});

test('tampering any signed field breaks the signature', () => {
  const t = issueToken({ doc, sid: 'copy-1', ttlSeconds: 3600, masterSecret: master });
  const key = deriveDocKey(master, doc);
  assert.equal(verifyTokenSig({ ...t, exp: t.exp + 1 }, key).ok, false);
  assert.equal(verifyTokenSig({ ...t, perm: ['print'] }, key).ok, false);
  assert.equal(verifyTokenSig({ ...t, sid: 'copy-2' }, key).ok, false);
  assert.equal(verifyTokenSig({ ...t, tid: 'forged' }, key).ok, false);
});

test('a token signed for one document fails under another document key', () => {
  const t = issueToken({ doc, sid: 'c', ttlSeconds: 60, masterSecret: master });
  assert.equal(verifyTokenSig(t, deriveDocKey(master, 'b'.repeat(64))).ok, false);
});

test('every issue/rotation yields a fresh tid (T1 ≠ T2)', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) {
    seen.add(issueToken({ doc, sid: 'c', ttlSeconds: 60, masterSecret: master }).tid);
  }
  assert.equal(seen.size, 50);
});

test('canonical payload is stable regardless of input key order', () => {
  const a = canonicalPayload({ doc, tid: 't', iat: 1, exp: 2, perm: ['read'], sid: 's' });
  const b = canonicalPayload({ sid: 's', perm: ['read'], exp: 2, iat: 1, tid: 't', doc });
  assert.equal(a, b);
});

test('isExpired respects exp', () => {
  const t = issueToken({ doc, sid: 'c', ttlSeconds: 100, masterSecret: master, now: 1000 });
  assert.equal(isExpired(t, 1099), false);
  assert.equal(isExpired(t, 1101), true);
});
