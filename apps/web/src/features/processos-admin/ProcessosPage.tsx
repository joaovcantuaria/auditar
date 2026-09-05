import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { Permissao, StatusProcesso } from '@auditar/shared';
import type { PaginatedResult } from '@auditar/shared';
import { useAuthStore } from '@/store/authStore';
import {
  Alert,
  Button,
  DatePicker,
  Input,
  Pagination,
  Select,
  Spinner,
  StatusBadge,
} from '@/components/ui';
import { axiosInstance } from '@/lib/axiosInstance';
import { queryKeys } from '@/hooks/useSocket';

/**
 * Listagem e busca de processos do Painel Administrativo (tarefa 15.1, Req. 10).
 *
 * Requisitos cobertos:
 * - 10.1 Listagem paginada com 20 processos por página.
 * - 10.2 Filtros combináveis simultâneos (status, categoria, tipo, unidade,
 *        servidor responsável, nome/CPF do cidadão, intervalo de abertura,
 *        intervalo de prazo, prioridade).
 * - 10.3 Ordenação por qualquer coluna exibida (crescente/decrescente).
 * - 10.4 Colunas: protocolo, cidadão, categoria, tipo, status (+cor), prazo,
 *        servidor responsável e data da última movimentação.
 * - 10.5 Busca rápida (≥3 caracteres) parcial e case-insensitive em
 *        protocolo/nome/CPF.
 * - 10.6 Termo com <3 caracteres exibe mensagem orientativa e não consulta.
 * - 10.7 Exibição dos filtros ativos + botão "Limpar todos".
 * - 10.8 Resultado vazio exibe a mensagem retornada pelo backend.
 *
 * Contrato do backend (lido de `processos.admin.controller.ts`,
 * `processos.admin.service.ts` e `processos.admin.router.ts`; baseURL `/api/v1`):
 * - `GET /admin/processos` → `PaginatedResult<ProcessoListaItem>`
 *   `{ data: ProcessoListaItem[], meta: { total, page, pageSize, totalPages } }`.
 *   Item da lista:
 *     `{ protocolo, cidadao, categoria, tipoProcesso, status, statusCor,
 *        prazoFinal, servidorResponsavel, ultimaMovimentacao }`.
 *   Filtros (query string): `categoriaId`, `tipoProcessoId`, `status`,
 *     `dataAberturaInicio`, `dataAberturaFim`, `prazoInicio`, `prazoFim`,
 *     `servidorResponsavelId`, `nomeCidadao`, `cpfCidadao`, `unidadeId`,
 *     `prioridade`.
 *   Paginação: `page`, `pageSize`.
 *   Ordenação: `ordenarPor` ∈ (protocolo|cidadao|tipo|status|abertoEm|
 *     prazoFinal|servidor) + `direcao` ∈ (asc|desc).
 *   Busca rápida: `q` (≥3 caracteres). Quando `q` está presente, o backend
 *     ignora os demais filtros e devolve a busca rápida.
 *   Resultado vazio: o corpo inclui um campo `mensagem` (Req. 10.8).
 *
 * NOTA sobre filtros por relação (categoria/tipo/unidade/servidor): o backend
 * espera identificadores (`categoriaId`, `tipoProcessoId`, `unidadeId`,
 * `servidorResponsavelId`). As telas de configuração e de servidores que
 * expõem essas listas são implementadas por tarefas concorrentes (grupos
 * 15.3/16.x); enquanto não há um endpoint estável para popular os selects,
 * estes filtros usam campos de identificador. O filtro de status usa o enum
 * `StatusProcesso` compartilhado (valores conhecidos e estáveis).
 */

/** Tamanho de página fixo da listagem administrativa (Req. 10.1). */
const PAGE_SIZE = 20;

/** Mínimo de caracteres exigido para acionar a busca rápida (Req. 10.5/10.6). */
const BUSCA_MIN_CHARS = 3;

