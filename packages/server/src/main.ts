// Runnable entry point — starts the security server. Library consumers import from
// './index' instead; this file is only executed (tsx src/main.ts).
import { buildApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();

const app = await buildApp({
  config: {
    masterSecret: config.masterSecret,
    tokenTtlSeconds: config.tokenTtlSeconds,
    serverUrl: config.serverUrl,
  },
  logger: true,
});

await app.listen({ port: config.port, host: config.host });
app.log.info(`crypton security server listening at ${config.serverUrl}`);
