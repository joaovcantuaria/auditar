import { useQuery } from '@tanstack/react-query';
import { Alert, Spinner } from '@/components/ui';
import { fetchProcessoHistorico } from './api';
import { formatarDataHora } from './helpers';

/**
 * Aba Histórico do Detalhe do Processo (Req 5.3).
 *
 * Renderiza a cronologia de movimentações em ordem crescente (data/hora,
 * responsável, ação e observação). Usa uma queryKey própria — o histórico é
 * revalidado quando o processo é atualizado via as invalidações de
 * `queryKeys.processo(id)` disparadas por eventos de socket.
 */
export interface HistoricoTabProps {
  processoId: string;
}

export function HistoricoTab({ processoId }: HistoricoTabProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['processo', processoId, 'historico'],
    queryFn: () => fetchProcessoHistorico(processoId),
  });

  if (isLoading) {
    return <Spinner label="Carregando histórico..." />;
  }

  if (isError) {
    return (
      <Alert variant="danger" title="Não foi possível carregar o histórico">
        Tente novamente em alguns instantes.
      </Alert>
    );
  }

  const itens = data ?? [];

  if (itens.length === 0) {
    return <p className="text-sm text-text-secondary">Ainda não há movimentações registradas.</p>;
  }

  return (
    <ol className="flex flex-col gap-4">
      {itens.map((item, index) => (
        <li key={`${item.data}-${index}`} className="flex gap-3">
          <div className="flex flex-col items-center" aria-hidden="true">
            <span className="mt-1 h-3 w-3 shrink-0 rounded-full bg-primary" />
            {index < itens.length - 1 && <span className="w-px flex-1 bg-neutral" />}
          </div>
          <div className="flex-1 pb-2">
            <p className="text-sm text-text-secondary">{formatarDataHora(item.data)}</p>
            <p className="text-base font-medium text-text-primary">{item.acao}</p>
            {item.responsavel && (
              <p className="text-sm text-text-secondary">Responsável: {item.responsavel}</p>
            )}
            {item.observacao && (
              <p className="mt-1 text-sm text-text-primary">{item.observacao}</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

export default HistoricoTab;
