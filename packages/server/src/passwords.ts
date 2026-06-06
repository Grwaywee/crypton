import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// scrypt parameters (OWASP-recommended baseline). N=2^15, r=8, p=1.
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

/** Hash a password with scrypt + per-password random salt. Format: scrypt$N$r$p$salt$hash. */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const dk = scryptSync(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 256 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${dk.toString('base64')}`;
}

/** Constant-time verification of a password against a stored hash. */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const expected = Buffer.from(parts[5] ?? '', 'base64');
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p) || expected.length === 0) {
    return false;
  }
  const dk = scryptSync(password, salt, expected.length, { N: n, r, p, maxmem: 256 * 1024 * 1024 });
  return dk.length === expected.length && timingSafeEqual(dk, expected);
}
