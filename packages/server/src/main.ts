// Runnable entry point — starts the security server. Library consumers import from
// './index' instead; this file is only executed (tsx src/main.ts).
import { buildApp } from './app';
import { loadConfig } from './config';
import type { Store } from './store/types';

const config = loadConfig();

// Durable SQLite store when CRYPTON_SQLITE_PATH is set (needs --experimental-sqlite),
// otherwise an in-memory store. Dynamic import keeps node:sqlite out of the default path.
let store: Store | undefined;
if (config.sqlitePath) {
  const { SqliteStore } = await import('./store/sqlite');
  store = new SqliteStore(config.sqlitePath);
}

const app = await buildApp({
  config: {
    masterSecret: config.masterSecret,
    tokenTtlSeconds: config.tokenTtlSeconds,
    serverUrl: config.serverUrl,
    jwtSecret: config.jwtSecret,
    jwtExpiresIn: config.jwtExpiresIn,
    corsOrigins: config.corsOrigins,
  },
  store,
  logger: true,
});

await app.listen({ port: config.port, host: config.host });
app.log.info(
  `crypton security server listening at ${config.serverUrl} (store: ${config.sqlitePath ? 'sqlite' : 'memory'})`,
);
