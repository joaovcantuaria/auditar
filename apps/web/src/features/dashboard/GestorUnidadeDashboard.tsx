import { ChartCard, IndicatorCard, KpiValue } from './DashboardCards';
import { BarrasSimples, SerieDiariaLine, StatusPie } from './DashboardCharts';
import { StatusCounts } from './StatusCounts';
import type { DashboardGestorUnidade } from './dashboard.types';

export interface GestorUnidadeDashboardProps {
  data: DashboardGestorUnidade;
}

/**
 * Dashboard do Gestor de Unidade (Req 9.2): totais por status na unidade, carga
 * de trabalho por servidor, taxas de aprovação/rejeição (30d) e volume diário
 * (30d). Cada cartão trata a falha do seu próprio indicador (Req 9.6).
 */
export function GestorUnidadeDashboard({ data }: GestorUnidadeDashboardProps) {
  return (
    <div className="flex flex-col gap-4">
      <IndicatorCard title="Processos por status na unidade" indicador={data.porStatus}>
        {(value) => <StatusCounts porStatus={value} />}
      </IndicatorCard>

      <div className="grid gap-4 md:grid-cols-2">
        <IndicatorCard
          title="Taxa de aprovação (30 dias)"
          indicador={data.taxaAprovacaoRejeicao}
        >
          {(value) => (
            <div className="flex flex-col gap-1">
              <KpiValue value={value.taxaAprovacao} unit="%" />
              <p className="text-sm text-text-secondary">
                {value.aprovados} aprovados · {value.rejeitados} rejeitados ·{' '}
                {value.taxaRejeicao}% rejeição
              </p>
            </div>
          )}
        </IndicatorCard>

        <ChartCard title="Distribuição por status" indicador={data.porStatus}>
          {(value) => <StatusPie porStatus={value} />}
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Carga por servidor" indicador={data.cargaPorServidor}>
          {(value) => (
            <BarrasSimples
              data={value.map((c) => ({ nome: c.nome, valor: c.ativos }))}
              nomeMetrica="Processos ativos"
            />
          )}
        </ChartCard>

        <ChartCard title="Volume diário (30 dias)" indicador={data.volumeDiario}>
          {(value) => <SerieDiariaLine serie={value} nomeMetrica="Processos abertos" />}
        </ChartCard>
      </div>
    </div>
  );
}

export default GestorUnidadeDashboard;
