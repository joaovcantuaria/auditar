import { useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Alert, Badge, Button, DatePicker, Input, Spinner } from '@/components/ui';
import { axiosInstance } from '@/lib/axiosInstance';

/**
 * Página de Relatórios do Painel Administrativo (tarefa 17.2).
 *
 * Requisitos:
 * - 18.1 Cinco relatórios: volume por período, tempo médio por tipo, taxa de
 *        aprovação/rejeição por unidade, processos vencidos por servidor e
 *        volume por categoria.
 * - 18.2 Período padrão de 30 dias + filtros combináveis (período, categoria,
 *        tipo, unidade, servidor). Resultado em ≤5s (agregação no backend).
 * - 18.3 Alternância gráfico/tabela SEM recarregar dados (estado de cliente).
 * - 18.4 Exportação CSV/PDF.
 * - 18.5 Acompanhamento (tracking) do status da exportação em background.
 * - 18.7 Validação do intervalo de datas (dataFim ≥ dataInicio, ≤366 dias) —
 *        validada no cliente antes de disparar e também pelo backend (400).
 *
 * Contratos do backend (lidos de `relatorios.controller.ts` +
 * `relatorios.service.ts` + `relatorios.router.ts`, baseURL `/api/v1`):
 * - `GET /admin/relatorios` (query: `dataInicio`, `dataFim`, `categoriaId`,
 *   `tipoProcessoId`, `unidadeId`, `servidorId`) → `RelatorioResultado`:
 *   `{ periodo: { dataInicio, dataFim }, volumePorPeriodo[], tempoMedioPorTipo[],
 *      taxaPorUnidade[], vencidosPorServidor[], volumePorCategoria[] }`.
 *   - `volumePorPeriodo`: `{ data, total }`
 *   - `tempoMedioPorTipo`: `{ tipoProcessoId, tipoProcesso, tempoMedioDias, totalResolvidos }`
 *   - `taxaPorUnidade`: `{ unidadeId, unidade, aprovados, rejeitados, total, taxaAprovacao, taxaRejeicao }`
 *   - `vencidosPorServidor`: `{ servidorId, servidor, totalVencidos }`
 *   - `volumePorCategoria`: `{ categoriaId, categoria, total }`
 * - `POST /admin/relatorios/exportar` body `{ formato: 'csv' | 'pdf', ...filtros }`
 *   → `{ jobId }` (HTTP 202).
 * - `GET /admin/relatorios/exportar/:jobId` → `{ status, downloadUrl? }` onde
 *   `status` ∈ `'pendente' | 'processando' | 'concluido' | 'falhou'`.
 *
 * Nota sobre filtros de entidade: categoria, tipo, unidade e servidor são
 * informados como IDs em campos de texto. Os endpoints de listagem de opções
 * (`/admin/config/*`, `/admin/servidores`) pertencem a outras tarefas em
 * andamento e ainda não expõem contratos estáveis consumidos pelo web; usar IDs
 * mantém a página fiel ao contrato verificado de `/admin/relatorios`. Quando as
 * listas estiverem disponíveis, estes campos podem virar Selects sem alterar a
 * lógica de consulta.
 */

/** Intervalo máximo permitido entre as datas — espelha `INTERVALO_MAX_DIAS`. */
const INTERVALO_MAX_DIAS = 366;

/** Milissegundos em um dia. */
const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Paleta acessível reutilizada nos gráficos (contraste adequado). */
const CORES_GRAFICO = ['#1d4ed8', '#0f766e', '#b45309', '#9333ea', '#be123c', '#15803d'];

// ---------------------------------------------------------------------------
// Tipos dos datasets (idênticos aos do backend `relatorios.service.ts`)
// ---------------------------------------------------------------------------

interface VolumePorPeriodoItem {
  data: string; // YYYY-MM-DD
  total: number;
}

interface TempoMedioPorTipoItem {
  tipoProcessoId: string;
  tipoProcesso: string;
  tempoMedioDias: number | null;
  totalResolvidos: number;
}

interface TaxaPorUnidadeItem {
  unidadeId: string;
  unidade: string;
  aprovados: number;
  rejeitados: number;
  total: number;
  taxaAprovacao: number; // 0..1
  taxaRejeicao: number; // 0..1
}

interface VencidosPorServidorItem {
  servidorId: string | null;
  servidor: string;
  totalVencidos: number;
}

interface VolumePorCategoriaItem {
  categoriaId: string;
  categoria: string;
  total: number;
}

