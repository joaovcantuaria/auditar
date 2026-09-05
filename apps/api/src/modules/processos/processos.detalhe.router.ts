import { Router } from 'express';
import { authenticate, requireCidadao } from '../../middleware/auth.js';
import {
  getProcessoDetalhe,
  getProcessoHistorico,
  getProcessoMensagensPublico,
} from './processos.detalhe.controller.js';

/**
 * Rotas de Consulta e Acompanhamento de Processo pelo Cidadão (Task 7.3).
 *
 *   GET /:id            — detalhe completo (aba Informações)
 *   GET /:id/historico  — cronologia de movimentações (aba Histórico)
 *   GET /:id/mensagens  — canal público de mensagens (aba Comunicação)
 *
 * Este router deve ser montado (pelo agregador de rotas) em
 * `/api/v1/processos`, ao lado de `processosCidadaoRouter` (tarefa 7.1, que
 * cobre `GET /` e `POST /`) e de `documentosRouter` (tarefa 7.2, montado em
 * `/:id/documentos` — aba Documentos). A composição final desses três
 * routers sob o mesmo prefixo é responsabilidade do agregador, não desta
 * tarefa.
 *
 * A aba Prazos (calendário visual) é renderizada inteiramente no frontend a
 * partir dos dados já expostos por `GET /:id` (tarefa 13.3) e não requer um
 * endpoint próprio.
 *
 * Todas as rotas exigem um Cidadão autenticado.
 *
 * Requisitos: 5.1, 5.2, 5.3, 5.4, 5.5, 5.10
 */
export const processosDetalheRouter = Router();

processosDetalheRouter.use(authenticate, requireCidadao);

processosDetalheRouter.get('/:id', getProcessoDetalhe);
processosDetalheRouter.get('/:id/historico', getProcessoHistorico);
processosDetalheRouter.get('/:id/mensagens', getProcessoMensagensPublico);

export default processosDetalheRouter;
