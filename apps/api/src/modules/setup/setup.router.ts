import { Router, type Request, type Response } from 'express';
import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import { seedDatabase } from './seed.service.js';

/**
 * Módulo de SETUP TEMPORÁRIO.
 *
 * Expõe um endpoint protegido por token para executar o seed do banco SOB
 * DEMANDA, sem depender do Shell (pago) do Render. É pensado para ser acessado
 * uma única vez pelo navegador logo após o primeiro deploy.
 *
 * Segurança:
 *  - NÃO usa autenticação JWT. A proteção é feita exclusivamente pelo
 *    `SETUP_TOKEN` (env var). Se `SETUP_TOKEN` não estiver definido, o endpoint
 *    fica DESABILITADO e responde 404 (não vaza sua existência).
 *  - Se o `?token=` não bater EXATAMENTE com `SETUP_TOKEN`, responde 403.
 *
 * ATENÇÃO: este é um endpoint temporário de bootstrap. Após semear a produção,
 * recomenda-se remover `SETUP_TOKEN` do ambiente (desabilitando o endpoint) ou
 * remover este módulo.
 *
 * Rotas (montadas sob `/api/v1/setup`):
 *   POST /seed  — executa o seed.
 *   GET  /seed  — idem (facilita rodar pelo navegador digitando a URL).
 */
export const setupRouter = Router();

/**
 * Handler compartilhado por GET e POST. Faz o guard de token e executa o seed.
 */
async function handleSeed(req: Request, res: Response): Promise<void> {
  // Endpoint desabilitado quando o token não está configurado no ambiente.
  if (!env.SETUP_TOKEN) {
    res.status(404).json({ error: 'Route not found', code: 'SYS_002' });
    return;
  }

  // Comparação exata do token informado via query param.
  const tokenInformado = req.query.token;
  if (typeof tokenInformado !== 'string' || tokenInformado !== env.SETUP_TOKEN) {
    res.status(403).json({ error: 'Token inválido', code: 'SYS_003' });
    return;
  }

  try {
    // Usa o prisma real do app; seedDatabase é idempotente.
    const { criado, mensagem } = await seedDatabase(prisma);
    res.status(200).json({ ok: true, criado, mensagem });
  } catch (err) {
    // Endpoint de setup temporário: expõe a mensagem do erro para diagnóstico.
    const mensagem = err instanceof Error ? err.message : String(err);
    console.error('[setup] falha ao executar o seed:', mensagem);
    res.status(500).json({ ok: false, error: mensagem });
  }
}

setupRouter.post('/seed', handleSeed);
setupRouter.get('/seed', handleSeed);

export default setupRouter;
