import { Router } from 'express';
import { sanitizeMiddleware } from '../../middleware/sanitize.js';
import { authenticate, requireCidadao } from '../../middleware/auth.js';
import {
  postRegistrar,
  postAtivar,
  postReenviarAtivacao,
  postLoginCidadao,
  postLogoutCidadao,
  postRecuperarSenha,
  postNovaSenha,
  postEnviar2fa,
  postVerificar2fa,
} from './auth.cidadao.controller.js';

/**
 * Rotas de cadastro e ativação de conta do Cidadão.
 *
 * Montado pelo agregador em `/api/v1/auth/cidadao`.
 *
 * A sanitização é aplicada localmente porque ainda não é global no `app.ts`
 * (Req. 20.3, 20.9). Se/quando `sanitizeMiddleware` passar a ser aplicado
 * globalmente, esta linha pode ser removida sem efeito colateral.
 *
 * _Requirements: 1.1–1.9_
 */
export const cidadaoAuthRouter: Router = Router();

cidadaoAuthRouter.use(sanitizeMiddleware);

cidadaoAuthRouter.post('/registrar', postRegistrar);
cidadaoAuthRouter.post('/ativar', postAtivar);
cidadaoAuthRouter.post('/reenviar-ativacao', postReenviarAtivacao);

// Login público; logout exige autenticação de cidadão (Req. 2.1).
cidadaoAuthRouter.post('/login', postLoginCidadao);
cidadaoAuthRouter.post('/logout', authenticate, requireCidadao, postLogoutCidadao);

// Recuperação de senha — ambas públicas (Req. 7.3, 7.4).
cidadaoAuthRouter.post('/recuperar-senha', postRecuperarSenha);
cidadaoAuthRouter.post('/nova-senha', postNovaSenha);

// 2FA — rotas públicas; o cidadaoId vem da etapa de login (Req. 2.5, 2.6).
cidadaoAuthRouter.post('/2fa/enviar', postEnviar2fa);
cidadaoAuthRouter.post('/2fa/verificar', postVerificar2fa);
