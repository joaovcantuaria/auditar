import { Router } from 'express';
import { authenticate, requireCidadao } from '../../middleware/auth.js';
import { sanitizeMiddleware } from '../../middleware/sanitize.js';
import { patch2fa } from './conta2fa.controller.js';

/**
 * Rota de configuração de autenticação de dois fatores (2FA) do Cidadão.
 * Montado sob `/api/v1/cidadao/conta` pelo agregador de rotas (mesmo prefixo
 * das demais rotas de conta).
 *
 *   PATCH /2fa — ativa/desativa o 2FA (body: { ativo, canal? })
 *
 * Exige cidadão autenticado; a escrita passa pela sanitização de entrada,
 * assim como as demais rotas de gestão de conta.
 *
 * _Requirements: 2.5_
 */
export const conta2faRouter = Router();

conta2faRouter.use(authenticate, requireCidadao);

conta2faRouter.patch('/2fa', sanitizeMiddleware, patch2fa);

export default conta2faRouter;
