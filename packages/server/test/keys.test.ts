import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { LocalKeyProvider } from '@crypton/server';

test('wrap → unwrap round-trips the data key', () => {
  const kp = new LocalKeyProvider(randomBytes(32));
  const cek = randomBytes(32);
  assert.deepEqual(kp.unwrap(kp.wrap(cek)), cek);
});

test('the wrapped blob never contains the plaintext key', () => {
  const kp = new LocalKeyProvider(randomBytes(32));
  const cek = randomBytes(32);
  const wrapped = kp.wrap(cek);
  assert.equal(wrapped.includes(cek.toString('base64')), false);
  assert.ok(wrapped.startsWith('v1.'));
});

test('a different master secret cannot unwrap', () => {
  const cek = randomBytes(32);
  const wrapped = new LocalKeyProvider(randomBytes(32)).wrap(cek);
  assert.throws(() => new LocalKeyProvider(randomBytes(32)).unwrap(wrapped));
});

test('a tampered blob fails the GCM auth tag', () => {
  const kp = new LocalKeyProvider(randomBytes(32));
  const wrapped = kp.wrap(randomBytes(32));
  const tampered = wrapped.slice(0, -4) + (wrapped.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  assert.throws(() => kp.unwrap(tampered));
});

test('an unknown key version is rejected', () => {
  const kp = new LocalKeyProvider(randomBytes(32));
  const wrapped = kp.wrap(randomBytes(32));
  assert.throws(() => kp.unwrap(`v9.${wrapped.slice(3)}`));
});
