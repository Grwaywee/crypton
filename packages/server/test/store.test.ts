import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MemoryStore } from '@crypton/server';
import { SqliteStore } from '../src/store/sqlite';
import type { Store } from '../src/store/types';

const aUser = (id = 'u1', email = 'a@x.com') =>
  ({ id, email, passwordHash: 'h', role: 'user' as const, createdAt: 1 });
const aTitle = (doc = 'd1') =>
  ({ doc, title: 'T', ownerId: 'u1', priceCents: 100, cekWrapped: 'v1.xxx', content: 'Y29udGVudA==', createdAt: 1 });
const aCopy = (copyId = 'c1', tid = 't1') =>
  ({ copyId, doc: 'd1', userId: 'u1', currentTokenId: tid, currentTokenSig: 's', createdAt: 1, updatedAt: 1 });

// One contract, exercised against every Store implementation.
function runContract(name: string, make: () => Store) {
  test(`${name}: users round-trip with case-insensitive email`, async () => {
    const s = make();
    await s.putUser(aUser('u1', 'Alice@X.com'));
    assert.equal((await s.getUserById('u1'))?.email.toLowerCase(), 'alice@x.com');
    assert.ok(await s.getUserByEmail('alice@x.com'));
    assert.ok(await s.getUserByEmail('ALICE@X.com'));
    assert.equal(await s.getUserByEmail('missing@x.com'), undefined);
  });

  test(`${name}: titles store the wrapped CEK and list`, async () => {
    const s = make();
    await s.putTitle(aTitle('d1'));
    await s.putTitle(aTitle('d2'));
    assert.equal((await s.getTitle('d1'))?.cekWrapped, 'v1.xxx');
    assert.equal((await s.listTitles()).length, 2);
  });

  test(`${name}: rotateCopyToken is an atomic compare-and-swap`, async () => {
    const s = make();
    await s.putCopy(aCopy('c1', 't1'));
    assert.equal(await s.rotateCopyToken('c1', 't1', { tokenId: 't2', sig: 's2', at: 2 }), true);
    assert.equal((await s.getCopy('c1'))?.currentTokenId, 't2');
    // stale expected token → no swap
    assert.equal(await s.rotateCopyToken('c1', 't1', { tokenId: 't3', sig: 's3', at: 3 }), false);
    assert.equal((await s.getCopy('c1'))?.currentTokenId, 't2');
  });

  test(`${name}: concurrent rotation yields exactly one winner`, async () => {
    const s = make();
    await s.putCopy(aCopy('c1', 't1'));
    const wins = (
      await Promise.all(
        Array.from({ length: 8 }, (_, i) => s.rotateCopyToken('c1', 't1', { tokenId: `t${i}`, sig: 's', at: i })),
      )
    ).filter(Boolean);
    assert.equal(wins.length, 1);
  });

  test(`${name}: entitlements`, async () => {
    const s = make();
    assert.equal(await s.hasEntitlement('u1', 'd1'), false);
    await s.putEntitlement({ userId: 'u1', doc: 'd1', source: 'purchase', grantedAt: 1 });
    assert.equal(await s.hasEntitlement('u1', 'd1'), true);
  });

  test(`${name}: audit append + query is time-ordered`, async () => {
    const s = make();
    await s.appendAudit({ doc: 'd1', copyId: 'c1', tokenId: 't1', sid: 's', event: 'issue', at: 2 });
    await s.appendAudit({ doc: 'd1', copyId: 'c1', tokenId: 't2', sid: 's', event: 'rotate', at: 1 });
    assert.deepEqual((await s.auditByCopy('c1')).map((e) => e.at), [1, 2]);
    assert.equal((await s.auditByDoc('d1')).length, 2);
  });
}

runContract('MemoryStore', () => new MemoryStore());
runContract('SqliteStore', () => new SqliteStore(':memory:'));

test('SqliteStore persists data across reopen (durability)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'crypton-'));
  const path = join(dir, 'store.db');
  try {
    const s1 = new SqliteStore(path);
    await s1.putTitle(aTitle('d1'));
    await s1.putCopy(aCopy('c1', 't1'));
    s1.close();

    const s2 = new SqliteStore(path);
    assert.equal((await s2.getTitle('d1'))?.doc, 'd1');
    assert.equal((await s2.getCopy('c1'))?.currentTokenId, 't1');
    s2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
