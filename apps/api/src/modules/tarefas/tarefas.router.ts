import { Router } from 'express';
import { Permissao } from '@auditar/shared';
import { authenticate, requireServidor } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import {
  postTarefa,
  getTarefas,
  getMinhasTarefas,
  getTarefa,
  patchTarefa,
  deleteTarefa,
  patchMinhaAtribuicao,
} from './tarefas.controller.js';

/**
 * Rotas do Organizador de Tarefas da Equipe (Req. 27).
 * Montado sob `/api/v1/admin/tarefas` pelo agregador de rotas.
 *
 *   POST   /                          — cria e atribui uma Tarefa (gerenciar_tarefas/Admin)
 *   GET    /                          — lista Tarefas (filtros status/prazo/processo)
 *   GET    /minhas                    — atribuições do servidor autenticado por status
 *   GET    /:id                       — detalhe da Tarefa com atribuições
 *   PATCH  /:id                       — edita a Tarefa (gerenciar_tarefas/Admin)
 *   DELETE /:id                       — remove a Tarefa (gerenciar_tarefas/Admin)
 *   PATCH  /:id/atribuicoes/minha     — altera o status da própria atribuição
 *
 * Todas exigem servidor autenticado. A criação/edição/remoção exigem a permissão
 * `GERENCIAR_TAREFAS` (concedida ao Administrador ou via permissão granular).
 * A leitura das próprias tarefas e a mudança de status da própria atribuição
 * ficam disponíveis a qualquer Servidor autenticado (Req. 27.6, 27.7).
 *
 * _Requirements: 27.1, 27.2, 27.3, 27.4, 27.5, 27.6, 27.7, 27.10, 27.11, 27.12_
 */
export const tarefasRouter = Router();

tarefasRouter.use(authenticate, requireServidor);

const requireGerenciarTarefas = requirePermission(Permissao.GERENCIAR_TAREFAS);

tarefasRouter.post('/', requireGerenciarTarefas, postTarefa);
tarefasRouter.get('/', getTarefas);

// `/minhas` DEVE vir antes de `/:id` para não ser capturado pela rota de detalhe.
tarefasRouter.get('/minhas', getMinhasTarefas);

tarefasRouter.get('/:id', getTarefa);
tarefasRouter.patch('/:id', requireGerenciarTarefas, patchTarefa);
tarefasRouter.delete('/:id', requireGerenciarTarefas, deleteTarefa);

tarefasRouter.patch('/:id/atribuicoes/minha', patchMinhaAtribuicao);

export default tarefasRouter;
