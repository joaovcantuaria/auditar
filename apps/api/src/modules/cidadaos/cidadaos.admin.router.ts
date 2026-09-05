import { Router } from 'express';
import { Permissao } from '@auditar/shared';
import { authenticate, requireServidor } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { getCidadaoPorCpf } from './cidadaos.admin.controller.js';

/**
 * Rotas administrativas de Cidadãos (tarefa 20.1, Req. 23.2, 23.3).
 * Montado sob `/api/v1/admin/cidadaos` pelo agregador de rotas.
 *
 *   GET /?cpf={cpf} — busca de Cidadão por CPF para a abertura de Processo
 *                     pelo Servidor
 *
 * Exige Servidor autenticado com a permissão `editar` (o nível Administrador
 * a possui na matriz RBAC), conforme o Req. 23.1.
 */
export const cidadaosAdminRouter = Router();

cidadaosAdminRouter.use(authenticate, requireServidor, requirePermission(Permissao.EDITAR));

cidadaosAdminRouter.get('/', getCidadaoPorCpf);

export default cidadaosAdminRouter;
