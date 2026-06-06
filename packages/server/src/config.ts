import { randomBytes } from 'node:crypto';

export interface ServerConfig {
  port: number;
  host: string;
  /** master secret from which every per-document signing key is derived */
  masterSecret: Buffer;
  /** token lifetime, in seconds — also the offline-grace / render window */
  tokenTtlSeconds: number;
  /** public base URL embedded into issued containers */
  serverUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.PORT ?? 7070);
  const host = env.HOST ?? '127.0.0.1';
  const hex = env.CRYPTON_MASTER_SECRET;
  if (!hex) {
    console.warn(
      '[crypton] CRYPTON_MASTER_SECRET is not set — using an ephemeral key. Issued tokens will not verify after a restart.',
    );
  }
  return {
    port,
    host,
    masterSecret: hex ? Buffer.from(hex, 'hex') : randomBytes(32),
    tokenTtlSeconds: Number(env.CRYPTON_TOKEN_TTL ?? 3600),
    serverUrl: env.CRYPTON_SERVER_URL ?? `http://${host}:${port}`,
  };
}
