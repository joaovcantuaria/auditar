import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { StatusProcesso } from '@auditar/shared';
import { Alert, Button, DatePicker, Pagination, Select, Spinner, StatusBadge } from '@/components/ui';
import { STATUS_LABEL_MAP } from '@/components/ui/StatusBadge';
import { axiosInstance } from '@/lib/axiosInstance';
import { queryKeys } from '@/hooks/useSocket';

/**
 * Painel pessoal do Cidadão — lista de "Meus Processos" (Req. 3).
 *
 * Consome `GET /api/v1/processos` (o cliente axios usa o prefixo `/api/v1`, então
 * a chamada é `/processos`). A resposta vem sob `{ data }` como uma lista de
 * linhas resumidas do backend (`listarDoCidadao`) com os campos EXATOS:
 *   `{ protocolo, categoria, tipoProcesso, abertoEm, status, prazoFinal }`.
 *
 * A query usa a key `queryKeys.processos()` (`['processos']`) para que os
 * eventos de Socket.io (`processo:status_atualizado`, `processo:atribuido`,
 * `processo:etapa_avancada`) tratados em `useSocket` invalidem automaticamente
 * esta lista e disparem um refetch em tempo real (Req. 3.6).
 *
 * Filtros:
 *  - status e período de abertura (`periodoInicio`/`periodoFim`) são enviados
 *    ao backend como query params (suportados por `filtroProcessoCidadaoSchema`)
 *    e fazem parte da queryKey, então mudá-los refaz o fetch.
 *  - categoria: o backend filtra por `categoriaId`, mas não há endpoint público
 *    de categorias para o Cidadão; portanto derivamos as categorias a partir
 *    dos próprios processos retornados e aplicamos o filtro no cliente, por
 *    NOME de categoria. É uma escolha consciente para manter uma UX de seleção
 *    (em vez de exigir um id cru) sem depender de um endpoint inexistente.
 *
 * Ações:
 *  - Botão "Novo Processo" (→ `/processos/novo`) no topo, visível sem rolagem
 *    (Req. 3.5), e também no estado vazio (Req. 3.8).
 *  - Cada linha leva ao detalhe do Processo em `/processos/:id` (tarefa 13.3).
 *
 * _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_
 */

// ---------------------------------------------------------------------------
// Tipos da resposta do backend (`GET /api/v1/processos` → `{ data }`).
// Campos EXATOS de `ProcessoResumoCidadao` (datas chegam como string ISO no JSON).
// ---------------------------------------------------------------------------

interface ProcessoResumoCidadao {
  protocolo: string;
  categoria: string | null;
  tipoProcesso: string;
  abertoEm: string;
  status: string;
  prazoFinal: string;
}

interface MeusProcessosResponse {
  data: ProcessoResumoCidadao[];
}

/** Filtros enviados ao backend (status + período de abertura). */
interface FiltrosBackend {
  status: string;
  periodoInicio: string;
  periodoFim: string;
}

const FILTROS_VAZIOS: FiltrosBackend = { status: '', periodoInicio: '', periodoFim: '' };

/** Quantidade de linhas por página (paginação no cliente). */
const PAGE_SIZE = 10;

/** Opções do Select de status a partir do enum `StatusProcesso`. */
const STATUS_OPTIONS = Object.values(StatusProcesso).map((value) => ({
  value,
  label: STATUS_LABEL_MAP[value],
}));

/** Formata uma data ISO em pt-BR (dd/mm/aaaa); string vazia se inválida. */
function formatarData(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '';
  return data.toLocaleDateString('pt-BR');
}

/** Converte o status cru vindo do backend no enum, quando reconhecido. */
function paraStatusProcesso(status: string): StatusProcesso | null {
  return (Object.values(StatusProcesso) as string[]).includes(status)
    ? (status as StatusProcesso)
    : null;
}

