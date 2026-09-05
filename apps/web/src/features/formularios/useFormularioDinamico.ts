import { useQuery } from '@tanstack/react-query';
import type { CampoFormulario } from '@auditar/shared';
import { axiosInstance } from '@/lib/axiosInstance';
import type { FormularioApiResponse, FormularioComCampos } from './formulario.types';

/**
 * Hook que busca o Formulário Dinâmico ATIVO para um par
 * `{ tipoProcessoId, unidadeId }` via React Query, consumindo o endpoint
 * público do Portal do Cidadão:
 *
 *   GET /api/v1/formularios?tipoId=<tipoProcessoId>&unidadeId=<unidadeId>
 *
 * (baseURL do axios já é `/api/v1`, então o path relativo é `/formularios`).
 *
 * A API responde `{ data: FormularioComCampos }` (200) com os `campos` já
 * ordenados por `ordem` crescente (Req. 16.5). Quando não há formulário ativo
 * o backend responde 404 — aqui isso vira `isError`, e o consumidor (wizard)
 * deve exibir a indisponibilidade e bloquear o avanço (Req. 16.6).
 *
 * _Requirements: 16.5, 16.6_
 */

/** Path relativo (baseURL do axios = `/api/v1`). */
const FORMULARIOS_ENDPOINT = '/formularios';

/** Chaves de cache do React Query para formulários dinâmicos. */
export const formularioQueryKeys = {
  all: ['formularios'] as const,
  porTipoUnidade: (tipoProcessoId: string, unidadeId: string) =>
    ['formularios', tipoProcessoId, unidadeId] as const,
};

/** Parâmetros de identificação do formulário a carregar. */
export interface UseFormularioDinamicoParams {
  /** Id do Tipo de Processo selecionado (step 2 do wizard). */
  tipoProcessoId: string | undefined;
  /** Id da Unidade selecionada (step 3 do wizard). */
  unidadeId: string | undefined;
  /**
   * Habilita a busca. Por padrão só busca quando ambos os ids estão presentes.
   * Permite ao wizard adiar a busca até que os steps anteriores estejam prontos.
   */
  enabled?: boolean;
}

export interface UseFormularioDinamicoResult {
  /** Formulário completo (com campos ordenados), quando disponível. */
  formulario: FormularioComCampos | undefined;
  /** Campos ordenados por `ordem`; array vazio enquanto não carregado. */
  campos: CampoFormulario[];
  /** True enquanto a busca está em andamento. */
  isLoading: boolean;
  /**
   * True quando o formulário não pôde ser obtido (404 ou falha de rede).
   * O consumidor deve exibir erro + bloquear o avanço (Req. 16.6).
   */
  isError: boolean;
  /** Refaz a busca (ex.: botão "tentar novamente"). */
  refetch: () => void;
}

/** Executa a chamada HTTP e retorna o formulário com campos. */
async function fetchFormulario(
  tipoProcessoId: string,
  unidadeId: string,
): Promise<FormularioComCampos> {
  const { data } = await axiosInstance.get<FormularioApiResponse>(FORMULARIOS_ENDPOINT, {
    params: { tipoId: tipoProcessoId, unidadeId },
  });
  return data.data;
}

export function useFormularioDinamico({
  tipoProcessoId,
  unidadeId,
  enabled = true,
}: UseFormularioDinamicoParams): UseFormularioDinamicoResult {
  const habilitado = Boolean(enabled && tipoProcessoId && unidadeId);

  const query = useQuery({
    queryKey: formularioQueryKeys.porTipoUnidade(tipoProcessoId ?? '', unidadeId ?? ''),
    queryFn: () => fetchFormulario(tipoProcessoId as string, unidadeId as string),
    enabled: habilitado,
    // Indisponibilidade (404) é um estado esperado, não vale a pena reintentar.
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  return {
    formulario: query.data,
    campos: query.data?.campos ?? [],
    isLoading: habilitado && query.isLoading,
    isError: query.isError,
    refetch: () => {
      void query.refetch();
    },
  };
}

export default useFormularioDinamico;
