import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CekCache } from './protocol';

/**
 * File-backed CEK cache for the offline-grace window.
 *
 * NOTE: CEKs are stored here in the clear, which is the acknowledged offline tradeoff —
 * anyone with the file + a within-grace container can decrypt offline (threat model §6).
 * A hardened build should wrap these keys with the OS keystore (Keychain / DPAPI /
 * libsecret). The single-live-token gate still governs *online* access and redistribution.
 */
export class FileCekCache implements CekCache {
  private readonly data: Record<string, string>;

  constructor(private readonly path: string) {
    this.data = existsSync(path)
      ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>)
      : {};
  }

  get(copyId: string): string | undefined {
    return this.data[copyId];
  }

  put(copyId: string, cekBase64: string): void {
    this.data[copyId] = cekBase64;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data), { mode: 0o600 });
  }
}
