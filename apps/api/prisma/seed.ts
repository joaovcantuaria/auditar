/**
 * Script de SEED do Prisma para o backend `apps/api` (standalone).
 *
 * Rodado por `npm run prisma:seed` (via `prisma db seed` → `tsx prisma/seed.ts`).
 *
 * A LÓGICA do seed foi EXTRAÍDA para `src/modules/setup/seed.service.ts`
 * (função `seedDatabase`), que é a fonte única compartilhada entre este script
 * e o endpoint temporário `POST|GET /api/v1/setup/seed`. Aqui apenas
 * instanciamos o PrismaClient, chamamos `seedDatabase` e encerramos a conexão.
 *
 * Observação: NÃO importamos `../src/config/env.ts` de propósito — ele valida
 * muitas variáveis de ambiente via Zod que podem não estar setadas ao rodar o
 * seed. O PrismaClient lê `DATABASE_URL` sozinho do ambiente, mantendo o seed
 * autossuficiente. O import de `seed.service` traz apenas a lógica pura.
 */

import { PrismaClient } from '@prisma/client';
import { seedDatabase } from '../src/modules/setup/seed.service.js';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await seedDatabase(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
