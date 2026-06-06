import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

/**
 * 고유값 — the immutable unique value of a document: SHA-256 (hex) of its plaintext
 * content. Serves as both document identity and the integrity anchor that every
 * token signature is keyed to.
 */
export function uniqueValue(content: Buffer | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Per-document signing key, derived from the server master secret and the 고유값.
 * This binds a token's signature to the document's immutable hash: a token signed
 * for document A cannot validate under document B's key.
 */
export function deriveDocKey(masterSecret: Buffer, uv: string): Buffer {
  return createHmac('sha256', masterSecret).update(`crypton/doc-key/v1:${uv}`).digest();
}

export function hmacSign(key: Buffer, message: string): string {
  return createHmac('sha256', key).update(message).digest('base64url');
}

export function hmacVerify(key: Buffer, message: string, sig: string): boolean {
  const expected = createHmac('sha256', key).update(message).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, 'base64url');
  } catch {
    return false;
  }
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

const GCM_IV_BYTES = 12;

export interface AesGcmCipher {
  /** base64 */
  iv: string;
  /** base64 */
  authTag: string;
  /** base64 */
  ciphertext: string;
}

/** Content encryption key (AES-256). Server-held; released to a viewer only on view-start. */
export function generateCek(): Buffer {
  return randomBytes(32);
}

export function aesGcmEncrypt(cek: Buffer, plaintext: Buffer): AesGcmCipher {
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', cek, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ct.toString('base64'),
  };
}

export function aesGcmDecrypt(cek: Buffer, enc: AesGcmCipher): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', cek, Buffer.from(enc.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(enc.authTag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(enc.ciphertext, 'base64')), decipher.final()]);
}

/** Time-ordered unique id (UUIDv7) — used for token ids (tid) and copy ids. */
export function uuidv7(): string {
  const ts = Date.now();
  const b = randomBytes(16);
  b[0] = Math.floor(ts / 2 ** 40) & 0xff;
  b[1] = Math.floor(ts / 2 ** 32) & 0xff;
  b[2] = Math.floor(ts / 2 ** 24) & 0xff;
  b[3] = Math.floor(ts / 2 ** 16) & 0xff;
  b[4] = Math.floor(ts / 2 ** 8) & 0xff;
  b[5] = ts & 0xff;
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export { randomBytes, randomUUID };
