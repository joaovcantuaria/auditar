import { Alert, Badge, Spinner } from '@/components/ui';
import { formatarDataHora } from './helpers';
import type { TrilhaAuditoriaItem } from './api';

/**
 * Aba Trilha de Auditoria do Detalhe Administrativo (Task 28.1, Req 24.2).
 *
 * Exibe, em ordem cronológica crescente, a trilha unificada retornada por
 * `GET /admin/processos/:id/auditoria` — combinando `MovimentacaoProcesso` e
 * `AuditoriaLog`. Cada item mostra autor, ação, a transição
 * (valor anterior → posterior, quando houver) e a data/hora.
 *
 * Os dados são carregados via `trilhaQuery` do `useProcessoAdmin`, que invalida
 * a mesma query após qualquer ação de tramitação/edição corretiva — refletindo
 * as mudanças em tempo (near) real na tabela.
 *
 * _Requirements: 24.2_
 */
export interface TrilhaAuditoriaTabProps {
  itens: TrilhaAuditoriaItem[];
  isLoading: boolean;
  isError: boolean;
  erro: unknown;
}

/** Rótulo legível da origem do item da trilha. */
function rotuloOrigem(origem: TrilhaAuditoriaItem['origem']): string {
  return origem === 'movimentacao' ? 'Movimentação' : 'Auditoria';
}

/** Exibe um valor de transição, tratando ausência/nulo. */
function valorOuTraco(valor: string | null | undefined): string {
  return valor === null || valor === undefined || valor === '' ? '—' : valor;
}

export function TrilhaAuditoriaTab({ itens, isLoading, isError, erro }: TrilhaAuditoriaTabProps) {
  if (isLoading) {
    return <Spinner label="Carregando trilha de auditoria..." />;
  }

  if (isError) {
    return (
      <Alert variant="danger" title="Não foi possível carregar a trilha de auditoria">
        {erro instanceof Error ? erro.message : 'Tente novamente em instantes.'}
      </Alert>
    );
  }

  if (itens.length === 0) {
    return (
      <p className="text-sm text-text-secondary">
        Ainda não há registros na trilha de auditoria deste processo.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-card border border-neutral bg-white">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">
          Trilha de auditoria do processo em ordem cronológica.
        </caption>
        <thead>
          <tr className="border-b border-neutral bg-bg-alt text-text-secondary">
            <th scope="col" className="px-3 py-2 font-medium">
              Data/Hora
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Autor
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Ação
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Anterior → Posterior
            </th>
          </tr>
        </thead>
        <tbody>
          {itens.map((item, indice) => (
            <tr
              key={`${item.data}-${indice}`}
              className="border-b border-neutral last:border-b-0 align-top"
            >
              <td className="whitespace-nowrap px-3 py-2 text-text-secondary">
                {formatarDataHora(item.data)}
              </td>
              <td className="px-3 py-2 text-text-primary">
                <div className="flex flex-col gap-1">
                  <span>{item.autor ?? 'Sistema'}</span>
                  <Badge color={item.origem === 'movimentacao' ? 'blue' : 'neutral'}>
                    {rotuloOrigem(item.origem)}
                  </Badge>
                </div>
              </td>
              <td className="px-3 py-2 text-text-primary">{item.acao}</td>
              <td className="px-3 py-2 text-text-secondary">
                {item.valorAnterior || item.valorPosterior ? (
                  <span className="whitespace-pre-wrap break-words">
                    {valorOuTraco(item.valorAnterior)} → {valorOuTraco(item.valorPosterior)}
                  </span>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default TrilhaAuditoriaTab;
