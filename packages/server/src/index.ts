// Public module surface of @crypton/server (importable by tests, the platform and the demo).
export { buildApp, type BuildAppOptions, type AppConfig } from './app';
export { TokenAuthority, type AuthorityConfig } from './authority';
export { Notifier } from './notify';
export { loadConfig, type ServerConfig } from './config';
export { hashPassword, verifyPassword } from './passwords';
export { LocalKeyProvider, type KeyProvider } from './keys';
export { MemoryStore } from './store/memory';
// SqliteStore is intentionally NOT re-exported here: importing it pulls in node:sqlite
// (which needs --experimental-sqlite). Import it directly from './store/sqlite' when needed.
export type {
  Store,
  UserRecord,
  TitleRecord,
  CopyRecord,
  EntitlementRecord,
  AuditEntry,
} from './store/types';
