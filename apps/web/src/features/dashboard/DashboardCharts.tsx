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
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { StatusProcesso } from '@auditar/shared';
import { STATUS_LABEL_MAP } from '@/components/ui';
import type { PorStatus, SerieDia, SerieSemana } from './dashboard.types';
import { STATUS_KEYS } from './dashboard.types';

/**
 * Gráficos do dashboard baseados em recharts.
 *
 * Cada gráfico é embrulhado em um `ResponsiveContainer` de altura fixa e provê
 * uma alternativa textual acessível (`role="img"` + `aria-label` e uma tabela
 * visualmente oculta com os dados) para que leitores de tela consigam extrair a
 * informação — os SVGs do recharts não são autoexplicativos.
 */

// ---------------------------------------------------------------------------
// Paleta — alinhada às STATUS_COLORS do design.
// ---------------------------------------------------------------------------

/** Cores hex por status (mesmos tons do design system usado em StatusBadge). */
const STATUS_HEX: Record<StatusProcesso, string> = {
  [StatusProcesso.ABERTO]: '#0066CC',
  [StatusProcesso.EM_ANDAMENTO]: '#F39C12',
  [StatusProcesso.AGUARDANDO_DOCS]: '#0066CC',
  [StatusProcesso.AGUARDANDO_CIDADAO]: '#0066CC',
  [StatusProcesso.VENCIDO]: '#E74C3C',
  [StatusProcesso.APROVADO]: '#27AE60',
  [StatusProcesso.REJEITADO]: '#E74C3C',
  [StatusProcesso.FINALIZADO]: '#27AE60',
};

/** Cor primária para séries genéricas (volume/produtividade). */
const PRIMARY_HEX = '#0066CC';

/** Rótulo legível de um status (cai para a própria chave se desconhecida). */
function labelStatus(status: string): string {
  return STATUS_LABEL_MAP[status as StatusProcesso] ?? status;
}

/** Cor de um status (cinza neutro se desconhecida). */
function corStatus(status: string): string {
  return STATUS_HEX[status as StatusProcesso] ?? '#95A5A6';
}

// ---------------------------------------------------------------------------
// Alternativa textual acessível
// ---------------------------------------------------------------------------

interface SrTableProps {
  caption: string;
  columns: [string, string];
  rows: Array<[string, number]>;
}

/** Tabela visualmente oculta que descreve os dados de um gráfico para leitores de tela. */
function SrDataTable({ caption, columns, rows }: SrTableProps) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{columns[0]}</th>
          <th scope="col">{columns[1]}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <th scope="row">{k}</th>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Distribuição por status — Pizza
// ---------------------------------------------------------------------------

export interface StatusPieProps {
  porStatus: PorStatus;
}

/** Distribuição de processos por status como gráfico de pizza (com cores do design). */
export function StatusPie({ porStatus }: StatusPieProps) {
  const data = STATUS_KEYS.map((s) => ({ status: s as string, total: porStatus[s] ?? 0 })).filter(
    (d) => d.total > 0,
  );

  if (data.length === 0) {
    return <p className="text-sm text-text-secondary">Nenhum processo no período.</p>;
  }

  const rows: Array<[string, number]> = data.map((d) => [labelStatus(d.status), d.total]);

  return (
    <div role="img" aria-label="Distribuição de processos por status">
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie
            data={data}
            dataKey="total"
            nameKey="status"
            cx="50%"
            cy="50%"
            outerRadius={90}
            isAnimationActive={false}
          >
            {data.map((d) => (
              <Cell key={d.status} fill={corStatus(d.status)} />
            ))}
          </Pie>
          <Tooltip formatter={(value: number, name: string) => [value, labelStatus(name)]} />
          <Legend formatter={(value: string) => labelStatus(value)} />
        </PieChart>
      </ResponsiveContainer>
      <SrDataTable
        caption="Distribuição de processos por status"
        columns={['Status', 'Total']}
        rows={rows}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Série temporal diária — Linha
// ---------------------------------------------------------------------------

export interface SerieDiariaLineProps {
  serie: SerieDia[];
  /** Nome legível da métrica (ex.: "Processos concluídos"). */
  nomeMetrica: string;
}

/** Série diária (produtividade/volume) como gráfico de linha. */
export function SerieDiariaLine({ serie, nomeMetrica }: SerieDiariaLineProps) {
  if (serie.length === 0) {
    return <p className="text-sm text-text-secondary">Sem dados no período.</p>;
  }

  const rows: Array<[string, number]> = serie.map((d) => [d.dia, d.total]);

  return (
    <div role="img" aria-label={`${nomeMetrica} por dia`}>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={serie} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis dataKey="dia" tick={{ fontSize: 12 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
          <Tooltip formatter={(value: number) => [value, nomeMetrica]} />
          <Line
            type="monotone"
            dataKey="total"
            name={nomeMetrica}
            stroke={PRIMARY_HEX}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <SrDataTable caption={`${nomeMetrica} por dia`} columns={['Dia', 'Total']} rows={rows} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Série semanal — Barras
// ---------------------------------------------------------------------------

export interface SerieSemanalBarProps {
  serie: SerieSemana[];
  nomeMetrica: string;
}

/** Série semanal (volume) como gráfico de barras. */
export function SerieSemanalBar({ serie, nomeMetrica }: SerieSemanalBarProps) {
  if (serie.length === 0) {
    return <p className="text-sm text-text-secondary">Sem dados no período.</p>;
  }

  const rows: Array<[string, number]> = serie.map((d) => [d.semana, d.total]);

  return (
    <div role="img" aria-label={`${nomeMetrica} por semana`}>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={serie} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis dataKey="semana" tick={{ fontSize: 12 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
          <Tooltip formatter={(value: number) => [value, nomeMetrica]} />
          <Bar dataKey="total" name={nomeMetrica} fill={PRIMARY_HEX} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      <SrDataTable caption={`${nomeMetrica} por semana`} columns={['Semana', 'Total']} rows={rows} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Barras genéricas por categoria/nome (ex.: carga por servidor, tempo por tipo)
// ---------------------------------------------------------------------------

export interface BarrasSimplesProps {
  data: Array<{ nome: string; valor: number }>;
  nomeMetrica: string;
  /** Sufixo de unidade opcional (ex.: "h"). */
  unidade?: string;
}

/** Barras horizontais simples para métricas nome→valor. */
export function BarrasSimples({ data, nomeMetrica, unidade }: BarrasSimplesProps) {
  if (data.length === 0) {
    return <p className="text-sm text-text-secondary">Sem dados no período.</p>;
  }

  const rows: Array<[string, number]> = data.map((d) => [d.nome, d.valor]);

  return (
    <div role="img" aria-label={nomeMetrica}>
      <ResponsiveContainer width="100%" height={Math.max(160, data.length * 40)}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 8, right: 24, bottom: 8, left: 16 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
          <YAxis type="category" dataKey="nome" width={140} tick={{ fontSize: 12 }} />
          <Tooltip
            formatter={(value: number) => [unidade ? `${value} ${unidade}` : value, nomeMetrica]}
          />
          <Bar dataKey="valor" name={nomeMetrica} fill={PRIMARY_HEX} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      <SrDataTable
        caption={nomeMetrica}
        columns={['Nome', unidade ? `Valor (${unidade})` : 'Valor']}
        rows={rows}
      />
    </div>
  );
}
