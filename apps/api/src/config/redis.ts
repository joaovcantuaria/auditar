// Import nomeado da classe `Redis` (compatível com NodeNext ESM). O import
// default do ioredis resolve como namespace e não é construível sob NodeNext.
import { Redis, type RedisOptions } from 'ioredis';
import { env } from './env.js';

/**
 * Detecta se a conexão deve usar TLS.
 *
 * TLS é ligado quando:
 *  - `REDIS_TLS=true` (flag explícita), OU
 *  - `REDIS_URL` começa com `rediss://` (provedores gerenciados como Upstash).
 *
 * No ambiente local (Redis em Docker, `redis://`) permanece desligado, mantendo
 * o comportamento atual intacto.
 */
export function shouldUseRedisTls(): boolean {
  if (env.REDIS_TLS) return true;
  return env.REDIS_URL.startsWith('rediss://');
}

const options: RedisOptions = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD,
  maxRetriesPerRequest: null, // required by BullMQ
  enableReadyCheck: false,
  lazyConnect: true,
};

// Só adiciona `tls` quando necessário — assim o ambiente local (sem TLS) não é
// afetado. O SNI (`servername`) é derivado do host para que o handshake TLS
// funcione com provedores gerenciados.
if (shouldUseRedisTls()) {
  options.tls = { servername: env.REDIS_HOST };
}

export const redis = new Redis(options);

redis.on('error', (err) => {
  console.error('[redis] connection error:', err.message);
});