/** Mensagem orientativa quando o termo de busca é curto demais (Req. 10.6). */
const MSG_BUSCA_CURTA = 'Informe no mínimo 3 caracteres para realizar a busca rápida.';

/** Atraso do debounce da busca rápida (ms). */
const DEBOUNCE_MS = 350;

/**
 * Linha da listagem administrativa retornada por `GET /admin/processos`.
 * Campos idênticos ao `ProcessoListaItem` do backend
 * (`processos.admin.service.ts`). Datas chegam como ISO string no JSON.
 */
interface ProcessoListaItem {
  protocolo: string;
  cidadao: string;
  categoria: string | null;
  tipoProcesso: string;
  status: string;
  statusCor: string;
  prazoFinal: string;
  servidorResponsavel: string | null;
  ultimaMovimentacao: string;
}

/**
 * `PaginatedResult` acrescido do campo opcional `mensagem`, incluído pelo
 * backend quando não há resultados (Req. 10.8).
 */
type ProcessosResponse = PaginatedResult<ProcessoListaItem> & { mensagem?: string };

/** Formato de erro padronizado da API (`{ error, code, field? }`). */
interface ApiError {
  error: string;
  code: string;
  field?: string;
}

/** Colunas ordenáveis expostas pelo backend (Req. 10.3). */
type OrdenarPor =
  | 'protocolo'
  | 'cidadao'
  | 'tipo'
  | 'status'
  | 'abertoEm'
  | 'prazoFinal'
  | 'servidor';

type Direcao = 'asc' | 'desc';

interface Ordenacao {
  ordenarPor: OrdenarPor;
  direcao: Direcao;
}

/** Ordenação padrão: mais recentes primeiro (espelha o padrão do backend). */
const ORDENACAO_PADRAO: Ordenacao = { ordenarPor: 'abertoEm', direcao: 'desc' };

/**
 * Estado dos filtros do formulário. Strings vazias representam "sem filtro" e
 * são omitidas dos parâmetros de consulta.
 */
interface FiltrosState {
  status: string;
  categoriaId: string;
  tipoProcessoId: string;
  unidadeId: string;
  servidorResponsavelId: string;
  nomeCidadao: string;
  cpfCidadao: string;
  dataAberturaInicio: string;
  dataAberturaFim: string;
  prazoInicio: string;
  prazoFim: string;
  prioridade: string;
}

const FILTROS_VAZIOS: FiltrosState = {
  status: '',
  categoriaId: '',
  tipoProcessoId: '',
  unidadeId: '',
  servidorResponsavelId: '',
  nomeCidadao: '',
  cpfCidadao: '',
  dataAberturaInicio: '',
  dataAberturaFim: '',
  prazoInicio: '',
  prazoFim: '',
  prioridade: '',
};

/** Rótulo legível de cada filtro para o resumo de filtros ativos (Req. 10.7). */
const ROTULO_FILTRO: Record<keyof FiltrosState, string> = {
  status: 'Status',
  categoriaId: 'Categoria',
  tipoProcessoId: 'Tipo',
  unidadeId: 'Unidade',
  servidorResponsavelId: 'Servidor',
  nomeCidadao: 'Nome do cidadão',
  cpfCidadao: 'CPF do cidadão',
  dataAberturaInicio: 'Aberto de',
  dataAberturaFim: 'Aberto até',
  prazoInicio: 'Prazo de',
  prazoFim: 'Prazo até',
  prioridade: 'Prioridade',
};

