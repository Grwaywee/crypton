import { z } from 'zod';
import { aesGcmDecrypt, aesGcmEncrypt, uniqueValue, type AesGcmCipher } from './crypto';
import { TokenSchema, type Token } from './token';

export const CRYPTON_VERSION = 1 as const;

export const ManifestSchema = z.object({
  version: z.literal(CRYPTON_VERSION),
  /** 고유값 */
  doc: z.string(),
  /** issued-copy identity — the key of this copy's single-live-token lineage */
  copyId: z.string(),
  title: z.string(),
  /** security server base URL */
  server: z.string(),
  /** the current embedded token slot */
  token: TokenSchema,
  enc: z.object({
    alg: z.literal('AES-256-GCM'),
    iv: z.string(),
    authTag: z.string(),
  }),
  createdAt: z.number().int(),
});
export type CryptonManifest = z.infer<typeof ManifestSchema>;

export const ContainerSchema = z.object({
  manifest: ManifestSchema,
  /** base64 AES-256-GCM ciphertext of the document bytes */
  ciphertext: z.string(),
});
export type CryptonContainer = z.infer<typeof ContainerSchema>;

export interface BuildContainerInput {
  content: Buffer;
  title: string;
  server: string;
  copyId: string;
  /** the first token (T1) */
  token: Token;
  /** content encryption key — used to encrypt, but intentionally NOT stored in the container */
  cek: Buffer;
  /** unix ms; injectable for tests */
  now?: number;
}

export function buildContainer(input: BuildContainerInput): CryptonContainer {
  const doc = uniqueValue(input.content);
  if (input.token.doc !== doc) throw new Error('token.doc does not match the content 고유값');
  const enc: AesGcmCipher = aesGcmEncrypt(input.cek, input.content);
  const manifest: CryptonManifest = {
    version: CRYPTON_VERSION,
    doc,
    copyId: input.copyId,
    title: input.title,
    server: input.server,
    token: input.token,
    enc: { alg: 'AES-256-GCM', iv: enc.iv, authTag: enc.authTag },
    createdAt: input.now ?? Date.now(),
  };
  return { manifest, ciphertext: enc.ciphertext };
}

export function serializeContainer(c: CryptonContainer): string {
  return JSON.stringify(c, null, 2);
}

export function parseContainer(raw: string | Buffer): CryptonContainer {
  const json = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
  return ContainerSchema.parse(json);
}

/**
 * Decrypt the payload with the server-released CEK, then verify the 고유값 integrity
 * anchor (the decrypted plaintext must hash back to manifest.doc).
 */
export function decryptPayload(c: CryptonContainer, cek: Buffer): Buffer {
  const plaintext = aesGcmDecrypt(cek, {
    iv: c.manifest.enc.iv,
    authTag: c.manifest.enc.authTag,
    ciphertext: c.ciphertext,
  });
  if (uniqueValue(plaintext) !== c.manifest.doc) {
    throw new Error('integrity check failed: 고유값 mismatch');
  }
  return plaintext;
}

/** Replace the embedded token slot after a successful rotation (S390). */
export function withRotatedToken(c: CryptonContainer, next: Token): CryptonContainer {
  return { ...c, manifest: { ...c.manifest, token: next } };
}
