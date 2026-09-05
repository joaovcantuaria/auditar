import { Router } from 'express';
import { authenticate, requireCidadao } from '../../middleware/auth.js';
import { sanitizeMiddleware } from '../../middleware/sanitize.js';
import {
  getPerfil,
  patchPerfil,
  postAlterarEmail,
  postConfirmarEmail,
  postAlterarSenha,
  getAcessos,
  deleteConta,
  getPreferencias,
  putPreferencias,
} from './cidadaos.controller.js';

/**
 * Rotas de Gestão de Conta do Cidadão.
 * Montado sob `/api/v1/cidadao/conta` pelo agregador de rotas.
 *
 *   GET    /                 — perfil do cidadão autenticado
 *   PATCH  /                 — editar perfil (nome, telefone, endereço)
 *   POST   /alterar-email    — solicitar alteração de e-mail (confirmação 24h)
 *   POST   /confirmar-email  — confirmar alteração de e-mail via token
 *   POST   /alterar-senha    — alterar senha (exige senha atual)
 *   GET    /acessos          — últimos 10 acessos (ordem decrescente)
 *   DELETE /                 — solicitar exclusão de conta (LGPD; ?confirmar=true)
 *   GET    /notificacoes/preferencias — preferências de notificação (defaults se vazio)
 *   PUT    /notificacoes/preferencias — salvar preferências + horário de silêncio
 *
 * Todas as rotas exigem cidadão autenticado; as escritas passam pela
 * sanitização de entrada.
 *
 * Requisitos: 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8
 */
export const cidadaosRouter = Router();

cidadaosRouter.use(authenticate, requireCidadao);

cidadaosRouter.get('/', getPerfil);
cidadaosRouter.patch('/', sanitizeMiddleware, patchPerfil);
cidadaosRouter.post('/alterar-email', sanitizeMiddleware, postAlterarEmail);
cidadaosRouter.post('/confirmar-email', sanitizeMiddleware, postConfirmarEmail);
cidadaosRouter.post('/alterar-senha', sanitizeMiddleware, postAlterarSenha);
cidadaosRouter.get('/acessos', getAcessos);
cidadaosRouter.delete('/', deleteConta);
cidadaosRouter.get('/notificacoes/preferencias', getPreferencias);
cidadaosRouter.put('/notificacoes/preferencias', sanitizeMiddleware, putPreferencias);

export default cidadaosRouter;