/** Opções do select de status a partir do enum compartilhado. */
const OPCOES_STATUS: Array<{ label: string; value: string }> = [
  { label: 'Todos', value: '' },
  { label: 'Aberto', value: StatusProcesso.ABERTO },
  { label: 'Em andamento', value: StatusProcesso.EM_ANDAMENTO },
  { label: 'Aguardando documentos', value: StatusProcesso.AGUARDANDO_DOCS },
  { label: 'Aguardando cidadão', value: StatusProcesso.AGUARDANDO_CIDADAO },
  { label: 'Vencido', value: StatusProcesso.VENCIDO },
  { label: 'Aprovado', value: StatusProcesso.APROVADO },
  { label: 'Rejeitado', value: StatusProcesso.REJEITADO },
  { label: 'Finalizado', value: StatusProcesso.FINALIZADO },
];

/** Rótulo legível de um valor de status para o resumo de filtros. */
function rotuloStatus(valor: string): string {
  return OPCOES_STATUS.find((o) => o.value === valor)?.label ?? valor;
}

/** Definição das colunas ordenáveis da tabela (Req. 10.3/10.4). */
const COLUNAS: Array<{ chave: OrdenarPor; titulo: string }> = [
  { chave: 'protocolo', titulo: 'Protocolo' },
  { chave: 'cidadao', titulo: 'Cidadão' },
  { chave: 'status', titulo: 'Status' },
  { chave: 'prazoFinal', titulo: 'Prazo final' },
  { chave: 'servidor', titulo: 'Servidor responsável' },
];

/** Extrai a mensagem de erro da API de forma segura, com fallback amigável. */
function extractApiError(err: unknown): string {
  if (err instanceof AxiosError && err.response?.data) {
    const data = err.response.data as Partial<ApiError>;
    if (typeof data.error === 'string') return data.error;
  }
  if (err instanceof Error) return err.message;
  return 'Não foi possível concluir a solicitação. Tente novamente.';
}

/** Remove entradas vazias dos filtros, produzindo apenas os pares aplicáveis. */
function filtrosAplicaveis(filtros: FiltrosState): Record<string, string> {
  const out: Record<string, string> = {};
  (Object.keys(filtros) as Array<keyof FiltrosState>).forEach((chave) => {
    const valor = filtros[chave];
    if (valor) out[chave] = valor;
  });
  return out;
}

