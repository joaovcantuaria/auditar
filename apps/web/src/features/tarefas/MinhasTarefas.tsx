import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { StatusTarefa } from '@auditar/shared';
import { Alert, Badge, Button, Spinner } from '@/components/ui';
import { queryKeys } from '@/hooks/useSocket';
import {
  alterarStatusMinhaAtribuicao,
  listarMinhasTarefas,
  STATUS_TAREFA_LABEL,
  type MinhaAtribuicaoItem,
} from './tarefas.api';

/**
 * "Minhas Tarefas" (Task 29.2, Req. 27.6, 27.7).
 *
 * Exibe as atribuições do servidor autenticado agrupadas por status
 * (Pendente / Em andamento / Concluída) e permite mover o status da PRÓPRIA
 * atribuição via `PATCH /admin/tarefas/:id/atribuicoes/minha`.
 *
 * Consome `GET /admin/tarefas/minhas` (retorno já agrupado por status). A
 * atualização em tempo real é garantida pelo `useSocket` (montado no AppShell),
 * que invalida `queryKeys.tarefas()` — chave-pai de `queryKeys.minhasTarefas()`
 * — ao receber qualquer evento `tarefa:*`.
 *
 * Integrado à DashboardPage para todos os servidores (qualquer servidor pode
 * ter tarefas atribuídas), independentemente da permissão de gerência.
 */

/** Ordem das colunas e transições oferecidas por status. */
const COLUNAS: Array<{ status: StatusTarefa; cor: 'blue' | 'yellow' | 'green' }> = [
  { status: StatusTarefa.PENDENTE, cor: 'blue' },
  { status: StatusTarefa.EM_ANDAMENTO, cor: 'yellow' },
  { status: StatusTarefa.CONCLUIDA, cor: 'green' },
];

/** Botões de transição disponíveis a partir de cada status. */
const TRANSICOES: Record<StatusTarefa, StatusTarefa[]> = {
  [StatusTarefa.PENDENTE]: [StatusTarefa.EM_ANDAMENTO, StatusTarefa.CONCLUIDA],
  [StatusTarefa.EM_ANDAMENTO]: [StatusTarefa.CONCLUIDA, StatusTarefa.PENDENTE],
  [StatusTarefa.CONCLUIDA]: [StatusTarefa.EM_ANDAMENTO],
};

function formatarPrazo(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return iso;
  return data.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function MinhasTarefas() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.minhasTarefas(),
    queryFn: listarMinhasTarefas,
  });

  const mutation = useMutation({
    mutationFn: ({ tarefaId, status }: { tarefaId: string; status: StatusTarefa }) =>
      alterarStatusMinhaAtribuicao(tarefaId, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tarefas() });
    },
  });

  return (
    <section aria-labelledby="minhas-tarefas-titulo" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h2 id="minhas-tarefas-titulo" className="font-heading text-h3 text-text-primary">
          Minhas Tarefas
        </h2>
        {mutation.isPending && <Spinner size="sm" label="Atualizando…" />}
      </div>

      {mutation.isError && (
        <Alert variant="danger">Não foi possível atualizar o status da tarefa. Tente novamente.</Alert>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-text-secondary">
          <Spinner size="sm" /> Carregando suas tarefas…
        </div>
      ) : isError ? (
        <Alert variant="danger" title="Não foi possível carregar suas tarefas">
          <div className="mt-2">
            <Button variant="secondary" size="sm" onClick={() => void refetch()}>
              Tentar novamente
            </Button>
          </div>
        </Alert>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {COLUNAS.map(({ status, cor }) => {
            const itens = (data?.[status] ?? []) as MinhaAtribuicaoItem[];
            return (
              <div
                key={status}
                className="flex flex-col gap-3 rounded-card border border-neutral/30 bg-white p-4"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-text-primary">
                    {STATUS_TAREFA_LABEL[status]}
                  </h3>
                  <Badge color={cor}>{itens.length}</Badge>
                </div>

                {itens.length === 0 ? (
                  <p className="text-sm text-text-secondary">Nenhuma tarefa.</p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {itens.map((atrib) => (
                      <li
                        key={atrib.id}
                        className="flex flex-col gap-2 rounded-btn border border-bg-alt p-3"
                      >
                        <div className="font-medium text-text-primary">{atrib.tarefa.titulo}</div>
                        {atrib.tarefa.descricao && (
                          <p className="text-xs text-text-secondary line-clamp-2">
                            {atrib.tarefa.descricao}
                          </p>
                        )}
                        <p className="text-xs text-text-secondary">
                          Prazo: {formatarPrazo(atrib.tarefa.prazo)}
                        </p>
                        {atrib.tarefa.processo && (
                          <Link
                            to={`/admin/processos/${atrib.tarefa.processo.id}`}
                            className="text-xs text-primary underline hover:text-primary-dark"
                          >
                            Processo {atrib.tarefa.processo.protocolo}
                          </Link>
                        )}
                        <div className="mt-1 flex flex-wrap gap-2">
                          {TRANSICOES[atrib.status].map((destino) => (
                            <Button
                              key={destino}
                              size="sm"
                              variant={destino === StatusTarefa.CONCLUIDA ? 'primary' : 'secondary'}
                              disabled={mutation.isPending}
                              onClick={() =>
                                mutation.mutate({ tarefaId: atrib.tarefaId, status: destino })
                              }
                            >
                              {destino === StatusTarefa.PENDENTE
                                ? 'Reabrir'
                                : `Marcar como ${STATUS_TAREFA_LABEL[destino].toLowerCase()}`}
                            </Button>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default MinhasTarefas;
