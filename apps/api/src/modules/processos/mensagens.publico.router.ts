import { Router } from 'express';
import { authenticate, requireCidadao, requireServidor } from '../../middleware/auth.js';
import { sanitizeMiddleware } from '../../middleware/sanitize.js';
import { postMensagemCidadao, postMensagemServidor } from './mensagens.publico.controller.js';

/**
 * Rotas de ENVIO de mensagens no canal público (Cidadão ↔ Servidor) de um
 * Processo (Task 8.1).
 *
 * Dois routers, um por perfil de ator, ambos com `{ mergeParams: true }` para
 * herdar `req.params.id` (o id do Processo) do router pai:
 *
 *   - `mensagensCidadaoRouter`  — monta em `/api/v1/processos/:id/mensagens`
 *     (Portal do Cidadão). Exige Cidadão autenticado.
 *       POST / — envia mensagem ao Servidor responsável (Req 5.5, 5.6, 13.1)
 *
 *   - `mensagensServidorRouter` — monta em `/api/v1/admin/processos/:id/mensagens`
 *     (Painel Administrativo). Exige Servidor autenticado.
 *       POST / — envia mensagem ao Cidadão (Req 13.1, 13.3, 13.7)
 *
 * A LISTAGEM (GET) de ambos os pontos é responsabilidade do router da tarefa
 * 7.3 (`processos.detalhe.router.ts`, `GET /:id/mensagens` no Portal do
 * Cidadão) e do respectivo router administrativo — este arquivo cobre
 * exclusivamente o envio (POST), para não duplicar aquele trabalho.
 *
 * Requisitos: 5.5, 5.6, 5.7, 13.1, 13.3, 13.7, 13.8
 */
export const mensagensCidadaoRouter = Router({ mergeParams: true });

mensagensCidadaoRouter.use(authenticate, requireCidadao);
mensagensCidadaoRouter.post('/', sanitizeMiddleware, postMensagemCidadao);

export const mensagensServidorRouter = Router({ mergeParams: true });

mensagensServidorRouter.use(authenticate, requireServidor);
mensagensServidorRouter.post('/', sanitizeMiddleware, postMensagemServidor);

export default mensagensCidadaoRouter;
