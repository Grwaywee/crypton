import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import {
  buildContainer,
  decryptPayload,
  generateCek,
  issueToken,
  parseContainer,
  serializeContainer,
  uniqueValue,
  withRotatedToken,
} from '@crypton/core';

const master = randomBytes(32);

function make() {
  const content = Buffer.from('# Secret Report\nrotate me', 'utf8');
  const doc = uniqueValue(content);
  const cek = generateCek();
  const token = issueToken({ doc, sid: 'copy-1', ttlSeconds: 3600, masterSecret: master });
  const container = buildContainer({
    content,
    title: 'Report',
    server: 'http://localhost:7070',
    copyId: 'copy-1',
    token,
    cek,
  });
  return { content, doc, cek, token, container };
}

test('build → serialize → parse round-trips and decrypts with the CEK', () => {
  const { content, cek, container } = make();
  const round = parseContainer(serializeContainer(container));
  assert.deepEqual(decryptPayload(round, cek), content);
});

test('the CEK is never embedded in the container', () => {
  const { cek, container } = make();
  assert.equal(serializeContainer(container).includes(cek.toString('base64')), false);
});

test('a wrong CEK cannot decrypt', () => {
  const { container } = make();
  assert.throws(() => decryptPayload(container, generateCek()));
});

test('tampering the ciphertext fails the GCM auth tag', () => {
  const { cek, container } = make();
  const tampered = { ...container, ciphertext: Buffer.from('x'.repeat(40)).toString('base64') };
  assert.throws(() => decryptPayload(tampered, cek));
});

test('building with a mismatched token.doc is rejected', () => {
  const content = Buffer.from('hello', 'utf8');
  const cek = generateCek();
  const token = issueToken({ doc: 'deadbeef', sid: 'c', ttlSeconds: 60, masterSecret: master });
  assert.throws(() =>
    buildContainer({ content, title: 't', server: 's', copyId: 'c', token, cek }),
  );
});

test('withRotatedToken swaps only the token slot', () => {
  const { container, doc } = make();
  const next = issueToken({ doc, sid: 'copy-1', ttlSeconds: 3600, masterSecret: master });
  const rotated = withRotatedToken(container, next);
  assert.equal(rotated.manifest.token.tid, next.tid);
  assert.equal(rotated.ciphertext, container.ciphertext);
});
