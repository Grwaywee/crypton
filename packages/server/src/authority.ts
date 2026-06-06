import {
  buildContainer,
  deriveDocKey,
  issueToken,
  uuidv7,
  verifyTokenSig,
  type CryptonContainer,
  type OpenFailure,
  type OpenRequest,
  type OpenResponse,
  type OpenSuccess,
} from '@crypton/core';
import type { KeyProvider } from './keys';
import type { CopyRecord, Store, TitleRecord } from './store/types';

export interface AuthorityConfig {
  masterSecret: Buffer;
  tokenTtlSeconds: number;
  serverUrl: string;
}

/**
 * The token authority — the single source of truth for access. It issues the first
 * token when a copy is downloaded, and on every open it authenticates the presented
 * token and atomically rotates it (T1 → T2), so that exactly one valid token exists
 * per copy at any moment.
 */
export class TokenAuthority {
  constructor(
    private readonly store: Store,
    private readonly cfg: AuthorityConfig,
    private readonly keys: KeyProvider,
  ) {}

  private docKey(doc: string): Buffer {
    return deriveDocKey(this.cfg.masterSecret, doc);
  }

  /** Mint a fresh copy of a title for a user and build its container (download / S320). */
  async issueCopy(
    title: TitleRecord,
    userId: string,
  ): Promise<{ copy: CopyRecord; container: CryptonContainer }> {
    const copyId = uuidv7();
    const token = issueToken({
      doc: title.doc,
      sid: copyId,
      ttlSeconds: this.cfg.tokenTtlSeconds,
      masterSecret: this.cfg.masterSecret,
    });
    const container = buildContainer({
      content: Buffer.from(title.content, 'base64'),
      title: title.title,
      server: this.cfg.serverUrl,
      copyId,
      token,
      cek: this.keys.unwrap(title.cekWrapped), // released from the envelope only to encrypt this copy
    });
    const now = Date.now();
    const copy: CopyRecord = {
      copyId,
      doc: title.doc,
      userId,
      currentTokenId: token.tid,
      currentTokenSig: token.sig,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.putCopy(copy);
    await this.store.appendAudit({
      doc: title.doc,
      copyId,
      tokenId: token.tid,
      sid: token.sid,
      event: 'issue',
      at: now,
    });
    return { copy, container };
  }

  /** Authenticate the presented token and atomically rotate it (the open flow, S330–S390). */
  async open(req: OpenRequest): Promise<OpenResponse> {
    const copy = await this.store.getCopy(req.copyId);
    if (!copy) return { viewStart: false, reason: 'unknown-copy' };

    const title = await this.store.getTitle(copy.doc);
    if (!title) return { viewStart: false, reason: 'unknown-document' };

    // Integrity: the token must belong to this document and carry a valid signature
    // (keyed by the 고유값).
    if (req.token.doc !== copy.doc) return this.deny(copy, req, 'doc-mismatch');
    const sig = verifyTokenSig(req.token, this.docKey(copy.doc));
    if (!sig.ok) return this.deny(copy, req, sig.reason ?? 'bad-signature');

    // Authentication (S350): the presented token must be the one live token. A stale
    // token here is the redistribution / replay case (도4: A re-opening after B took over).
    if (req.token.tid !== copy.currentTokenId) return this.deny(copy, req, 'stale-token');

    // Rotation (S370): mint T2 (guaranteed ≠ T1) and atomically swap it in.
    const t2 = issueToken({
      doc: copy.doc,
      sid: copy.copyId,
      ttlSeconds: this.cfg.tokenTtlSeconds,
      masterSecret: this.cfg.masterSecret,
      perm: req.token.perm,
    });
    const swapped = await this.store.rotateCopyToken(copy.copyId, req.token.tid, {
      tokenId: t2.tid,
      sig: t2.sig,
      at: Date.now(),
    });
    // Lost the race against a concurrent open of the same copy → not the live holder.
    if (!swapped) return this.deny(copy, req, 'rotation-conflict');

    await this.store.appendAudit({
      doc: copy.doc,
      copyId: copy.copyId,
      tokenId: t2.tid,
      sid: t2.sid,
      event: 'rotate',
      detail: `from:${req.token.tid}`,
      at: Date.now(),
    });

    const ok: OpenSuccess = {
      viewStart: true,
      token: t2,
      cek: this.keys.unwrap(title.cekWrapped).toString('base64'), // unwrapped only on view-start
      graceSeconds: this.cfg.tokenTtlSeconds,
    };
    return ok;
  }

  private async deny(copy: CopyRecord, req: OpenRequest, reason: string): Promise<OpenFailure> {
    await this.store.appendAudit({
      doc: copy.doc,
      copyId: copy.copyId,
      tokenId: req.token.tid,
      sid: req.token.sid,
      event: 'deny',
      detail: reason,
      at: Date.now(),
    });
    return { viewStart: false, reason };
  }
}
