/**
 * Barrel de Atribuição/Reatribuição de Processos (tarefa 15.3, Requisito 12).
 *
 * Expõe os modais autossuficientes e o hook de dados para que a página de
 * detalhe do processo no Painel Administrativo (tarefa 15.2) os consuma
 * diretamente:
 *
 *   import { AtribuicaoModal, ReatribuicaoModal, useAtribuicao } from
 *     '@/features/processos-admin';
 */
export { AtribuicaoModal } from './AtribuicaoModal';
export type { AtribuicaoModalProps } from './AtribuicaoModal';

export { ReatribuicaoModal } from './ReatribuicaoModal';
export type { ReatribuicaoModalProps } from './ReatribuicaoModal';

export {
  useAtribuicao,
  fetchCargas,
  postAtribuir,
  postReatribuir,
  validarJustificativa,
  extractApiError,
  cargasQueryKey,
  JUSTIFICATIVA_MIN_CHARS,
  JUSTIFICATIVA_MAX_CHARS,
} from './useAtribuicao';
export type {
  UseAtribuicaoResult,
  CargaServidorDisponivel,
  AtribuicaoResultado,
  AtribuirPayload,
  ReatribuirPayload,
  ApiError,
} from './useAtribuicao';
