// Durable Store backed by SQLite (node:sqlite). Demonstrates the production persistence
// shape — most importantly an atomic single-live-token rotation via a conditional UPDATE,
// the exact pattern a Postgres adapter uses (`UPDATE ... WHERE current_token_id = $expected`).
//
// Requires the --experimental-sqlite Node flag (Node >= 22.5). For multi-node production,
// use a Postgres adapter (primary data) + Redis (token CAS / sessions) behind this same
// Store interface.
import { DatabaseSync } from 'node:sqlite';
import type {
  AuditEntry,
  CopyRecord,
  EntitlementRecord,
  Store,
  TitleRecord,
  UserRecord,
} from './types';
import type { Role } from '@crypton/core';

type Row = Record<string, unknown>;

function userFrom(r: Row | undefined): UserRecord | undefined {
  if (!r) return undefined;
  return {
    id: String(r.id),
    email: String(r.email),
    passwordHash: String(r.password_hash),
    role: String(r.role) as Role,
    displayName: r.display_name == null ? undefined : String(r.display_name),
    createdAt: Number(r.created_at),
  };
}

function titleFrom(r: Row | undefined): TitleRecord | undefined {
  if (!r) return undefined;
  return {
    doc: String(r.doc),
    title: String(r.title),
    ownerId: String(r.owner_id),
    priceCents: Number(r.price_cents),
    cekWrapped: String(r.cek_wrapped),
    content: String(r.content),
    createdAt: Number(r.created_at),
  };
}

function copyFrom(r: Row | undefined): CopyRecord | undefined {
  if (!r) return undefined;
  return {
    copyId: String(r.copy_id),
    doc: String(r.doc),
    userId: String(r.user_id),
    currentTokenId: String(r.current_token_id),
    currentTokenSig: String(r.current_token_sig),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function auditFrom(r: Row): AuditEntry {
  return {
    doc: String(r.doc),
    copyId: String(r.copy_id),
    tokenId: String(r.token_id),
    sid: String(r.sid),
    event: String(r.event) as AuditEntry['event'],
    detail: r.detail == null ? undefined : String(r.detail),
    at: Number(r.at),
  };
}

export class SqliteStore implements Store {
  private readonly db: DatabaseSync;

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
        role TEXT NOT NULL, display_name TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS titles (
        doc TEXT PRIMARY KEY, title TEXT NOT NULL, owner_id TEXT NOT NULL,
        price_cents INTEGER NOT NULL, cek_wrapped TEXT NOT NULL, content TEXT NOT NULL,
        created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS copies (
        copy_id TEXT PRIMARY KEY, doc TEXT NOT NULL, user_id TEXT NOT NULL,
        current_token_id TEXT NOT NULL, current_token_sig TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS entitlements (
        user_id TEXT NOT NULL, doc TEXT NOT NULL, source TEXT NOT NULL,
        granted_at INTEGER NOT NULL, PRIMARY KEY (user_id, doc));
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT, doc TEXT NOT NULL, copy_id TEXT NOT NULL,
        token_id TEXT NOT NULL, sid TEXT NOT NULL, event TEXT NOT NULL, detail TEXT,
        at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS audit_by_copy ON audit (copy_id);
      CREATE INDEX IF NOT EXISTS audit_by_doc ON audit (doc);
    `);
  }

  close(): void {
    this.db.close();
  }

  async putUser(u: UserRecord): Promise<void> {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO users (id,email,password_hash,role,display_name,created_at) VALUES (?,?,?,?,?,?)',
      )
      .run(u.id, u.email.trim().toLowerCase(), u.passwordHash, u.role, u.displayName ?? null, u.createdAt);
  }
  async getUserById(id: string): Promise<UserRecord | undefined> {
    return userFrom(this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined);
  }
  async getUserByEmail(email: string): Promise<UserRecord | undefined> {
    return userFrom(
      this.db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase()) as Row | undefined,
    );
  }

  async putTitle(t: TitleRecord): Promise<void> {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO titles (doc,title,owner_id,price_cents,cek_wrapped,content,created_at) VALUES (?,?,?,?,?,?,?)',
      )
      .run(t.doc, t.title, t.ownerId, t.priceCents, t.cekWrapped, t.content, t.createdAt);
  }
  async getTitle(doc: string): Promise<TitleRecord | undefined> {
    return titleFrom(this.db.prepare('SELECT * FROM titles WHERE doc = ?').get(doc) as Row | undefined);
  }
  async listTitles(): Promise<TitleRecord[]> {
    return (this.db.prepare('SELECT * FROM titles').all() as Row[]).map((r) => titleFrom(r)!);
  }

  async putCopy(c: CopyRecord): Promise<void> {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO copies (copy_id,doc,user_id,current_token_id,current_token_sig,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
      )
      .run(c.copyId, c.doc, c.userId, c.currentTokenId, c.currentTokenSig, c.createdAt, c.updatedAt);
  }
  async getCopy(copyId: string): Promise<CopyRecord | undefined> {
    return copyFrom(this.db.prepare('SELECT * FROM copies WHERE copy_id = ?').get(copyId) as Row | undefined);
  }

  async rotateCopyToken(
    copyId: string,
    expectedTokenId: string,
    next: { tokenId: string; sig: string; at: number },
  ): Promise<boolean> {
    // Atomic compare-and-swap: the row updates only if it still holds the expected token.
    const res = this.db
      .prepare(
        'UPDATE copies SET current_token_id = ?, current_token_sig = ?, updated_at = ? WHERE copy_id = ? AND current_token_id = ?',
      )
      .run(next.tokenId, next.sig, next.at, copyId, expectedTokenId);
    return res.changes === 1;
  }

  async putEntitlement(e: EntitlementRecord): Promise<void> {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO entitlements (user_id,doc,source,granted_at) VALUES (?,?,?,?)',
      )
      .run(e.userId, e.doc, e.source, e.grantedAt);
  }
  async hasEntitlement(userId: string, doc: string): Promise<boolean> {
    return Boolean(
      this.db.prepare('SELECT 1 FROM entitlements WHERE user_id = ? AND doc = ?').get(userId, doc),
    );
  }

  async appendAudit(e: AuditEntry): Promise<void> {
    this.db
      .prepare('INSERT INTO audit (doc,copy_id,token_id,sid,event,detail,at) VALUES (?,?,?,?,?,?,?)')
      .run(e.doc, e.copyId, e.tokenId, e.sid, e.event, e.detail ?? null, e.at);
  }
  async auditByCopy(copyId: string): Promise<AuditEntry[]> {
    return (this.db.prepare('SELECT * FROM audit WHERE copy_id = ? ORDER BY at, id').all(copyId) as Row[]).map(auditFrom);
  }
  async auditByDoc(doc: string): Promise<AuditEntry[]> {
    return (this.db.prepare('SELECT * FROM audit WHERE doc = ? ORDER BY at, id').all(doc) as Row[]).map(auditFrom);
  }
}
