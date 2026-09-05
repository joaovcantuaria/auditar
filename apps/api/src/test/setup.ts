// Vitest setup for @auditar/api
// Populates the environment variables required by src/config/env.ts so that
// importing modules under test does not trigger process.exit(1).

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/auditar_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.JWT_SECRET ??= 'test-secret-key-with-at-least-32-characters!!';
process.env.JWT_EXPIRES_IN ??= '1h';
process.env.JWT_LONG_EXPIRES_IN ??= '7d';
process.env.MINIO_ROOT_USER ??= 'minio';
process.env.MINIO_ROOT_PASSWORD ??= 'minio-password';
process.env.SMTP_HOST ??= 'localhost';
process.env.SMTP_USER ??= 'smtp-user';
process.env.SMTP_PASS ??= 'smtp-pass';
process.env.SMTP_FROM_ADDRESS ??= 'no-reply@auditar.local';
