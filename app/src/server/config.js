// Runtime configuration from environment variables, validated once at startup (fail fast).
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const int = (env, name, fallback, min, max) => {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return value;
};

const bool = (env, name, fallback) => {
  const raw = (env[name] ?? '').toLowerCase();
  if (raw === '') return fallback;
  if (['1', 'true', 'yes'].includes(raw)) return true;
  if (['0', 'false', 'no'].includes(raw)) return false;
  throw new Error(`${name} must be true or false`);
};

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  // Kubernetes mounts the key as a file (ORDER_SIGNING_KEY_FILE); compose passes it as a variable.
  const rawKey = env.ORDER_SIGNING_KEY_FILE ? readFileSync(env.ORDER_SIGNING_KEY_FILE, 'utf8').trim() : (env.ORDER_SIGNING_KEY ?? '');
  if (rawKey !== '' && Buffer.byteLength(rawKey) < 32) {
    throw new Error('ORDER_SIGNING_KEY must be at least 32 bytes');
  }
  const allowEphemeralKey = bool(env, 'ALLOW_EPHEMERAL_SIGNING_KEY', !production);
  if (rawKey === '' && !allowEphemeralKey) {
    throw new Error('ORDER_SIGNING_KEY is required in production (or set ALLOW_EPHEMERAL_SIGNING_KEY=true)');
  }
  return {
    production,
    host: env.HOST ?? '0.0.0.0',
    port: int(env, 'PORT', 8080, 1, 65535),
    staticDir: env.STATIC_DIR ?? 'dist',
    version: env.APP_VERSION ?? '0.0.0-dev',
    commit: (env.GIT_COMMIT ?? 'unknown').slice(0, 40),
    city: env.CITY ?? 'Pune',
    rateLimitPerMinute: int(env, 'RATE_LIMIT_PER_MINUTE', 120, 1, 100000),
    trustProxy: bool(env, 'TRUST_PROXY', false),
    hsts: bool(env, 'HSTS', false),
    drainSeconds: int(env, 'DRAIN_SECONDS', 5, 0, 60),
    maxBodyBytes: int(env, 'MAX_BODY_BYTES', 16384, 512, 1048576),
    signingKey: rawKey === '' ? randomBytes(32) : Buffer.from(rawKey),
    signingKeySource: rawKey === '' ? 'ephemeral' : env.ORDER_SIGNING_KEY_FILE ? 'file' : 'env',
  };
}
