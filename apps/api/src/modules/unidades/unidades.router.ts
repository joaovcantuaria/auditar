import { Router } from 'express';
import { Permissao } from '@auditar/shared';
import { authenticate, requireServidor } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import {
  getUnidades,
  postUnidade,
  patchUnidade,
  deleteUnidade,
} from './unidades.controller.js';

/**
 * Rotas do CRUD de Unidades.
 * Montado sob `/api/v1/admin/config/unidades` pelo agregador de rotas.
 *
 *   GET    /        — lista Unidades           (requer VISUALIZAR)
 *   POST   /        — cria Unidade             (nível administrativo)
 *   PATCH  /:id     — edita Unidade            (nível administrativo)
 *   DELETE /:id     — desativa Unidade         (nível administrativo)
 *
 * Todas exigem servidor autenticado. As ações de configuração exigem a
 * permissão administrativa `GERENCIAR_USUARIOS`, concedida apenas ao
 * Administrador na matriz base do RBAC.
 *
 * _Requirements: 14.5, 14.6, 14.7_
 */
export const unidadesRouter = Router();

unidadesRouter.use(authenticate, requireServidor);

const requireAdmin = requirePermission(Permissao.GERENCIAR_USUARIOS);

unidadesRouter.get('/', requirePermission(Permissao.VISUALIZAR), getUnidades);
unidadesRouter.post('/', requireAdmin, postUnidade);
unidadesRouter.patch('/:id', requireAdmin, patchUnidade);
unidadesRouter.delete('/:id', requireAdmin, deleteUnidade);

export default unidadesRouter;