export function MeusProcessosPage() {
  const navigate = useNavigate();
  // Filtros aplicados ao backend (fazem parte da queryKey → refetch ao mudar).
  const [filtros, setFiltros] = useState<FiltrosBackend>(FILTROS_VAZIOS);
  // Filtro de categoria aplicado no cliente (por nome — ver docstring).
  const [categoria, setCategoria] = useState<string>('');
  const [page, setPage] = useState<number>(1);

  const query = useQuery<MeusProcessosResponse>({
    queryKey: [...queryKeys.processos(), filtros],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (filtros.status) params.status = filtros.status;
      if (filtros.periodoInicio) params.periodoInicio = filtros.periodoInicio;
      if (filtros.periodoFim) params.periodoFim = filtros.periodoFim;
      const { data } = await axiosInstance.get<MeusProcessosResponse>('/processos', { params });
      return data;
    },
  });

  const processos = query.data?.data ?? [];

  // Categorias disponíveis derivadas dos processos retornados (para o Select).
  const categoriasDisponiveis = useMemo(() => {
    const nomes = new Set<string>();
    for (const p of processos) {
      if (p.categoria) nomes.add(p.categoria);
    }
    return Array.from(nomes).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [processos]);

  // Aplica o filtro de categoria (cliente) sobre o resultado do backend.
  const processosFiltrados = useMemo(
    () => (categoria ? processos.filter((p) => p.categoria === categoria) : processos),
    [processos, categoria],
  );

  // Paginação no cliente sobre a lista filtrada.
  const totalPages = Math.max(1, Math.ceil(processosFiltrados.length / PAGE_SIZE));
  const paginaAtual = Math.min(page, totalPages);
  const processosPagina = processosFiltrados.slice(
    (paginaAtual - 1) * PAGE_SIZE,
    paginaAtual * PAGE_SIZE,
  );

  const temFiltrosAtivos =
    Boolean(filtros.status || filtros.periodoInicio || filtros.periodoFim || categoria);

  function atualizarFiltro<K extends keyof FiltrosBackend>(chave: K, valor: string): void {
    setFiltros((atual) => ({ ...atual, [chave]: valor }));
    setPage(1);
  }

  function limparFiltros(): void {
    setFiltros(FILTROS_VAZIOS);
    setCategoria('');
    setPage(1);
  }

  return (
    <section className="flex flex-col gap-6">
      {/* Cabeçalho + ação primária (visível sem rolagem — Req. 3.5). */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-text-primary">Meus Processos</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Acompanhe o andamento de todos os seus processos.
          </p>
        </div>
        <Button onClick={() => navigate('/processos/novo')}>Novo Processo</Button>
      </header>

      {/* Filtros: status + período (backend) e categoria (cliente). */}
      <form
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Filtros de processos"
        onSubmit={(event) => event.preventDefault()}
      >
        <Select
          label="Status"
          value={filtros.status}
          onChange={(event) => atualizarFiltro('status', event.target.value)}
        >
          <option value="">Todos</option>
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>

        <Select
          label="Categoria"
          value={categoria}
          onChange={(event) => {
            setCategoria(event.target.value);
            setPage(1);
          }}
          disabled={categoriasDisponiveis.length === 0}
          helperText={
            categoriasDisponiveis.length === 0 ? 'Sem categorias para filtrar' : undefined
          }
        >
          <option value="">Todas</option>
          {categoriasDisponiveis.map((nome) => (
            <option key={nome} value={nome}>
              {nome}
            </option>
          ))}
        </Select>

        <DatePicker
          label="Aberto a partir de"
          value={filtros.periodoInicio}
          max={filtros.periodoFim || undefined}
          onChange={(event) => atualizarFiltro('periodoInicio', event.target.value)}
        />

        <DatePicker
          label="Aberto até"
          value={filtros.periodoFim}
          min={filtros.periodoInicio || undefined}
          onChange={(event) => atualizarFiltro('periodoFim', event.target.value)}
        />

        {temFiltrosAtivos && (
          <div className="sm:col-span-2 lg:col-span-4">
            <Button variant="ghost" size="sm" onClick={limparFiltros}>
              Limpar filtros
            </Button>
          </div>
        )}
      </form>

      {/* Conteúdo: carregamento, erro, vazio ou tabela. */}
      {query.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" label="Carregando processos..." />
        </div>
      ) : query.isError ? (
        <Alert variant="danger" title="Não foi possível carregar seus processos">
          Tente novamente em instantes.
        </Alert>
      ) : processosFiltrados.length === 0 ? (
        <EmptyState
          comFiltros={temFiltrosAtivos}
          onLimpar={limparFiltros}
          onNovoProcesso={() => navigate('/processos/novo')}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-card border border-neutral">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">Lista dos seus processos</caption>
              <thead className="bg-bg-alt text-text-secondary">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Protocolo
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Tipo
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Aberto em
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Prazo final
                  </th>
                </tr>
              </thead>
              <tbody>
                {processosPagina.map((processo) => {
                  const statusEnum = paraStatusProcesso(processo.status);
                  return (
                    <tr
                      key={processo.protocolo}
                      className="border-t border-neutral hover:bg-bg-alt"
                    >
                      <td className="px-4 py-3">
                        <Link
                          to={`/processos/${encodeURIComponent(processo.protocolo)}`}
                          className="font-medium text-primary underline"
                        >
                          {processo.protocolo}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-text-primary">
                        <span className="block">{processo.tipoProcesso}</span>
                        {processo.categoria && (
                          <span className="block text-xs text-text-secondary">
                            {processo.categoria}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {statusEnum ? (
                          <StatusBadge status={statusEnum} />
                        ) : (
                          <span className="text-text-secondary">{processo.status}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-text-primary">
                        {formatarData(processo.abertoEm)}
                      </td>
                      <td className="px-4 py-3 text-text-primary">
                        {formatarData(processo.prazoFinal)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex justify-center">
              <Pagination page={paginaAtual} totalPages={totalPages} onPageChange={setPage} />
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Estado vazio — mantém a ação "Novo Processo" acessível (Req. 3.8).
// ---------------------------------------------------------------------------

interface EmptyStateProps {
  /** Se há filtros ativos, a mensagem orienta a limpá-los em vez de "sem processos". */
  comFiltros: boolean;
  onLimpar: () => void;
  onNovoProcesso: () => void;
}

function EmptyState({ comFiltros, onLimpar, onNovoProcesso }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-card border border-dashed border-neutral bg-bg-alt px-6 py-12 text-center">
      {comFiltros ? (
        <>
          <p className="text-text-primary">
            Nenhum processo corresponde aos filtros selecionados.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <Button variant="secondary" onClick={onLimpar}>
              Limpar filtros
            </Button>
            <Button onClick={onNovoProcesso}>Novo Processo</Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-text-primary">Você ainda não abriu nenhum processo.</p>
          <p className="text-sm text-text-secondary">
            Comece agora abrindo seu primeiro processo.
          </p>
          <Button onClick={onNovoProcesso}>Novo Processo</Button>
        </>
      )}
    </div>
  );
}

export default MeusProcessosPage;