/** Formata uma data (ISO string) no padrão pt-BR (somente data). */
function formatarData(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return iso;
  return data.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Verifica se um valor de status corresponde ao enum `StatusProcesso`, para
 * renderizar o `StatusBadge` com segurança de tipos. Status desconhecidos
 * (dados legados) caem em um badge textual neutro.
 */
function comoStatusProcesso(status: string): StatusProcesso | null {
  const valores = Object.values(StatusProcesso) as string[];
  return valores.includes(status) ? (status as StatusProcesso) : null;
}

/** Indica se um ordenarPor está ativo e retorna o `aria-sort` correspondente. */
function ariaSort(ordenacao: Ordenacao, chave: OrdenarPor): 'ascending' | 'descending' | 'none' {
  if (ordenacao.ordenarPor !== chave) return 'none';
  return ordenacao.direcao === 'asc' ? 'ascending' : 'descending';
}

export function ProcessosPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  /** Abertura de processo pelo servidor exige a permissão `editar` (Req 23.1). */
  const podeAbrirProcesso = hasPermission(Permissao.EDITAR);

  /** Filtros em edição no formulário (ainda não aplicados). */
  const [rascunho, setRascunho] = useState<FiltrosState>(FILTROS_VAZIOS);
  /** Filtros efetivamente aplicados que alimentam a query. */
  const [filtros, setFiltros] = useState<FiltrosState>(FILTROS_VAZIOS);
  /** Termo digitado na busca rápida (bruto). */
  const [buscaInput, setBuscaInput] = useState('');
  /** Termo de busca após debounce (o que efetivamente vai para a query). */
  const [buscaDebounced, setBuscaDebounced] = useState('');
  /** Ordenação atual (Req. 10.3). */
  const [ordenacao, setOrdenacao] = useState<Ordenacao>(ORDENACAO_PADRAO);
  /** Página atual (1-based). */
  const [page, setPage] = useState(1);

  // Debounce leve do termo de busca rápida (Req. 10.5).
  useEffect(() => {
    const handle = window.setTimeout(() => setBuscaDebounced(buscaInput.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [buscaInput]);

  const paramsFiltros = useMemo(() => filtrosAplicaveis(filtros), [filtros]);

  /** Filtros ativos como pares [chave, valor] para o resumo (Req. 10.7). */
  const filtrosAtivos = useMemo(
    () => Object.entries(paramsFiltros) as Array<[keyof FiltrosState, string]>,
    [paramsFiltros],
  );

  // Busca rápida só é acionada com >=3 caracteres (Req. 10.5/10.6). Enquanto
  // ativa, o backend ignora os demais filtros — então não os enviamos.
  const buscaAtiva = buscaDebounced.length >= BUSCA_MIN_CHARS;
  const buscaCurta = buscaDebounced.length > 0 && buscaDebounced.length < BUSCA_MIN_CHARS;

  const params: Record<string, string | number> = buscaAtiva
    ? { q: buscaDebounced, page, pageSize: PAGE_SIZE }
    : {
        ...paramsFiltros,
        ordenarPor: ordenacao.ordenarPor,
        direcao: ordenacao.direcao,
        page,
        pageSize: PAGE_SIZE,
      };

  const listaQuery = useQuery<ProcessosResponse>({
    queryKey: [
      ...queryKeys.processos(),
      buscaAtiva ? 'busca' : 'lista',
      buscaAtiva ? buscaDebounced : paramsFiltros,
      buscaAtiva ? null : ordenacao,
      page,
    ],
    queryFn: async () => {
      const { data } = await axiosInstance.get<ProcessosResponse>('/admin/processos', {
        params,
      });
      return data;
    },
    placeholderData: keepPreviousData,
  });

  /** Aplica os filtros do rascunho, voltando à primeira página (Req. 10.2). */
  function aplicarFiltros(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFiltros(rascunho);
    setPage(1);
  }

  /** Limpa todos os filtros e a busca rápida (Req. 10.7). */
  function limparTudo() {
    setRascunho(FILTROS_VAZIOS);
    setFiltros(FILTROS_VAZIOS);
    setBuscaInput('');
    setBuscaDebounced('');
    setPage(1);
  }

  function atualizarCampo<K extends keyof FiltrosState>(campo: K, valor: FiltrosState[K]) {
    setRascunho((atual) => ({ ...atual, [campo]: valor }));
  }

  /**
   * Alterna a ordenação ao clicar num cabeçalho de coluna (Req. 10.3):
   * primeiro clique em uma coluna nova ordena ascendente; cliques subsequentes
   * alternam a direção. Volta à primeira página a cada mudança.
   */
  function alternarOrdenacao(chave: OrdenarPor) {
    setOrdenacao((atual) =>
      atual.ordenarPor === chave
        ? { ordenarPor: chave, direcao: atual.direcao === 'asc' ? 'desc' : 'asc' }
        : { ordenarPor: chave, direcao: 'asc' },
    );
    setPage(1);
  }

  const meta = listaQuery.data?.meta;
  const linhas = listaQuery.data?.data ?? [];
  const mensagemVazio = listaQuery.data?.mensagem;

  return (
    <section className="flex flex-col gap-6" aria-labelledby="processos-titulo">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 id="processos-titulo" className="font-heading text-h2 text-text-primary">
            Processos
          </h1>
          <p className="text-sm text-text-secondary">
            Listagem, filtros e busca de processos do painel administrativo.
          </p>
        </div>
        {podeAbrirProcesso && (
          <Link to="/admin/processos/novo">
            <Button>Novo processo</Button>
          </Link>
        )}
      </header>

      {/* --- Busca rápida (Req. 10.5/10.6) ---------------------------------- */}
      <div className="flex flex-col gap-1 rounded-card border border-neutral bg-white p-4">
        <Input
          label="Busca rápida"
          type="search"
          placeholder="Protocolo, nome ou CPF do cidadão"
          value={buscaInput}
          onChange={(e) => {
            setBuscaInput(e.target.value);
            setPage(1);
          }}
          helperText={
            buscaCurta ? undefined : 'A busca ignora os demais filtros enquanto estiver ativa.'
          }
          error={buscaCurta ? MSG_BUSCA_CURTA : undefined}
        />
      </div>

      {/* --- Barra de filtros (Req. 10.2) ----------------------------------- */}
      <form
        onSubmit={aplicarFiltros}
        className="grid grid-cols-1 gap-4 rounded-card border border-neutral bg-white p-4 sm:grid-cols-2 lg:grid-cols-3"
        aria-label="Filtros de processos"
      >
        <Select
          label="Status"
          value={rascunho.status}
          onChange={(e) => atualizarCampo('status', e.target.value)}
          options={OPCOES_STATUS}
          disabled={buscaAtiva}
        />
        <Input
          label="Nome do cidadão"
          value={rascunho.nomeCidadao}
          onChange={(e) => atualizarCampo('nomeCidadao', e.target.value)}
          disabled={buscaAtiva}
        />
        <Input
          label="CPF do cidadão"
          placeholder="Somente dígitos ou com máscara"
          value={rascunho.cpfCidadao}
          onChange={(e) => atualizarCampo('cpfCidadao', e.target.value)}
          disabled={buscaAtiva}
        />
        <Input
          label="Categoria (ID)"
          value={rascunho.categoriaId}
          onChange={(e) => atualizarCampo('categoriaId', e.target.value)}
          disabled={buscaAtiva}
        />
        <Input
          label="Tipo de processo (ID)"
          value={rascunho.tipoProcessoId}
          onChange={(e) => atualizarCampo('tipoProcessoId', e.target.value)}
          disabled={buscaAtiva}
        />
        <Input
          label="Unidade (ID)"
          value={rascunho.unidadeId}
          onChange={(e) => atualizarCampo('unidadeId', e.target.value)}
          disabled={buscaAtiva}
        />
        <Input
          label="Servidor responsável (ID)"
          value={rascunho.servidorResponsavelId}
          onChange={(e) => atualizarCampo('servidorResponsavelId', e.target.value)}
          disabled={buscaAtiva}
        />
        <Input
          label="Prioridade"
          type="number"
          min={0}
          value={rascunho.prioridade}
          onChange={(e) => atualizarCampo('prioridade', e.target.value)}
          disabled={buscaAtiva}
        />
        <DatePicker
          label="Aberto de"
          value={rascunho.dataAberturaInicio}
          onChange={(e) => atualizarCampo('dataAberturaInicio', e.target.value)}
          disabled={buscaAtiva}
        />
        <DatePicker
          label="Aberto até"
          value={rascunho.dataAberturaFim}
          onChange={(e) => atualizarCampo('dataAberturaFim', e.target.value)}
          disabled={buscaAtiva}
        />
        <DatePicker
          label="Prazo de"
          value={rascunho.prazoInicio}
          onChange={(e) => atualizarCampo('prazoInicio', e.target.value)}
          disabled={buscaAtiva}
        />
        <DatePicker
          label="Prazo até"
          value={rascunho.prazoFim}
          onChange={(e) => atualizarCampo('prazoFim', e.target.value)}
          disabled={buscaAtiva}
        />

        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
          <Button type="submit" loading={listaQuery.isFetching} disabled={buscaAtiva}>
            Aplicar
          </Button>
          <Button type="button" variant="secondary" onClick={limparTudo}>
            Limpar todos
          </Button>
        </div>

        {buscaAtiva && (
          <p className="text-sm text-text-secondary sm:col-span-2 lg:col-span-3">
            Busca rápida ativa — os filtros estão desabilitados até que a busca seja limpa.
          </p>
        )}
      </form>

      {/* --- Resumo de filtros ativos (Req. 10.7) --------------------------- */}
      {!buscaAtiva && filtrosAtivos.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" aria-label="Filtros ativos">
          <span className="text-sm font-medium text-text-secondary">Filtros ativos:</span>
          {filtrosAtivos.map(([chave, valor]) => (
            <span
              key={chave}
              className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary"
            >
              {ROTULO_FILTRO[chave]}: {chave === 'status' ? rotuloStatus(valor) : valor}
            </span>
          ))}
          <Button type="button" variant="ghost" size="sm" onClick={limparTudo}>
            Limpar todos
          </Button>
        </div>
      )}

      {/* --- Resultado (Req. 10.1/10.4/10.8) -------------------------------- */}
      {listaQuery.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" label="Carregando processos..." />
        </div>
      ) : listaQuery.isError ? (
        <Alert variant="danger" title="Não foi possível carregar os processos">
          {extractApiError(listaQuery.error)}
        </Alert>
      ) : linhas.length === 0 ? (
        <Alert variant="info" title="Nenhum processo encontrado">
          {mensagemVazio ?? 'Ajuste os filtros ou o termo de busca para localizar processos.'}
        </Alert>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="overflow-x-auto rounded-card border border-neutral bg-white">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">
                Lista de processos. Clique nos cabeçalhos de coluna para ordenar.
              </caption>
              <thead>
                <tr className="border-b border-neutral bg-bg-alt text-text-secondary">
                  {COLUNAS.map((coluna) => (
                    <th
                      key={coluna.chave}
                      scope="col"
                      className="px-3 py-2 font-medium"
                      aria-sort={ariaSort(ordenacao, coluna.chave)}
                    >
                      <button
                        type="button"
                        onClick={() => alternarOrdenacao(coluna.chave)}
                        className="inline-flex items-center gap-1 rounded-btn px-1 font-medium text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {coluna.titulo}
                        <span aria-hidden="true" className="text-xs">
                          {ordenacao.ordenarPor === coluna.chave
                            ? ordenacao.direcao === 'asc'
                              ? '▲'
                              : '▼'
                            : '↕'}
                        </span>
                      </button>
                    </th>
                  ))}
                  {/* Colunas não ordenáveis exibidas (Req. 10.4). */}
                  <th scope="col" className="px-3 py-2 font-medium">
                    Categoria
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Tipo
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Última movimentação
                  </th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((item) => {
                  const status = comoStatusProcesso(item.status);
                  return (
                    <tr key={item.protocolo} className="border-b border-neutral last:border-b-0">
                      <td className="whitespace-nowrap px-3 py-2">
                        <Link
                          to={`/admin/processos/${item.protocolo}`}
                          className="font-medium text-primary underline hover:text-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          {item.protocolo}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-text-primary">{item.cidadao}</td>
                      <td className="px-3 py-2">
                        {status ? (
                          <StatusBadge status={status} />
                        ) : (
                          <span
                            className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                            style={{ backgroundColor: `${item.statusCor}22`, color: item.statusCor }}
                          >
                            {item.status}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-text-primary">
                        {formatarData(item.prazoFinal)}
                      </td>
                      <td className="px-3 py-2 text-text-primary">
                        {item.servidorResponsavel ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-text-primary">{item.categoria ?? '—'}</td>
                      <td className="px-3 py-2 text-text-primary">{item.tipoProcesso}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-text-secondary">
                        {formatarData(item.ultimaMovimentacao)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
            <p className="text-sm text-text-secondary" aria-live="polite">
              {meta
                ? `${meta.total} processo(s) — página ${meta.page} de ${meta.totalPages}`
                : null}
            </p>
            {meta && (
              <Pagination
                page={meta.page}
                totalPages={meta.totalPages}
                onPageChange={setPage}
                ariaLabel="Paginação de processos"
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export default ProcessosPage;
