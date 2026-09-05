import { Router } from 'express';
import { Permissao } from '@auditar/shared';
import { authenticate, requireServidor } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { sanitizeMiddleware } from '../../middleware/sanitize.js';
import { getMensagensInternas, postMensagemInterna } from './mensagens.interno.controller.js';

/**
 * Rotas do canal de mensagens internas (Servidor ↔ Servidor) de um Processo
 * (Task 8.2).
 *
 * Deve ser montado (por um futuro agregador de rotas) em
 * `/api/v1/admin/processos/:id/mensagens/internas`, com `{ mergeParams: true }`
 * para herdar `req.params.id` (o id do Processo) do router pai — mesmo padrão
 * de `mensagens.publico.router.ts`/`documentos.router.ts`.
 *
 *   GET  / — lista as mensagens internas do Processo (Req 13.2)
 *   POST / — envia uma nova mensagem interna (Req 13.2, 13.5, 13.6, 13.8)
 *
 * RBAC: não existe uma permissão dedicada de "mensagens internas" no enum
 * `Permissao` (`packages/shared/src/constants/index.ts`) — adicionar uma
 * exigiria alterar o pacote compartilhado, usado por diversas tarefas já
 * concluídas, o que está fora do escopo desta tarefa. `OBSERVACAO_INTERNA` é
 * o encaixe semântico mais próximo já existente (visibilidade restrita a
 * Servidores, mesmas linhas da matriz RBAC que já cobrem os perfis certos:
 * Administrador, Gestor_de_Unidade, Analista, Inspetor, Gestor_de_Categoria)
 * — reutilizada deliberadamente aqui.
 *
 * Requisitos: 13.2, 13.4, 13.5, 13.6, 13.8
 */
export const mensagensInternoRouter = Router({ mergeParams: true });

mensagensInternoRouter.use(authenticate, requireServidor, requirePermission(Permissao.OBSERVACAO_INTERNA));

mensagensInternoRouter.get('/', getMensagensInternas);
mensagensInternoRouter.post('/', sanitizeMiddleware, postMensagemInterna);

export default mensagensInternoRouter;
