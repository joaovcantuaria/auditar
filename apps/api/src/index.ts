import 'dotenv/config';
import { createServer } from 'node:http';
import type { Worker } from 'bullmq';
import app from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/database.js';
import { redis } from './config/redis.js';
import { startWorkers, scheduleCronJobs } from './jobs/index.js';
import { createAtribuicaoWorker } from './jobs/atribuicao.worker.js';
import { createAuditoriaWorker } from './modules/auditoria/index.js';
import { initSocket } from './socket/socket.server.js';

async function main() {
  // Connect Redis
  await redis.connect();
  console.log('[redis] connected');

  // Test DB connection
  await prisma.$connect();
  console.log('[database] connected');

  // Servidor HTTP explícito — necessário para montar o Socket.io sobre ele.
  const httpServer = createServer(app);

  // Socket.io (tempo real): handshake autenticado + join de salas por perfil.
  initSocket(httpServer);
  console.log('[socket] inicializado');

  // Workers BullMQ. startWorkers() cria notificacao + prazo + limpeza +
  // relatorio; atribuicao e auditoria são registrados separadamente.
  const workers: Worker[] = startWorkers();
  workers.push(createAtribuicaoWorker(), createAuditoriaWorker());
  console.log(`[jobs] ${workers.length} workers iniciados`);

  // Agenda os jobs repetíveis (cron): verificação de prazos + limpeza.
  await scheduleCronJobs();
  console.log('[jobs] cron agendado');

  // Start HTTP server
  httpServer.listen(env.API_PORT, () => {
    console.log(`[api] listening on http://localhost:${env.API_PORT}`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[api] received ${signal}, shutting down...`);
    httpServer.close(async () => {
      // Encerra os workers antes de desconectar Redis (BullMQ usa o Redis).
      await Promise.all(workers.map((w) => w.close()));
      await prisma.$disconnect();
      await redis.quit();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[api] startup error:', err);
  process.exit(1);
});
