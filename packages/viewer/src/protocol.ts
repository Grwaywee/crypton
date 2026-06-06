import {
  decryptPayload,
  OpenResponseSchema,
  withRotatedToken,
  type CryptonContainer,
} from '@crypton/core';

/** Stores content-encryption keys released by the server, enabling offline-grace opens. */
export interface CekCache {
  /** returns the base64 CEK previously cached for a copy, if any */
  get(copyId: string): string | undefined;
  put(copyId: string, cekBase64: string): void;
}

export class MemoryCekCache implements CekCache {
  private readonly map = new Map<string, string>();
  get(copyId: string): string | undefined {
    return this.map.get(copyId);
  }
  put(copyId: string, cekBase64: string): void {
    this.map.set(copyId, cekBase64);
  }
}

export interface OpenOptions {
  /** override the server URL embedded in the container (on-prem / testing) */
  serverBase?: string;
}

export interface OpenOutcome {
  ok: boolean;
  reason?: string;
  offline?: boolean;
  title?: string;
  content?: Buffer;
  /** the container with its embedded token rotated forward — persist this back to disk (S390) */
  container?: CryptonContainer;
}

export interface ViewerClientOptions {
  fetch?: typeof fetch;
  cache?: CekCache;
  /** unix-ms clock, injectable for tests */
  now?: () => number;
}

/**
 * The custom viewer's protocol client. It refuses to render until the security server
 * authenticates the embedded token and returns a view-start command together with a
 * fresh (rotated) token and the content key. Only then can the AES-GCM payload be
 * decrypted. After a successful open the embedded token is rotated forward.
 */
export class ViewerClient {
  private readonly fetchImpl: typeof fetch;
  private readonly cache: CekCache;
  private readonly now: () => number;

  constructor(opts: ViewerClientOptions = {}) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.cache = opts.cache ?? new MemoryCekCache();
    this.now = opts.now ?? (() => Date.now());
  }

  async open(container: CryptonContainer, opts: OpenOptions = {}): Promise<OpenOutcome> {
    const base = (opts.serverBase ?? container.manifest.server).replace(/\/+$/, '');
    let response: Response;
    try {
      response = await this.fetchImpl(`${base}/open`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          copyId: container.manifest.copyId,
          token: container.manifest.token,
        }),
      });
    } catch {
      // The server is unreachable — fall back to the offline-grace window (§3.4).
      return this.openOffline(container);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, reason: 'bad-response' };
    }
    const parsed = OpenResponseSchema.safeParse(body);
    if (!parsed.success) return { ok: false, reason: 'bad-response' };
    if (!parsed.data.viewStart) return { ok: false, reason: parsed.data.reason };

    const rotated = withRotatedToken(container, parsed.data.token); // S390
    let content: Buffer;
    try {
      content = decryptPayload(rotated, Buffer.from(parsed.data.cek, 'base64'));
    } catch {
      return { ok: false, reason: 'decrypt-failed' };
    }
    this.cache.put(container.manifest.copyId, parsed.data.cek); // arm the offline-grace window
    return { ok: true, title: rotated.manifest.title, content, container: rotated };
  }

  /**
   * Render offline using a CEK cached during a previous online open, but only while the
   * last rotated token is still within its validity window. Beyond that, a re-auth
   * (online open) is required.
   */
  openOffline(container: CryptonContainer): OpenOutcome {
    const cek = this.cache.get(container.manifest.copyId);
    if (!cek) return { ok: false, reason: 'offline-no-grace' };
    const nowSeconds = Math.floor(this.now() / 1000);
    if (container.manifest.token.exp < nowSeconds) {
      return { ok: false, reason: 'offline-grace-expired' };
    }
    try {
      const content = decryptPayload(container, Buffer.from(cek, 'base64'));
      return { ok: true, offline: true, title: container.manifest.title, content, container };
    } catch {
      return { ok: false, reason: 'decrypt-failed' };
    }
  }
}
