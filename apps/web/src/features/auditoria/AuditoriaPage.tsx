import { useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import type { PaginatedResult } from '@auditar/shared';
import {
  Alert,
  Badge,
  Button,
  DatePicker,
  Input,
  Pagination,
  Select,
  Spinner,
  Tooltip,
} from '@/components/ui';
import { axiosInstance } from '@/lib/axiosInstance';

/**
 * Página de Auditoria do Painel Administrativo (tarefa 17.3).
 *
 * Requisitos:
 * - 17.2 Log paginado (≤100 registros/página) com filtros; resultado em ≤5s.
 * - 17.4 Filtros combináveis: data/hora (início/fim), tipo de ação,
 *        servidor/cidadão (ator + atorId), protocolo, módulo.
 * - 17.5 Exportação CSV/PDF com acompanhamento de status (job em background).
 * - 17.7 SOMENTE LEITURA: nenhum controle de criação, edição ou exclusão em
 *        nenhum ponto desta página.
 *
 * Contratos do backend (lidos de `auditoria.controller.ts` +
 * `auditoria.query.service.ts` + `auditoria.router.ts`, baseURL `/api/v1`):
 * - `GET /admin/auditoria` → `PaginatedResult<AuditoriaLogItem>`
 *   `{ data: AuditoriaLogItem[], meta: { total, page, pageSize, totalPages } }`.
 *   Query params: `dataInicio`, `dataFim`, `tipoAcao`, `ator`, `atorId`,
 *   `modulo`, `protocolo`, `page`, `pageSize` (pageSize ≤ 100).
 * - `POST /admin/auditoria/exportar` body `{ formato: 'csv' | 'pdf', ...filtros }`
 *   → `{ jobId }` (HTTP 202).
 * - `GET /admin/auditoria/exportar/:jobId` → `{ status, downloadUrl? }` onde
 *   `status` ∈ `'pendente' | 'processando' | 'concluido' | 'falhou'`.
 */

/** Tamanho de página fixo do log de auditoria (Req. 17.2 — máximo 100). */
const PAGE_SIZE = 100;

/**
 * Linha do log de auditoria retornada por `GET /admin/auditoria`.
 * Campos idênticos ao `AuditoriaLogItem` do backend
 * (`auditoria.query.service.ts`). `realizadaEmUtc` chega como ISO string no JSON.
 */
interface AuditoriaLogItem {
  id: string;
  ator: string;
  atorCidadaoId: string | null;
  atorServidorId: string | null;
  enderecoIp: string;
  tipoAcao: string;
  modulo: string;
  objetoId: string | null;
  tipoObjeto: string | null;
  valorAnterior: string | null;
  valorPosterior: string | null;
  realizadaEmUtc: string;
}

/** Estados possíveis de um job de exportação (espelha `ExportStatus`). */
type ExportStatus = 'pendente' | 'processando' | 'concluido' | 'falhou';

/** Resposta de `GET /admin/auditoria/exportar/:jobId`. */
interface ExportStatusResponse {
  status: ExportStatus;
  downloadUrl?: string;
}

/** Formato de erro padronizado da API (`{ error, code, field? }`). */
interface ApiError {
  error: string;
  code: string;
  field?: string;
}

/** Categoria de ator selecionável no filtro (Req. 17.4). */
type AtorFiltro = '' | 'cidadao' | 'servidor' | 'sistema';

/** Formato de exportação suportado (Req. 17.5). */
type FormatoExport = 'csv' | 'pdf';

/**
 * Estado dos filtros do formulário. Todas as strings vazias representam
 * "sem filtro" e são omitidas dos parâmetros de consulta.
 */
interface FiltrosState {
  dataInicio: string;
  dataFim: string;
  tipoAcao: string;
  ator: AtorFiltro;
  atorId: string;
  modulo: string;
  protocolo: string;
}

const FILTROS_VAZIOS: FiltrosState = {
  dataInicio: '',
  dataFim: '',
  tipoAcao: '',
  ator: '',
  atorId: '',
  modulo: '',
  protocolo: '',
};

/** Extrai a mensagem de erro da API de forma segura, com fallback amigável. */
function extractApiError(err: unknown): string {
  if (err instanceof AxiosError && err.response?.data) {
    const data = err.response.data as Partial<ApiError>;
    if (typeof data.error === 'string') return data.error;
  }
  if (err instanceof Error) return err.message;
  return 'Não foi possível concluir a solicitação. Tente novamente.';
}

/**
 * Remove entradas vazias dos filtros, produzindo apenas os pares realmente
 * aplicáveis. Usado tanto na query string quanto no corpo da exportação.
 */
function filtrosAplicaveis(filtros: FiltrosState): Record<string, string> {
  const out: Record<string, string> = {};
  (Object.keys(filtros) as Array<keyof FiltrosState>).forEach((chave) => {
    const valor = filtros[chave];
    if (valor) out[chave] = valor;
  });
  return out;
}

/** Formata uma data/hora UTC (ISO string) no padrão pt-BR. */
function formatarDataHora(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return iso;
  return data.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Resolve o id do ator a exibir a partir das colunas dedicadas. */
function idDoAtor(item: AuditoriaLogItem): string {
  return item.atorCidadaoId ?? item.atorServidorId ?? '—';
}

/** Descreve o objeto alvo da ação (tipoObjeto/objetoId). */
function descreverObjeto(item: AuditoriaLogItem): string {
  if (!item.objetoId && !item.tipoObjeto) return '—';
  const tipo = item.tipoObjeto ?? 'objeto';
  const id = item.objetoId ?? '—';
  return `${tipo}: ${id}`;
}

/** Cor do badge de status de exportação. */
function corStatusExport(status: ExportStatus): 'blue' | 'yellow' | 'green' | 'red' {
  switch (status) {
    case 'concluido':
      return 'green';
    case 'falhou':
      return 'red';
    case 'processando':
      return 'yellow';
    case 'pendente':
    default:
      return 'blue';
  }
}

/** Rótulo legível do status de exportação. */
function rotuloStatusExport(status: ExportStatus): string {
  switch (status) {
    case 'concluido':
      return 'Concluído';
    case 'falhou':
      return 'Falhou';
    case 'processando':
      return 'Processando';
    case 'pendente':
    default:
      return 'Na fila';
  }
}

export function AuditoriaPage() {
  /** Filtros em edição no formulário (ainda não aplicados). */
  const [rascunho, setRascunho] = useState<FiltrosState>(FILTROS_VAZIOS);
  /** Filtros efetivamente aplicados que alimentam a query. */
  const [filtros, setFiltros] = useState<FiltrosState>(FILTROS_VAZIOS);
  /** Página atual (1-based). */
  const [page, setPage] = useState(1);

  /** Job de exportação em acompanhamento (Req. 17.5). */
  const [exportacao, setExportacao] = useState<{ jobId: string; formato: FormatoExport } | null>(
    null,
  );
  /** Erro específico do fluxo de exportação. */
  const [exportError, setExportError] = useState<string | null>(null);
  /** Indica que a solicitação de exportação está em voo. */
  const [exportSolicitando, setExportSolicitando] = useState(false);

  const paramsAplicados = useMemo(() => filtrosAplicaveis(filtros), [filtros]);

  const logQuery = useQuery<PaginatedResult<AuditoriaLogItem>>({
    queryKey: ['auditoria', paramsAplicados, page],
    queryFn: async () => {
      const { data } = await axiosInstance.get<PaginatedResult<AuditoriaLogItem>>(
        '/admin/auditoria',
        { params: { ...paramsAplicados, page, pageSize: PAGE_SIZE } },
      );
      return data;
    },
    placeholderData: keepPreviousData,
  });

  /** Aplica os filtros do rascunho, voltando à primeira página. */
  function aplicarFiltros(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFiltros(rascunho);
    setPage(1);
  }

  /** Limpa todos os filtros (rascunho e aplicados). */
  function limparFiltros() {
    setRascunho(FILTROS_VAZIOS);
    setFiltros(FILTROS_VAZIOS);
    setPage(1);
  }

  function atualizarCampo<K extends keyof FiltrosState>(campo: K, valor: FiltrosState[K]) {
    setRascunho((atual) => ({ ...atual, [campo]: valor }));
  }

  /** Solicita uma exportação com os filtros atualmente aplicados (Req. 17.5). */
  async function solicitarExportacao(formato: FormatoExport) {
    setExportError(null);
    setExportSolicitando(true);
    try {
      const { data } = await axiosInstance.post<{ jobId: string }>('/admin/auditoria/exportar', {
        formato,
        ...paramsAplicados,
      });
      setExportacao({ jobId: data.jobId, formato });
    } catch (err) {
      setExportError(extractApiError(err));
      setExportacao(null);
    } finally {
      setExportSolicitando(false);
    }
  }

  const meta = logQuery.data?.meta;
  const linhas = logQuery.data?.data ?? [];

  return (
    <section className="flex flex-col gap-6" aria-labelledby="auditoria-titulo">
      <header className="flex flex-col gap-1">
        <h1 id="auditoria-titulo" className="font-heading text-h2 text-text-primary">
          Auditoria
        </h1>
        <p className="text-sm text-text-secondary">
          Registro de ações do sistema. Visualização somente leitura.
        </p>
      </header>

      {/* --- Barra de filtros (Req. 17.4) ------------------------------------ */}
      <form
        onSubmit={aplicarFiltros}
        className="grid grid-cols-1 gap-4 rounded-card border border-neutral bg-white p-4 sm:grid-cols-2 lg:grid-cols-3"
        aria-label="Filtros da auditoria"
      >
        <DatePicker
          label="Data inicial"
          value={rascunho.dataInicio}
          onChange={(e) => atualizarCampo('dataInicio', e.target.value)}
        />
        <DatePicker
          label="Data final"
          value={rascunho.dataFim}
          onChange={(e) => atualizarCampo('dataFim', e.target.value)}
        />
        <Input
          label="Tipo de ação"
          placeholder="ex.: login, mover_etapa"
          value={rascunho.tipoAcao}
          onChange={(e) => atualizarCampo('tipoAcao', e.target.value)}
        />
        <Select
          label="Ator"
          value={rascunho.ator}
          onChange={(e) => atualizarCampo('ator', e.target.value as AtorFiltro)}
          options={[
            { label: 'Todos', value: '' },
            { label: 'Cidadão', value: 'cidadao' },
            { label: 'Servidor', value: 'servidor' },
            { label: 'Sistema', value: 'sistema' },
          ]}
        />
        <Input
          label="ID do ator"
          placeholder="Identificador do cidadão/servidor"
          value={rascunho.atorId}
          onChange={(e) => atualizarCampo('atorId', e.target.value)}
        />
        <Input
          label="Módulo"
          placeholder="ex.: processos, auth"
          value={rascunho.modulo}
          onChange={(e) => atualizarCampo('modulo', e.target.value)}
        />
        <Input
          label="Protocolo"
          placeholder="AAAA-NNNNN"
          value={rascunho.protocolo}
          onChange={(e) => atualizarCampo('protocolo', e.target.value)}
        />

        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
          <Button type="submit" loading={logQuery.isFetching}>
            Aplicar filtros
          </Button>
          <Button type="button" variant="secondary" onClick={limparFiltros}>
            Limpar
          </Button>
        </div>
      </form>

      {/* --- Exportação (Req. 17.5) ----------------------------------------- */}
      <div className="flex flex-col gap-3 rounded-card border border-neutral bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-text-primary">Exportar log filtrado:</span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void solicitarExportacao('csv')}
            loading={exportSolicitando}
          >
            Exportar CSV
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void solicitarExportacao('pdf')}
            loading={exportSolicitando}
          >
            Exportar PDF
          </Button>
        </div>

        {exportError && (
          <Alert variant="danger" title="Falha na exportação">
            {exportError}
          </Alert>
        )}

        {exportacao && (
          <ExportacaoTracker
            jobId={exportacao.jobId}
            formato={exportacao.formato}
            onErro={setExportError}
          />
        )}
      </div>

      {/* --- Resultado (Req. 17.2) ------------------------------------------ */}
      {logQuery.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" label="Carregando registros de auditoria..." />
        </div>
      ) : logQuery.isError ? (
        <Alert variant="danger" title="Não foi possível carregar a auditoria">
          {extractApiError(logQuery.error)}
        </Alert>
      ) : linhas.length === 0 ? (
        <Alert variant="info" title="Nenhum registro encontrado">
          Ajuste os filtros para localizar registros de auditoria.
        </Alert>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="overflow-x-auto rounded-card border border-neutral bg-white">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">
                Registros de auditoria, ordenados do mais recente para o mais antigo.
              </caption>
              <thead>
                <tr className="border-b border-neutral bg-bg-alt text-text-secondary">
                  <th scope="col" className="px-3 py-2 font-medium">
                    Data/hora
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Ator
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Tipo de ação
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Módulo
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Objeto
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    IP
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Alteração
                  </th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((item) => (
                  <tr key={item.id} className="border-b border-neutral last:border-b-0">
                    <td className="whitespace-nowrap px-3 py-2 text-text-primary">
                      {formatarDataHora(item.realizadaEmUtc)}
                    </td>
                    <td className="px-3 py-2 text-text-primary">
                      <span className="font-medium">{item.ator}</span>
                      <span className="block text-xs text-text-secondary">{idDoAtor(item)}</span>
                    </td>
                    <td className="px-3 py-2">
                      <Badge color="blue">{item.tipoAcao}</Badge>
                    </td>
                    <td className="px-3 py-2 text-text-primary">{item.modulo}</td>
                    <td className="px-3 py-2 text-text-primary">{descreverObjeto(item)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-text-secondary">
                      {item.enderecoIp}
                    </td>
                    <td className="px-3 py-2">
                      <AlteracaoCell item={item} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
            <p className="text-sm text-text-secondary" aria-live="polite">
              {meta
                ? `${meta.total} registro(s) — página ${meta.page} de ${meta.totalPages}`
                : null}
            </p>
            {meta && (
              <Pagination
                page={meta.page}
                totalPages={meta.totalPages}
                onPageChange={setPage}
                ariaLabel="Paginação da auditoria"
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Célula que expõe os valores anterior/posterior da alteração (Req. 17.4).
 * Quando há conteúdo, um botão "Ver alteração" alterna uma pré-formatação
 * legível; um `Tooltip` antecipa uma prévia no hover/foco.
 */
function AlteracaoCell({ item }: { item: AuditoriaLogItem }) {
  const [aberto, setAberto] = useState(false);
  const temAlteracao = item.valorAnterior !== null || item.valorPosterior !== null;

  if (!temAlteracao) {
    return <span className="text-text-secondary">—</span>;
  }

  return (
    <div className="flex flex-col gap-2">
      <Tooltip content="Ver valores anterior e posterior">
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          aria-expanded={aberto}
          className="inline-flex min-h-touch items-center rounded-btn px-2 text-sm font-medium text-primary hover:bg-primary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {aberto ? 'Ocultar alteração' : 'Ver alteração'}
        </button>
      </Tooltip>

      {aberto && (
        <dl className="flex flex-col gap-2 rounded-btn bg-bg-alt p-2 text-xs text-text-primary">
          <div>
            <dt className="font-semibold text-text-secondary">Anterior</dt>
            <dd>
              <pre className="whitespace-pre-wrap break-words font-mono">
                {item.valorAnterior ?? '—'}
              </pre>
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-text-secondary">Posterior</dt>
            <dd>
              <pre className="whitespace-pre-wrap break-words font-mono">
                {item.valorPosterior ?? '—'}
              </pre>
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}

interface ExportacaoTrackerProps {
  jobId: string;
  formato: FormatoExport;
  onErro: (mensagem: string) => void;
}

/**
 * Acompanha o status de um job de exportação por polling (Req. 17.5).
 *
 * Consulta `GET /admin/auditoria/exportar/:jobId` com `refetchInterval` enquanto
 * o status não for terminal (`concluido`/`falhou`). Ao concluir, exibe o link
 * de download (`downloadUrl`); em caso de falha, mostra o estado de erro.
 */
function ExportacaoTracker({ jobId, formato, onErro }: ExportacaoTrackerProps) {
  const statusQuery = useQuery<ExportStatusResponse>({
    queryKey: ['auditoria', 'exportacao', jobId],
    queryFn: async () => {
      const { data } = await axiosInstance.get<ExportStatusResponse>(
        `/admin/auditoria/exportar/${jobId}`,
      );
      return data;
    },
    // Continua consultando enquanto o job não estiver em estado terminal.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'concluido' || status === 'falhou' ? false : 2000;
    },
  });

  if (statusQuery.isError) {
    onErro(extractApiError(statusQuery.error));
    return null;
  }

  const status = statusQuery.data?.status ?? 'pendente';
  const emAndamento = status === 'pendente' || status === 'processando';

  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-btn bg-bg-alt p-3"
      aria-live="polite"
    >
      <Badge color={corStatusExport(status)}>{rotuloStatusExport(status)}</Badge>
      <span className="text-sm text-text-secondary">
        Exportação {formato.toUpperCase()} (job {jobId})
      </span>

      {emAndamento && <Spinner size="sm" label="Gerando exportação..." />}

      {status === 'concluido' && statusQuery.data?.downloadUrl && (
        <a
          href={statusQuery.data.downloadUrl}
          className="inline-flex min-h-touch items-center rounded-btn px-3 text-sm font-medium text-primary underline hover:bg-primary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          rel="noopener noreferrer"
        >
          Baixar arquivo
        </a>
      )}

      {status === 'falhou' && (
        <span className="text-sm text-danger">
          Não foi possível gerar a exportação. Tente novamente.
        </span>
      )}
    </div>
  );
}

export default AuditoriaPage;