interface RelatorioResultado {
  periodo: { dataInicio: string | null; dataFim: string | null };
  volumePorPeriodo: VolumePorPeriodoItem[];
  tempoMedioPorTipo: TempoMedioPorTipoItem[];
  taxaPorUnidade: TaxaPorUnidadeItem[];
  vencidosPorServidor: VencidosPorServidorItem[];
  volumePorCategoria: VolumePorCategoriaItem[];
}

/** Estados possíveis de um job de exportação (espelha `RelatorioStatus`). */
type ExportStatus = 'pendente' | 'processando' | 'concluido' | 'falhou';

/** Resposta de `GET /admin/relatorios/exportar/:jobId`. */
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

/** Formato de exportação suportado (Req. 18.4). */
type FormatoExport = 'csv' | 'pdf';

/** Modo de visualização de cada dataset (Req. 18.3). */
type Visualizacao = 'grafico' | 'tabela';

/**
 * Estado dos filtros do formulário. Strings vazias representam "sem filtro" e
 * são omitidas dos parâmetros de consulta.
 */
interface FiltrosState {
  dataInicio: string;
  dataFim: string;
  categoriaId: string;
  tipoProcessoId: string;
  unidadeId: string;
  servidorId: string;
}

const FILTROS_VAZIOS: FiltrosState = {
  dataInicio: '',
  dataFim: '',
  categoriaId: '',
  tipoProcessoId: '',
  unidadeId: '',
  servidorId: '',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/**
 * Calcula o período padrão dos últimos 30 dias (exibido nos DatePickers antes
 * de qualquer alteração do usuário). Formato YYYY-MM-DD.
 */
function periodoPadrao30Dias(agora: Date = new Date()): { dataInicio: string; dataFim: string } {
  const fim = agora;
  const inicio = new Date(fim.getTime() - 30 * MS_POR_DIA);
  return { dataInicio: toYmd(inicio), dataFim: toYmd(fim) };
}

/** Converte um Date para string YYYY-MM-DD (data local). */
function toYmd(d: Date): string {
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

/**
 * Valida o intervalo de datas no cliente (Req. 18.7): quando ambas as datas
 * estão presentes, `dataFim` deve ser ≥ `dataInicio` e o intervalo ≤366 dias.
 * Retorna a mensagem de erro (associada a `dataFim`) ou `null` se válido.
 */
function validarIntervalo(dataInicio: string, dataFim: string): string | null {
  if (!dataInicio || !dataFim) return null;
  const inicio = new Date(`${dataInicio}T00:00:00`);
  const fim = new Date(`${dataFim}T00:00:00`);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) return null;
  if (fim < inicio) {
    return 'A data final deve ser maior ou igual à data inicial.';
  }
  const dias = (fim.getTime() - inicio.getTime()) / MS_POR_DIA;
  if (dias > INTERVALO_MAX_DIAS) {
    return `O intervalo de datas não pode exceder ${INTERVALO_MAX_DIAS} dias.`;
  }
  return null;
}

/** Formata uma taxa (0..1) como porcentagem legível. */
function formatarPercentual(taxa: number): string {
  return `${(taxa * 100).toFixed(1)}%`;
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

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export function RelatoriosPage() {
  /** Período padrão de 30 dias mostrado na primeira renderização (Req. 18.2). */
  const padrao = useMemo(() => periodoPadrao30Dias(), []);

  /** Filtros em edição (ainda não aplicados). */
  const [rascunho, setRascunho] = useState<FiltrosState>({
    ...FILTROS_VAZIOS,
    dataInicio: padrao.dataInicio,
    dataFim: padrao.dataFim,
  });
  /** Filtros efetivamente aplicados que alimentam a query. */
  const [filtros, setFiltros] = useState<FiltrosState>({
    ...FILTROS_VAZIOS,
    dataInicio: padrao.dataInicio,
    dataFim: padrao.dataFim,
  });
  /** Erro de validação do intervalo (client-side, Req. 18.7). */
  const [erroIntervalo, setErroIntervalo] = useState<string | null>(null);

  /** Job de exportação em acompanhamento (Req. 18.5). */
  const [exportacao, setExportacao] = useState<{ jobId: string; formato: FormatoExport } | null>(
    null,
  );
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSolicitando, setExportSolicitando] = useState(false);

  const paramsAplicados = useMemo(() => filtrosAplicaveis(filtros), [filtros]);

  const relatorioQuery = useQuery<RelatorioResultado>({
    queryKey: ['relatorios', paramsAplicados],
    queryFn: async () => {
      const { data } = await axiosInstance.get<RelatorioResultado>('/admin/relatorios', {
        params: paramsAplicados,
      });
      return data;
    },
    placeholderData: keepPreviousData,
  });

  /** Aplica os filtros do rascunho após validar o intervalo (Req. 18.7). */
  function aplicarFiltros(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const erro = validarIntervalo(rascunho.dataInicio, rascunho.dataFim);
    setErroIntervalo(erro);
    if (erro) return;
    setFiltros(rascunho);
  }

  /** Restaura os filtros para o período padrão de 30 dias. */
  function limparFiltros() {
    const reset: FiltrosState = {
      ...FILTROS_VAZIOS,
      dataInicio: padrao.dataInicio,
      dataFim: padrao.dataFim,
    };
    setRascunho(reset);
    setFiltros(reset);
    setErroIntervalo(null);
  }

  function atualizarCampo<K extends keyof FiltrosState>(campo: K, valor: FiltrosState[K]) {
    setRascunho((atual) => ({ ...atual, [campo]: valor }));
  }

  /** Solicita uma exportação com os filtros atualmente aplicados (Req. 18.4/18.5). */
  async function solicitarExportacao(formato: FormatoExport) {
    setExportError(null);
    setExportSolicitando(true);
    try {
      const { data } = await axiosInstance.post<{ jobId: string }>('/admin/relatorios/exportar', {
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

  const dados = relatorioQuery.data;

  return (
    <section className="flex flex-col gap-6" aria-labelledby="relatorios-titulo">
      <header className="flex flex-col gap-1">
        <h1 id="relatorios-titulo" className="font-heading text-h2 text-text-primary">
          Relatórios
        </h1>
        <p className="text-sm text-text-secondary">
          Métricas de processos por período, tipo, unidade, servidor e categoria.
        </p>
      </header>

      {/* --- Barra de filtros (Req. 18.2) ----------------------------------- */}
      <form
        onSubmit={aplicarFiltros}
        className="grid grid-cols-1 gap-4 rounded-card border border-neutral bg-white p-4 sm:grid-cols-2 lg:grid-cols-3"
        aria-label="Filtros do relatório"
      >
        <DatePicker
          label="Data inicial"
          value={rascunho.dataInicio}
          onChange={(e) => atualizarCampo('dataInicio', e.target.value)}
        />
        <DatePicker
          label="Data final"
          value={rascunho.dataFim}
          error={erroIntervalo ?? undefined}
          onChange={(e) => atualizarCampo('dataFim', e.target.value)}
        />
        <Input
          label="Categoria (ID)"
          placeholder="Identificador da categoria"
          value={rascunho.categoriaId}
          onChange={(e) => atualizarCampo('categoriaId', e.target.value)}
        />
        <Input
          label="Tipo de processo (ID)"
          placeholder="Identificador do tipo"
          value={rascunho.tipoProcessoId}
          onChange={(e) => atualizarCampo('tipoProcessoId', e.target.value)}
        />
        <Input
          label="Unidade (ID)"
          placeholder="Identificador da unidade"
          value={rascunho.unidadeId}
          onChange={(e) => atualizarCampo('unidadeId', e.target.value)}
        />
        <Input
          label="Servidor (ID)"
          placeholder="Identificador do servidor"
          value={rascunho.servidorId}
          onChange={(e) => atualizarCampo('servidorId', e.target.value)}
        />

        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
          <Button type="submit" loading={relatorioQuery.isFetching}>
            Gerar relatório
          </Button>
          <Button type="button" variant="secondary" onClick={limparFiltros}>
            Limpar
          </Button>
        </div>
      </form>

      {/* --- Exportação (Req. 18.4/18.5) ------------------------------------ */}
      <div className="flex flex-col gap-3 rounded-card border border-neutral bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-text-primary">Exportar relatório filtrado:</span>
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

      {/* --- Resultado (Req. 18.1) ------------------------------------------ */}
      {relatorioQuery.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" label="Carregando relatório..." />
        </div>
      ) : relatorioQuery.isError ? (
        <Alert variant="danger" title="Não foi possível carregar o relatório">
          {extractApiError(relatorioQuery.error)}
        </Alert>
      ) : dados ? (
        <div className="flex flex-col gap-6">
          <PeriodoResumo periodo={dados.periodo} />

          <VolumePorPeriodoCard dados={dados.volumePorPeriodo} />
          <TempoMedioPorTipoCard dados={dados.tempoMedioPorTipo} />
          <TaxaPorUnidadeCard dados={dados.taxaPorUnidade} />
          <VencidosPorServidorCard dados={dados.vencidosPorServidor} />
          <VolumePorCategoriaCard dados={dados.volumePorCategoria} />
        </div>
      ) : null}
    </section>
  );
}

/** Exibe o período efetivamente considerado no relatório (Req. 18.2). */
function PeriodoResumo({ periodo }: { periodo: RelatorioResultado['periodo'] }) {
  const formatar = (iso: string | null): string => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('pt-BR');
  };
  return (
    <p className="text-sm text-text-secondary" aria-live="polite">
      Período considerado: <strong>{formatar(periodo.dataInicio)}</strong> a{' '}
      <strong>{formatar(periodo.dataFim)}</strong>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Bloco genérico de dataset com alternância gráfico/tabela (Req. 18.3)
// ---------------------------------------------------------------------------

interface DatasetCardProps {
  titulo: string;
  vazio: boolean;
  /** Renderiza o gráfico (recharts) — chamado apenas no modo 'grafico'. */
  renderGrafico: () => React.ReactNode;
  /** Renderiza a tabela acessível — usada no modo 'tabela' e como alternativa sr-only. */
  renderTabela: () => React.ReactNode;
  /** Descrição textual do gráfico para leitores de tela (aria-label). */
  descricaoGrafico: string;
}

/**
 * Envolve um dataset com um cabeçalho, controle de alternância gráfico/tabela
 * (puro estado de cliente, sem recarregar — Req. 18.3) e tratamento de vazio.
 * No modo gráfico, além do `role="img"` com `aria-label`, a tabela é incluída
 * como alternativa `sr-only` para leitores de tela.
 */
function DatasetCard({
  titulo,
  vazio,
  renderGrafico,
  renderTabela,
  descricaoGrafico,
}: DatasetCardProps) {
  const [modo, setModo] = useState<Visualizacao>('grafico');

  return (
    <section
      className="flex flex-col gap-3 rounded-card border border-neutral bg-white p-4"
      aria-labelledby={`dataset-${slug(titulo)}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`dataset-${slug(titulo)}`} className="font-heading text-h3 text-text-primary">
          {titulo}
        </h2>
        {!vazio && (
          <div
            className="inline-flex overflow-hidden rounded-btn border border-neutral"
            role="group"
            aria-label={`Alternar visualização de ${titulo}`}
          >
            <button
              type="button"
              onClick={() => setModo('grafico')}
              aria-pressed={modo === 'grafico'}
              className={toggleClasses(modo === 'grafico')}
            >
              Gráfico
            </button>
            <button
              type="button"
              onClick={() => setModo('tabela')}
              aria-pressed={modo === 'tabela'}
              className={toggleClasses(modo === 'tabela')}
            >
              Tabela
            </button>
          </div>
        )}
      </div>

      {vazio ? (
        <Alert variant="info" title="Sem dados no período">
          Nenhum registro encontrado para os filtros selecionados.
        </Alert>
      ) : modo === 'grafico' ? (
        <>
          <div role="img" aria-label={descricaoGrafico} className="h-72 w-full">
            {renderGrafico()}
          </div>
          {/* Alternativa acessível ao gráfico para leitores de tela. */}
          <div className="sr-only">{renderTabela()}</div>
        </>
      ) : (
        renderTabela()
      )}
    </section>
  );
}

/** Classes do botão de alternância, destacando o modo ativo. */
function toggleClasses(ativo: boolean): string {
  const base =
    'min-h-touch px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';
  return ativo ? `${base} bg-primary text-white` : `${base} bg-white text-primary`;
}

/** Normaliza um título para uso em ids. */
function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** Cabeçalho de tabela reutilizável. */
function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="px-3 py-2 font-medium">
      {children}
    </th>
  );
}

// ---------------------------------------------------------------------------
// Dataset 1 — Volume por período (linha)
// ---------------------------------------------------------------------------

function VolumePorPeriodoCard({ dados }: { dados: VolumePorPeriodoItem[] }) {
  return (
    <DatasetCard
      titulo="Volume por período"
      vazio={dados.length === 0}
      descricaoGrafico={`Gráfico de linha do volume diário de processos abertos, com ${dados.length} ponto(s).`}
      renderGrafico={() => (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={dados} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="data" tick={{ fontSize: 12 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
            <RechartsTooltip />
            <Line
              type="monotone"
              dataKey="total"
              name="Processos abertos"
              stroke={CORES_GRAFICO[0]}
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
      renderTabela={() => (
        <div className="overflow-x-auto rounded-card border border-neutral">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Volume de processos abertos por dia.</caption>
            <thead>
              <tr className="border-b border-neutral bg-bg-alt text-text-secondary">
                <Th>Data</Th>
                <Th>Total</Th>
              </tr>
            </thead>
            <tbody>
              {dados.map((item) => (
                <tr key={item.data} className="border-b border-neutral last:border-b-0">
                  <td className="px-3 py-2 text-text-primary">{item.data}</td>
                  <td className="px-3 py-2 text-text-primary">{item.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Dataset 2 — Tempo médio por tipo (barra)
// ---------------------------------------------------------------------------

function TempoMedioPorTipoCard({ dados }: { dados: TempoMedioPorTipoItem[] }) {
  return (
    <DatasetCard
      titulo="Tempo médio por tipo"
      vazio={dados.length === 0}
      descricaoGrafico={`Gráfico de barras do tempo médio de resolução (em dias) por tipo de processo, com ${dados.length} tipo(s).`}
      renderGrafico={() => (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dados} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="tipoProcesso" tick={{ fontSize: 12 }} />
            <YAxis allowDecimals tick={{ fontSize: 12 }} />
            <RechartsTooltip />
            <Bar dataKey="tempoMedioDias" name="Dias (média)" fill={CORES_GRAFICO[1]} />
          </BarChart>
        </ResponsiveContainer>
      )}
      renderTabela={() => (
        <div className="overflow-x-auto rounded-card border border-neutral">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">
              Tempo médio de resolução por tipo de processo, em dias.
            </caption>
            <thead>
              <tr className="border-b border-neutral bg-bg-alt text-text-secondary">
                <Th>Tipo de processo</Th>
                <Th>Tempo médio (dias)</Th>
                <Th>Resolvidos</Th>
              </tr>
            </thead>
            <tbody>
              {dados.map((item) => (
                <tr key={item.tipoProcessoId} className="border-b border-neutral last:border-b-0">
                  <td className="px-3 py-2 text-text-primary">{item.tipoProcesso}</td>
                  <td className="px-3 py-2 text-text-primary">
                    {item.tempoMedioDias === null ? '—' : item.tempoMedioDias}
                  </td>
                  <td className="px-3 py-2 text-text-primary">{item.totalResolvidos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Dataset 3 — Taxa por unidade (barra: aprovados vs rejeitados)
// ---------------------------------------------------------------------------

function TaxaPorUnidadeCard({ dados }: { dados: TaxaPorUnidadeItem[] }) {
  return (
    <DatasetCard
      titulo="Taxa de aprovação/rejeição por unidade"
      vazio={dados.length === 0}
      descricaoGrafico={`Gráfico de barras com aprovados e rejeitados por unidade, com ${dados.length} unidade(s).`}
      renderGrafico={() => (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dados} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="unidade" tick={{ fontSize: 12 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
            <RechartsTooltip />
            <Legend />
            <Bar dataKey="aprovados" name="Aprovados" fill={CORES_GRAFICO[5]} />
            <Bar dataKey="rejeitados" name="Rejeitados" fill={CORES_GRAFICO[4]} />
          </BarChart>
        </ResponsiveContainer>
      )}
      renderTabela={() => (
        <div className="overflow-x-auto rounded-card border border-neutral">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">
              Aprovados, rejeitados e taxas por unidade.
            </caption>
            <thead>
              <tr className="border-b border-neutral bg-bg-alt text-text-secondary">
                <Th>Unidade</Th>
                <Th>Aprovados</Th>
                <Th>Rejeitados</Th>
                <Th>Total</Th>
                <Th>Taxa aprovação</Th>
                <Th>Taxa rejeição</Th>
              </tr>
            </thead>
            <tbody>
              {dados.map((item) => (
                <tr key={item.unidadeId} className="border-b border-neutral last:border-b-0">
                  <td className="px-3 py-2 text-text-primary">{item.unidade}</td>
                  <td className="px-3 py-2 text-text-primary">{item.aprovados}</td>
                  <td className="px-3 py-2 text-text-primary">{item.rejeitados}</td>
                  <td className="px-3 py-2 text-text-primary">{item.total}</td>
                  <td className="px-3 py-2 text-text-primary">
                    {formatarPercentual(item.taxaAprovacao)}
                  </td>
                  <td className="px-3 py-2 text-text-primary">
                    {formatarPercentual(item.taxaRejeicao)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Dataset 4 — Vencidos por servidor (barra)
// ---------------------------------------------------------------------------

function VencidosPorServidorCard({ dados }: { dados: VencidosPorServidorItem[] }) {
  return (
    <DatasetCard
      titulo="Processos vencidos por servidor"
      vazio={dados.length === 0}
      descricaoGrafico={`Gráfico de barras do total de processos vencidos por servidor, com ${dados.length} servidor(es).`}
      renderGrafico={() => (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dados} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="servidor" tick={{ fontSize: 12 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
            <RechartsTooltip />
            <Bar dataKey="totalVencidos" name="Vencidos" fill={CORES_GRAFICO[2]} />
          </BarChart>
        </ResponsiveContainer>
      )}
      renderTabela={() => (
        <div className="overflow-x-auto rounded-card border border-neutral">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">
              Total de processos vencidos por servidor responsável.
            </caption>
            <thead>
              <tr className="border-b border-neutral bg-bg-alt text-text-secondary">
                <Th>Servidor</Th>
                <Th>Vencidos</Th>
              </tr>
            </thead>
            <tbody>
              {dados.map((item) => (
                <tr
                  key={item.servidorId ?? 'sem-responsavel'}
                  className="border-b border-neutral last:border-b-0"
                >
                  <td className="px-3 py-2 text-text-primary">{item.servidor}</td>
                  <td className="px-3 py-2 text-text-primary">{item.totalVencidos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Dataset 5 — Volume por categoria (pizza)
// ---------------------------------------------------------------------------

function VolumePorCategoriaCard({ dados }: { dados: VolumePorCategoriaItem[] }) {
  return (
    <DatasetCard
      titulo="Volume por categoria"
      vazio={dados.length === 0}
      descricaoGrafico={`Gráfico de pizza do volume de processos por categoria, com ${dados.length} categoria(s).`}
      renderGrafico={() => (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <RechartsTooltip />
            <Legend />
            <Pie
              data={dados}
              dataKey="total"
              nameKey="categoria"
              cx="50%"
              cy="50%"
              outerRadius={90}
              label
            >
              {dados.map((item, index) => (
                <Cell
                  key={item.categoriaId}
                  fill={CORES_GRAFICO[index % CORES_GRAFICO.length]}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      )}
      renderTabela={() => (
        <div className="overflow-x-auto rounded-card border border-neutral">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Volume de processos por categoria.</caption>
            <thead>
              <tr className="border-b border-neutral bg-bg-alt text-text-secondary">
                <Th>Categoria</Th>
                <Th>Total</Th>
              </tr>
            </thead>
            <tbody>
              {dados.map((item) => (
                <tr key={item.categoriaId} className="border-b border-neutral last:border-b-0">
                  <td className="px-3 py-2 text-text-primary">{item.categoria}</td>
                  <td className="px-3 py-2 text-text-primary">{item.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Tracker de exportação (Req. 18.5) — mesmo padrão de AuditoriaPage
// ---------------------------------------------------------------------------

interface ExportacaoTrackerProps {
  jobId: string;
  formato: FormatoExport;
  onErro: (mensagem: string) => void;
}

/**
 * Acompanha o status de um job de exportação por polling (Req. 18.5).
 *
 * Consulta `GET /admin/relatorios/exportar/:jobId` com `refetchInterval`
 * enquanto o status não for terminal (`concluido`/`falhou`). Ao concluir,
 * exibe o link de download (`downloadUrl`); em caso de falha, mostra o erro.
 */
function ExportacaoTracker({ jobId, formato, onErro }: ExportacaoTrackerProps) {
  const statusQuery = useQuery<ExportStatusResponse>({
    queryKey: ['relatorios', 'exportacao', jobId],
    queryFn: async () => {
      const { data } = await axiosInstance.get<ExportStatusResponse>(
        `/admin/relatorios/exportar/${jobId}`,
      );
      return data;
    },
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
    <div className="flex flex-wrap items-center gap-3 rounded-btn bg-bg-alt p-3" aria-live="polite">
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

export default RelatoriosPage;
