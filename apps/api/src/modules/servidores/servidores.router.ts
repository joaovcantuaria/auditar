import { Router } from 'express';
import { Permissao } from '@auditar/shared';
import { authenticate, requireServidor } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import {
  getServidores,
  postServidor,
  getServidor,
  patchServidor,
  postDesativar,
  putPermissoes,
} from './servidores.controller.js';

/**
 * Rotas do CRUD de Servidores (Req. 21).
 * Montado sob `/api/v1/admin/servidores` pelo agregador de rotas.
 *
 *   GET    /        — lista Servidores paginados
 *   POST   /        — cadastra Servidor
 *   GET    /:id             — obtém Servidor + permissões granulares
 *   PATCH  /:id             — edita Servidor (CPF imutável)
 *   POST   /:id/desativar   — desativa Servidor (reatribui Processos + encerra sessões)
 *   PUT    /:id/permissoes  — substitui permissões granulares (auditando ant./post.)
 *
 * Todas exigem servidor autenticado e a permissão administrativa
 * `GERENCIAR_USUARIOS`, concedida apenas ao Administrador na matriz base do RBAC.
 *
 * _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5, 21.6, 21.7, 21.8, 21.9, 8.6, 8.9_
 */
export const servidoresRouter = Router();

servidoresRouter.use(authenticate, requireServidor);

const requireAdmin = requirePermission(Permissao.GERENCIAR_USUARIOS);

servidoresRouter.get('/', requireAdmin, getServidores);
servidoresRouter.post('/', requireAdmin, postServidor);
servidoresRouter.get('/:id', requireAdmin, getServidor);
servidoresRouter.patch('/:id', requireAdmin, patchServidor);
servidoresRouter.post('/:id/desativar', requireAdmin, postDesativar);
servidoresRouter.put('/:id/permissoes', requireAdmin, putPermissoes);

export default servidoresRouter;
