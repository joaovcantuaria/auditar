import { calcularPrazoTotalFluxo } from '@auditar/shared';

/**
 * Módulo puro de cálculo de prazo do fluxo (Req 15.5).
 *
 * Reexporta `calcularPrazoTotalFluxo` de `@auditar/shared` e fornece um
 * resumo por etapa reutilizável pela UI (task 16.2). Não depende dos arquivos
 * do módulo de fluxos (service/router) de forma que permaneça autocontido e
 * livre de conflitos com a task 5.4.
 */

export { calcularPrazoTotalFluxo };

export interface EtapaPrazo {
  etapaId?: string;
  nome: string;
  prazosDiasUteis: number;
}

export interface ResumoPrazo {
  total: number;
  porEtapa: EtapaPrazo[];
}

/**
 * Calcula o prazo total (soma aritmética dos prazos das etapas) e devolve o
 * detalhamento por etapa preservando a ordem de entrada.
 *
 * Função pura: para as mesmas etapas retorna sempre o mesmo resultado, o que
 * permite que o frontend recalcule o total em <= 1s após qualquer alteração.
 */
export function resumoPrazoEtapas(
  etapas: ReadonlyArray<{
    id?: string;
    etapaId?: string;
    nome: string;
    prazosDiasUteis: number;
  }>,
): ResumoPrazo {
  const porEtapa = etapas.map((e) => ({
    etapaId: e.etapaId ?? e.id,
    nome: e.nome,
    prazosDiasUteis: e.prazosDiasUteis,
  }));

  return { total: calcularPrazoTotalFluxo(etapas), porEtapa };
}
