// Public module surface of @crypton/server (importable by tests, the platform and the demo).
export { buildApp, type BuildAppOptions } from './app';
export { TokenAuthority, type AuthorityConfig } from './authority';
export { Notifier } from './notify';
export { loadConfig, type ServerConfig } from './config';
export { MemoryStore } from './store/memory';
export type {
  Store,
  TitleRecord,
  CopyRecord,
  EntitlementRecord,
  AuditEntry,
} from './store/types';
