import type { Role } from '@crypton/core';

/** A registered user. The password hash is server-only and never leaves the store. */
export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  role: Role;
  displayName?: string;
  createdAt: number;
}

/** A catalog title — one record per unique content (고유값). Holds server-only secrets. */
export interface TitleRecord {
  /** 고유값 (PK) */
  doc: string;
  title: string;
  ownerId: string;
  priceCents: number;
  /** base64 content encryption key (server-held; released only on view-start) */
  cek: string;
  /** base64 original document bytes (kept server-side to mint copies on download) */
  content: string;
  createdAt: number;
}

/** An issued copy / license — its own single-live-token lineage. */
export interface CopyRecord {
  /** copy id (PK) */
  copyId: string;
  /** → TitleRecord.doc (고유값) */
  doc: string;
  userId: string;
  currentTokenId: string;
  currentTokenSig: string;
  createdAt: number;
  updatedAt: number;
}

export interface EntitlementRecord {
  userId: string;
  doc: string;
  source: 'purchase' | 'cloud';
  grantedAt: number;
}

export interface AuditEntry {
  doc: string;
  copyId: string;
  tokenId: string;
  sid: string;
  event: 'issue' | 'rotate' | 'deny';
  detail?: string;
  at: number;
}

export interface Store {
  putUser(u: UserRecord): Promise<void>;
  getUserById(id: string): Promise<UserRecord | undefined>;
  getUserByEmail(email: string): Promise<UserRecord | undefined>;

  putTitle(t: TitleRecord): Promise<void>;
  getTitle(doc: string): Promise<TitleRecord | undefined>;
  listTitles(): Promise<TitleRecord[]>;

  putCopy(c: CopyRecord): Promise<void>;
  getCopy(copyId: string): Promise<CopyRecord | undefined>;

  /**
   * Atomic single-live-token rotation. Swaps the copy's current token **iff** it
   * still equals `expectedTokenId`, and returns whether the swap won. This is the
   * inventive compare-and-swap: a Postgres adapter implements it as
   * `UPDATE copies SET current_token_id = $next WHERE copy_id = $id AND current_token_id = $expected`;
   * a Redis adapter as a WATCH/MULTI or Lua CAS. Concurrent opens of the same copy
   * therefore yield exactly one winner — the single-live-token invariant.
   */
  rotateCopyToken(
    copyId: string,
    expectedTokenId: string,
    next: { tokenId: string; sig: string; at: number },
  ): Promise<boolean>;

  putEntitlement(e: EntitlementRecord): Promise<void>;
  hasEntitlement(userId: string, doc: string): Promise<boolean>;

  appendAudit(e: AuditEntry): Promise<void>;
  auditByCopy(copyId: string): Promise<AuditEntry[]>;
  auditByDoc(doc: string): Promise<AuditEntry[]>;
}
