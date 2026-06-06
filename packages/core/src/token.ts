import { z } from 'zod';
import { deriveDocKey, hmacSign, hmacVerify, uuidv7 } from './crypto';

export const PermissionSchema = z.enum(['read', 'print', 'annotate']);
export type Permission = z.infer<typeof PermissionSchema>;

/** Token claims excluding the signature — i.e. the exact set of fields that get signed. */
export const TokenPayloadSchema = z.object({
  /** 고유값 (immutable document hash) */
  doc: z.string(),
  /** rotation nonce; brand-new on every rotation, so T1 ≠ T2 */
  tid: z.string(),
  /** issued-at (unix seconds) */
  iat: z.number().int(),
  /** expiry (unix seconds) — bounds the viewer's render/offline-grace window */
  exp: z.number().int(),
  /** granted permissions */
  perm: z.array(PermissionSchema),
  /** copy/session binding (process identifier) */
  sid: z.string(),
});
export type TokenPayload = z.infer<typeof TokenPayloadSchema>;

export const TokenSchema = TokenPayloadSchema.extend({ sig: z.string() });
export type Token = z.infer<typeof TokenSchema>;

/** Deterministic, key-sorted serialization — the canonical bytes that get signed. */
export function canonicalPayload(p: TokenPayload): string {
  return JSON.stringify({
    doc: p.doc,
    exp: p.exp,
    iat: p.iat,
    perm: [...p.perm],
    sid: p.sid,
    tid: p.tid,
  });
}

export function signToken(payload: TokenPayload, docKey: Buffer): Token {
  return { ...payload, sig: hmacSign(docKey, canonicalPayload(payload)) };
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

export function verifyTokenSig(token: Token, docKey: Buffer): VerifyResult {
  const parsed = TokenSchema.safeParse(token);
  if (!parsed.success) return { ok: false, reason: 'malformed-token' };
  const { sig, ...payload } = parsed.data;
  if (!hmacVerify(docKey, canonicalPayload(payload), sig)) {
    return { ok: false, reason: 'bad-signature' };
  }
  return { ok: true };
}

export interface IssueOptions {
  doc: string;
  sid: string;
  ttlSeconds: number;
  masterSecret: Buffer;
  perm?: Permission[];
  /** unix seconds; injectable for tests */
  now?: number;
}

/** Mint a freshly-signed token with a brand-new tid (used for the first token and every rotation). */
export function issueToken(opts: IssueOptions): Token {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    doc: opts.doc,
    tid: uuidv7(),
    iat: now,
    exp: now + opts.ttlSeconds,
    perm: opts.perm ?? ['read'],
    sid: opts.sid,
  };
  return signToken(payload, deriveDocKey(opts.masterSecret, opts.doc));
}

export function isExpired(token: TokenPayload, now: number = Math.floor(Date.now() / 1000)): boolean {
  return token.exp < now;
}
