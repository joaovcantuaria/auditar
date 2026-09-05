import { Badge } from '@/components/ui';
import { formatarDataHora } from './helpers';
import type { MovimentacaoResumo } from './api';

/**
 * Aba Movimentações/Histórico do Detalhe Administrativo (Task 15.2, Req 11.1).
 *
 * Lista TODAS as movimentações do Processo em ordem cronológica crescente
 * (como retornadas pelo backend), incluindo as observações internas E públicas
 * — o Servidor vê ambas (Req 11.4/11.5). Cada item mostra a data/hora, o
 * servidor responsável, o tipo de observação (quando houver) e o texto.
 *
 * Recebe as movimentações já carregadas pelo detalhe do Processo
 * (`queryKeys.processo(id)`), evitando uma segunda requisição.
 */
export interface HistoricoTabProps {
  movimentacoes: MovimentacaoResumo[];
}

/** Rótulo legível do tipo de observação. */
function rotuloTipo(tipo: string | null): string {
  if (tipo === 'interna') return 'Observação interna';
  if (tipo === 'publica') return 'Observação pública';
  return 'Movimentação';
}

/** Cor do Badge conforme o tipo de observação. */
function corBadge(tipo: string | null): 'yellow' | 'blue' | 'neutral' {
  if (tipo === 'interna') return 'yellow';
  if (tipo === 'publica') return 'blue';
  return 'neutral';
}

export function HistoricoTab({ movimentacoes }: HistoricoTabProps) {
  if (movimentacoes.length === 0) {
    return (
      <p className="text-sm text-text-secondary">
        Ainda não há movimentações registradas neste processo.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-3">
      {movimentacoes.map((mov, indice) => (
        <li
          key={`${mov.realizadoEm}-${indice}`}
          className="rounded-card border border-neutral/50 bg-white p-3"
        >
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge color={corBadge(mov.tipoObservacao)}>
                {rotuloTipo(mov.tipoObservacao)}
              </Badge>
              <span className="text-sm font-medium text-text-primary">
                {mov.servidor?.nome ?? 'Sistema'}
              </span>
            </div>
            <span className="text-xs text-text-secondary">
              {formatarDataHora(mov.realizadoEm)}
            </span>
          </div>
          {mov.observacao ? (
            <p className="whitespace-pre-wrap text-sm text-text-primary">{mov.observacao}</p>
          ) : (
            <p className="text-sm text-text-secondary">Sem observação.</p>
          )}
        </li>
      ))}
    </ol>
  );
}

export default HistoricoTab;
