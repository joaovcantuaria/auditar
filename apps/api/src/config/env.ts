import { z } from 'zod';

/**
 * Booleano vindo de variável de ambiente.
 *
 * NÃO usar `z.coerce.boolean()`: ele aplica `Boolean(valor)`, e qualquer string
 * não vazia vira `true` — inclusive `"false"` e `"0"`. Aqui só `true/1/yes/on`
 * (sem diferenciar maiúsculas) são verdadeiros; `false/0/no/off` e vazio são
 * falsos; qualquer outro valor é rejeitado na validação do ambiente.
 */
export function booleanEnv(padrao: boolean) {
  return z.preprocess((valor) => {
    if (valor === undefined || valor === null) return undefined;
    if (typeof valor === 'boolean') return valor;
    const texto = String(valor).trim().toLowerCase();
    if (texto === '') return undefined;
    if (['true', '1', 'yes', 'on'].includes(texto)) return true;
    if (['false', '0', 'no', 'off'].includes(texto)) return false;
    return valor;
  }, z.boolean().default(padrao));
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().default(3000),
  API_URL: z.string().url().default('http://localhost:3000'),
  WEB_URL: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  // Habilita TLS na conexão Redis. Necessário para provedores gerenciados que
  // usam `rediss://` (ex.: Upstash). No ambiente local (Redis em Docker) deve
  // permanecer `false`. Aceita também ligar automaticamente quando REDIS_URL
  // começar com `rediss://` (ver config/redis.ts e config/bullmq.ts).
  REDIS_TLS: booleanEnv(false),
  MINIO_ENDPOINT: z.string().default('localhost'),
  MINIO_PORT: z.coerce.number().default(9000),
  MINIO_USE_SSL: booleanEnv(false),
  MINIO_ROOT_USER: z.string().min(1),
  MINIO_ROOT_PASSWORD: z.string().min(1),
  MINIO_BUCKET_PROCESSOS: z.string().default('processos'),
  MINIO_BUCKET_RELATORIOS: z.string().default('relatorios'),
  // Região do storage S3-compatível. Necessário para Cloudflare R2, que exige
  // `auto`. No MinIO local pode ficar vazio (a lib usa o padrão). Só é aplicado
  // quando definido — ver config/minio.ts.
  MINIO_REGION: z.string().optional(),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('1h'),
  JWT_LONG_EXPIRES_IN: z.string().default('7d'),
  BCRYPT_ROUNDS: z.coerce.number().default(12),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: booleanEnv(false),
  SMTP_USER: z.string().min(1),
  SMTP_PASS: z.string().min(1),
  SMTP_FROM_NAME: z.string().default('Auditar'),
  SMTP_FROM_ADDRESS: z.string().email(),
  FEATURE_SMS_ENABLED: booleanEnv(false),
  FEATURE_PUSH_ENABLED: booleanEnv(false),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  SERVER_SESSION_TIMEOUT_MIN: z.coerce.number().default(60),
  CITIZEN_SESSION_TIMEOUT_MIN: z.coerce.number().default(30),
  MAX_ADMINS: z.coerce.number().default(3),
  // Token do endpoint TEMPORÁRIO de setup/seed (POST|GET /api/v1/setup/seed).
  // Quando ausente, o endpoint fica DESABILITADO (responde 404). Quando
  // definido, exige `?token=` idêntico para autorizar a execução do seed.
  SETUP_TOKEN: z.string().optional(),
});

// Parse with safe parse to get better error messages in development
const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
