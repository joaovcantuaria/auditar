import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { queryKeys } from '@/hooks/useSocket';
import {
  avancarEtapa,
  editarProcessoCorretivo,
  fetchProcessoAdmin,
  fetchTrilhaAuditoria,
  registrarObservacao,
  rejeitarProcesso,
  solicitarDocumentos,
  type EdicaoCorretivaInput,
  type EdicaoCorretivaResultado,
  type ProcessoTramitacaoDetalhe,
  type ProcessoTramitacaoResumo,
  type RegistrarObservacaoInput,
  type ObservacaoCriada,
  type TrilhaAuditoriaItem,
} from './api';

/**
 * Hook de dados da tela de Detalhe do Processo no Painel Administrativo
 * (Task 15.2, Req 11).
 *
 * Encapsula a query de detalhe (`queryKeys.processo(id)`) e as quatro mutações
 * de tramitação (avançar, rejeitar, solicitar documentos, registrar
 * observação). Toda mutação bem-sucedida invalida `queryKeys.processo(id)` —
 * a MESMA key alvo dos eventos de socket (`processo:status_atualizado`,
 * `processo:etapa_avancada`) em `useSocket` — de modo que o detalhe se atualiza
 * em tempo real, sem reload.
 *
 * As mutações NÃO tratam erro internamente: o componente consumidor lê
 * `mutation.error` e o exibe via `Alert` (inclui o 403 com mensagem
 * orientativa custom da rejeição — Req 11.7 — e os erros
 * `AUDITORIA_FALHA` (500) / `PROCESSO_ENCERRADO` (400) — Req 11.9).
 *
 * _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.9_
 */
export interface UseProcessoAdminResult {
  detalheQuery: UseQueryResult<ProcessoTramitacaoDetalhe>;
  /** Trilha de auditoria unificada do Processo (Task 28.1, Req 24.2). */
  trilhaQuery: UseQueryResult<TrilhaAuditoriaItem[]>;
  avancarMutation: UseMutationResult<ProcessoTramitacaoResumo, unknown, { observacao?: string }>;
  rejeitarMutation: UseMutationResult<ProcessoTramitacaoResumo, unknown, { motivo: string }>;
  solicitarDocsMutation: UseMutationResult<
    ProcessoTramitacaoResumo,
    unknown,
    { documentos: string[] }
  >;
  observacaoMutation: UseMutationResult<ObservacaoCriada, unknown, RegistrarObservacaoInput>;
  /** Edição corretiva (prioridade e/ou respostas) (Task 28.2, Req 24.4). */
  edicaoCorretivaMutation: UseMutationResult<
    EdicaoCorretivaResultado,
    unknown,
    EdicaoCorretivaInput
  >;
}

/** Query-key da trilha de auditoria de um Processo. */
export function trilhaAuditoriaQueryKey(
  processoId: string,
): readonly [string, string, 'auditoria'] {
  return ['processo', processoId, 'auditoria'] as const;
}

export function useProcessoAdmin(processoId: string): UseProcessoAdminResult {
  const queryClient = useQueryClient();

  const detalheQuery = useQuery<ProcessoTramitacaoDetalhe>({
    queryKey: queryKeys.processo(processoId),
    queryFn: () => fetchProcessoAdmin(processoId),
    enabled: processoId.length > 0,
  });

  const trilhaQuery = useQuery<TrilhaAuditoriaItem[]>({
    queryKey: trilhaAuditoriaQueryKey(processoId),
    queryFn: () => fetchTrilhaAuditoria(processoId),
    enabled: processoId.length > 0,
  });

  /** Invalida o detalhe (e as listas que o contêm) após qualquer ação de tramitação. */
  function invalidarDetalhe(): void {
    void queryClient.invalidateQueries({ queryKey: queryKeys.processo(processoId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.processos() });
    // A trilha reflete toda ação de tramitação/edição — reflete na aba (Req 24.2).
    void queryClient.invalidateQueries({ queryKey: trilhaAuditoriaQueryKey(processoId) });
  }

  const avancarMutation = useMutation<ProcessoTramitacaoResumo, unknown, { observacao?: string }>({
    mutationFn: ({ observacao }) => avancarEtapa(processoId, observacao),
    onSuccess: invalidarDetalhe,
  });

  const rejeitarMutation = useMutation<ProcessoTramitacaoResumo, unknown, { motivo: string }>({
    mutationFn: ({ motivo }) => rejeitarProcesso(processoId, motivo),
    onSuccess: invalidarDetalhe,
  });

  const solicitarDocsMutation = useMutation<
    ProcessoTramitacaoResumo,
    unknown,
    { documentos: string[] }
  >({
    mutationFn: ({ documentos }) => solicitarDocumentos(processoId, documentos),
    onSuccess: invalidarDetalhe,
  });

  const observacaoMutation = useMutation<ObservacaoCriada, unknown, RegistrarObservacaoInput>({
    mutationFn: (input) => registrarObservacao(processoId, input),
    onSuccess: invalidarDetalhe,
  });

  const edicaoCorretivaMutation = useMutation<
    EdicaoCorretivaResultado,
    unknown,
    EdicaoCorretivaInput
  >({
    mutationFn: (input) => editarProcessoCorretivo(processoId, input),
    onSuccess: invalidarDetalhe,
  });

  return {
    detalheQuery,
    trilhaQuery,
    avancarMutation,
    rejeitarMutation,
    solicitarDocsMutation,
    observacaoMutation,
    edicaoCorretivaMutation,
  };
}

export default useProcessoAdmin;
