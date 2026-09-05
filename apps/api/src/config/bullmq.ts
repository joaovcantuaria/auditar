import { ConnectionOptions } from 'bullmq';
import { env } from './env.js';
import { shouldUseRedisTls } from './redis.js';

export const bullmqConnection: ConnectionOptions = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  // Mesma regra do cliente Redis: só habilita TLS para provedores gerenciados
  // (ex.: Upstash `rediss://`) ou quando REDIS_TLS=true. Local permanece sem TLS.
  ...(shouldUseRedisTls() ? { tls: { servername: env.REDIS_HOST } } : {}),
};
