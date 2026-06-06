import type {
  AuditEntry,
  CopyRecord,
  EntitlementRecord,
  Store,
  TitleRecord,
  UserRecord,
} from './types';

/**
 * In-memory reference implementation of {@link Store}. Suitable for dev, tests and
 * single-node demos. The rotate operation is a synchronous compare-and-swap, which is
 * atomic under Node's run-to-completion model (no `await` between the compare and the
 * set). Swap in a Postgres + Redis adapter behind the same interface for production.
 */
export class MemoryStore implements Store {
  private users = new Map<string, UserRecord>();
  private usersByEmail = new Map<string, string>();
  private titles = new Map<string, TitleRecord>();
  private copies = new Map<string, CopyRecord>();
  private entitlements = new Set<string>();
  private audit: AuditEntry[] = [];

  private static entKey(userId: string, doc: string): string {
    return `${userId}::${doc}`;
  }

  private static emailKey(email: string): string {
    return email.trim().toLowerCase();
  }

  async putUser(u: UserRecord): Promise<void> {
    this.users.set(u.id, u);
    this.usersByEmail.set(MemoryStore.emailKey(u.email), u.id);
  }
  async getUserById(id: string): Promise<UserRecord | undefined> {
    return this.users.get(id);
  }
  async getUserByEmail(email: string): Promise<UserRecord | undefined> {
    const id = this.usersByEmail.get(MemoryStore.emailKey(email));
    return id ? this.users.get(id) : undefined;
  }

  async putTitle(t: TitleRecord): Promise<void> {
    this.titles.set(t.doc, t);
  }
  async getTitle(doc: string): Promise<TitleRecord | undefined> {
    return this.titles.get(doc);
  }
  async listTitles(): Promise<TitleRecord[]> {
    return [...this.titles.values()];
  }

  async putCopy(c: CopyRecord): Promise<void> {
    this.copies.set(c.copyId, c);
  }
  async getCopy(copyId: string): Promise<CopyRecord | undefined> {
    return this.copies.get(copyId);
  }

  async rotateCopyToken(
    copyId: string,
    expectedTokenId: string,
    next: { tokenId: string; sig: string; at: number },
  ): Promise<boolean> {
    const c = this.copies.get(copyId);
    if (!c) return false;
    // --- atomic critical section: no await between compare and set ---
    if (c.currentTokenId !== expectedTokenId) return false;
    c.currentTokenId = next.tokenId;
    c.currentTokenSig = next.sig;
    c.updatedAt = next.at;
    // ----------------------------------------------------------------
    return true;
  }

  async putEntitlement(e: EntitlementRecord): Promise<void> {
    this.entitlements.add(MemoryStore.entKey(e.userId, e.doc));
  }
  async hasEntitlement(userId: string, doc: string): Promise<boolean> {
    return this.entitlements.has(MemoryStore.entKey(userId, doc));
  }

  async appendAudit(e: AuditEntry): Promise<void> {
    this.audit.push(e);
  }
  async auditByCopy(copyId: string): Promise<AuditEntry[]> {
    return this.audit.filter((e) => e.copyId === copyId).sort((a, b) => a.at - b.at);
  }
  async auditByDoc(doc: string): Promise<AuditEntry[]> {
    return this.audit.filter((e) => e.doc === doc).sort((a, b) => a.at - b.at);
  }
}
