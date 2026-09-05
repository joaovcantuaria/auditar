import { Client as MinioClient, type ClientOptions } from 'minio';
import { env } from './env.js';

const options: ClientOptions = {
  endPoint: env.MINIO_ENDPOINT,
  port: env.MINIO_PORT,
  useSSL: env.MINIO_USE_SSL,
  accessKey: env.MINIO_ROOT_USER,
  secretKey: env.MINIO_ROOT_PASSWORD,
};

// Cloudflare R2 (e alguns provedores S3) exigem `region` para assinar as
// requisições e gerar presigned URLs válidas — use `MINIO_REGION=auto`. No
// MinIO local a variável fica ausente e o comportamento atual é preservado.
if (env.MINIO_REGION) {
  options.region = env.MINIO_REGION;
}

export const minio = new MinioClient(options);
