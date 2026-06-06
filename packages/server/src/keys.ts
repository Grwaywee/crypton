import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Wraps/unwraps data keys (CEKs) so they are never stored in the clear. This is the
 * envelope-encryption seam: the {@link LocalKeyProvider} derives a key-encryption-key
 * (KEK) from the master secret, while production swaps in a KMS/HSM-backed provider
 * (AWS KMS, GCP KMS, Vault Transit) implementing the same interface.
 */
export interface KeyProvider {
  /** the active key version, recorded in each wrapped blob to allow rotation */
  readonly keyId: string;
  /** wrap a plaintext key, returning an opaque base64 blob */
  wrap(plaintext: Buffer): string;
  /** unwrap a previously wrapped blob */
  unwrap(wrapped: string): Buffer;
}

const KEK_VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class LocalKeyProvider implements KeyProvider {
  readonly keyId = KEK_VERSION;
  private readonly kek: Buffer;

  constructor(masterSecret: Buffer) {
    this.kek = Buffer.from(
      hkdfSync('sha256', masterSecret, Buffer.alloc(0), `crypton/kek/${KEK_VERSION}`, 32),
    );
  }

  wrap(plaintext: Buffer): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.kek, iv);
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const blob = Buffer.concat([iv, cipher.getAuthTag(), ct]);
    return `${this.keyId}.${blob.toString('base64')}`;
  }

  unwrap(wrapped: string): Buffer {
    const dot = wrapped.indexOf('.');
    if (dot < 0) throw new Error('malformed wrapped key');
    const version = wrapped.slice(0, dot);
    if (version !== this.keyId) throw new Error(`unknown key version: ${version}`);
    const blob = Buffer.from(wrapped.slice(dot + 1), 'base64');
    const iv = blob.subarray(0, IV_BYTES);
    const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ct = blob.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.kek, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  }
}
