import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { NivelAcesso, Permissao, StatusTarefa } from '@auditar/shared';
import { Alert, Badge, Button, DatePicker, Select, Spinner } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { queryKeys } from '@/hooks/useSocket';
import { CriarTarefaModal } from './CriarTarefaModal';
import {
  listarTarefas,
  PRIORIDADE_LABEL,
  STATUS_TAREFA_LABEL,
  type FiltrosTarefa,
  type TarefaItem,
} from './tarefas.api';

/**
 * Página do Organizador de Tarefas (Task 29.1, Req. 27.1-27.5, 27.10-27.12).
 *
 * - Lista as tarefas com filtros por status, intervalo de prazo e vínculo a
 *   Processo.
 * - Botão "Nova Tarefa" visível apenas para quem possui a permissão
 *   `GERENCIAR_TAREFAS` ou é Administrador.
 * - Tarefas vinculadas a Processo exibem o protocolo com link para
 *   `/admin/processos/:id`.
 * - Atualização em tempo real via `useSocket` (eventos `tarefa:*` invalidam
 *   `queryKeys.tarefas()`), montado no AppShell.
 */

/** Cor do Badge por status de tarefa. */
const STATUS_COLOR: Record<StatusTarefa, 'blue' | 'yellow' | 'green'> = {
  [StatusTarefa.PENDENTE]: 'blue',
  [StatusTarefa.EM_ANDAMENTO]: 'yellow',
  [StatusTarefa.CONCLUIDA]: 'green',
};

/** Formata uma data/hora ISO para exibição em pt-BR. */
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

/** Converte `YYYY-MM-DD` do DatePicker num ISO de início/fim do dia. */
function dateInicioDia(valor: string): string | undefined {
  if (!valor) return undefined;
  return new Date(`${valor}T00:00:00`).toISOString();
}
function dateFimDia(valor: string): string | undefined {
  if (!valor) return undefined;
  return new Date(`${valor}T23:59:59`).toISOString();
}

export function TarefasPage() {
  const user = useAuthStore((s) => s.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const podeGerenciar =
    hasPermission(Permissao.GERENCIAR_TAREFAS) || user?.nivel === NivelAcesso.ADMINISTRADOR;

  const [status, setStatus] = useState<string>('');
  const [de, setDe] = useState<string>('');
  const [ate, setAte] = useState<string>('');
  const [processoId, setProcessoId] = useState<string>('');
  const [criarAberto, setCriarAberto] = useState(false);

  const filtros: FiltrosTarefa = {
    status: (status || undefined) as StatusTarefa | undefined,
    prazoDe: dateInicioDia(de),
    prazoAte: dateFimDia(ate),
    processoId: processoId.trim() || undefined,
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [...queryKeys.tarefas(), filtros],
    queryFn: () => listarTarefas(filtros),
  });

  const tarefas: TarefaItem[] = data ?? [];

  const temFiltros = Boolean(status || de || ate || processoId);

  function limparFiltros(): void {
    setStatus('');
    setDe('');
    setAte('');
    setProcessoId('');
  }

  return (
    <section aria-labelledby="tarefas-titulo" className="flex flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 id="tarefas-titulo" className="font-heading text-h2 text-text-primary">
            Tarefas
          </h1>
          <p className="text-sm text-text-secondary">
            Organize e acompanhe as tarefas da equipe.
          </p>
        </div>
        {podeGerenciar && <Button onClick={() => setCriarAberto(true)}>Nova Tarefa</Button>}
      </header>

      {/* Filtros */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          label="Status"
          placeholder="Todos os status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Todos os status</option>
          {Object.values(StatusTarefa).map((s) => (
            <option key={s} value={s}>
              {STATUS_TAREFA_LABEL[s]}
            </option>
          ))}
        </Select>
        <DatePicker label="Prazo de" value={de} max={ate || undefined} onChange={(e) => setDe(e.target.value)} />
        <DatePicker label="Prazo até" value={ate} min={de || undefined} onChange={(e) => setAte(e.target.value)} />
        <div className="flex flex-col gap-1">
          <label htmlFor="filtro-processo" className="text-sm font-medium text-text-primary">
            Processo vinculado
          </label>
          <input
            id="filtro-processo"
            placeholder="ID do processo"
            value={processoId}
            onChange={(e) => setProcessoId(e.target.value)}
            className="w-full min-h-touch rounded-btn border border-neutral bg-white px-3 py-2 text-base text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>
      </div>

      {temFiltros && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={limparFiltros}>
            Limpar filtros
          </Button>
        </div>
      )}

      {/* Lista */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-text-secondary">
          <Spinner size="sm" /> Carregando tarefas…
        </div>
      ) : isError ? (
        <Alert variant="danger" title="Não foi possível carregar as tarefas">
          <div className="mt-2">
            <Button variant="secondary" size="sm" onClick={() => void refetch()}>
              Tentar novamente
            </Button>
          </div>
        </Alert>
      ) : tarefas.length === 0 ? (
        <Alert variant="info">Nenhuma tarefa encontrada para os filtros selecionados.</Alert>
      ) : (
        <div className="overflow-x-auto rounded-card border border-bg-alt">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Lista de tarefas</caption>
            <thead>
              <tr className="bg-bg-alt text-left text-text-secondary">
                <th scope="col" className="px-4 py-3 font-medium">Título</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 font-medium">Prioridade</th>
                <th scope="col" className="px-4 py-3 font-medium">Prazo</th>
                <th scope="col" className="px-4 py-3 font-medium">Destinatários</th>
                <th scope="col" className="px-4 py-3 font-medium">Processo</th>
              </tr>
            </thead>
            <tbody>
              {tarefas.map((t) => (
                <tr key={t.id} className="border-t border-bg-alt align-top">
                  <td className="px-4 py-3 text-text-primary">
                    <div className="font-medium">{t.titulo}</div>
                    {t.descricao && (
                      <p className="mt-1 max-w-md text-xs text-text-secondary line-clamp-2">
                        {t.descricao}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge color={STATUS_COLOR[t.status]}>{STATUS_TAREFA_LABEL[t.status]}</Badge>
                  </td>
                  <td className="px-4 py-3 text-text-primary">
                    {t.prioridade == null ? '—' : PRIORIDADE_LABEL[t.prioridade] ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-text-primary">{formatarPrazo(t.prazo)}</td>
                  <td className="px-4 py-3 text-text-primary">{t.atribuicoes?.length ?? 0}</td>
                  <td className="px-4 py-3">
                    {t.processo ? (
                      <Link
                        to={`/admin/processos/${t.processo.id}`}
                        className="text-primary underline hover:text-primary-dark"
                      >
                        {t.processo.protocolo}
                      </Link>
                    ) : (
                      <span className="text-text-secondary">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {criarAberto && (
        <CriarTarefaModal
          onClose={() => setCriarAberto(false)}
          onSuccess={() => setCriarAberto(false)}
        />
      )}
    </section>
  );
}

export default TarefasPage;
