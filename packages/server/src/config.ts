import { randomBytes } from 'node:crypto';

export interface ServerConfig {
  port: number;
  host: string;
  /** true when running outside production — enables dev conveniences (ephemeral secrets) */
  isProduction: boolean;
  /** master secret from which every per-document signing key is derived */
  masterSecret: Buffer;
  /** secret used to sign access tokens (JWTs) */
  jwtSecret: string;
  /** access-token lifetime */
  jwtExpiresIn: string;
  /** token lifetime, in seconds — also the offline-grace / render window */
  tokenTtlSeconds: number;
  /** public base URL embedded into issued containers */
  serverUrl: string;
  /** allowed CORS origins ([] = same-origin only) */
  corsOrigins: string[];
  /** when set, use a durable SQLite store at this path instead of in-memory */
  sqlitePath?: string;
}

class ConfigError extends Error {}

/**
 * Load and validate configuration. In production, required secrets MUST be supplied via
 * the environment — there is no silent ephemeral fallback (fail-closed). In development a
 * random secret is generated with a warning.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const isProduction = (env.NODE_ENV ?? env.CRYPTON_ENV) === 'production';
  const port = Number(env.PORT ?? 7070);
  const host = env.HOST ?? '127.0.0.1';

  const masterHex = env.CRYPTON_MASTER_SECRET;
  const jwtSecret = env.CRYPTON_JWT_SECRET;

  if (isProduction) {
    if (!masterHex) throw new ConfigError('CRYPTON_MASTER_SECRET is required in production');
    if (Buffer.from(masterHex, 'hex').length < 32) {
      throw new ConfigError('CRYPTON_MASTER_SECRET must be at least 32 bytes (64 hex chars)');
    }
    if (!jwtSecret || jwtSecret.length < 32) {
      throw new ConfigError('CRYPTON_JWT_SECRET (>= 32 chars) is required in production');
    }
  } else if (!masterHex || !jwtSecret) {
    console.warn(
      '[crypton] CRYPTON_MASTER_SECRET / CRYPTON_JWT_SECRET not set — using ephemeral dev secrets. ' +
        'Issued tokens will not survive a restart. Set both (and NODE_ENV=production) before deploying.',
    );
  }

  return {
    port,
    host,
    isProduction,
    masterSecret: masterHex ? Buffer.from(masterHex, 'hex') : randomBytes(32),
    jwtSecret: jwtSecret ?? randomBytes(32).toString('hex'),
    jwtExpiresIn: env.CRYPTON_JWT_TTL ?? '12h',
    tokenTtlSeconds: Number(env.CRYPTON_TOKEN_TTL ?? 3600),
    serverUrl: env.CRYPTON_SERVER_URL ?? `http://${host}:${port}`,
    corsOrigins: (env.CRYPTON_CORS_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    sqlitePath: env.CRYPTON_SQLITE_PATH || undefined,
  };
}
