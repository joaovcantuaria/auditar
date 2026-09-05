import { ChartCard, IndicatorCard, KpiValue } from './DashboardCards';
import { SerieDiariaLine, StatusPie } from './DashboardCharts';
import { StatusCounts } from './StatusCounts';
import type { DashboardAnalista } from './dashboard.types';

export interface AnalistaDashboardProps {
  data: DashboardAnalista;
}

/**
 * Dashboard do Analista (Req 9.1): processos por status atribuídos a ele,
 * processos vencendo em ≤24h, tempo médio de resolução (30d) e produtividade
 * diária (30d). Cada cartão trata a falha do seu próprio indicador (Req 9.6).
 */
export function AnalistaDashboard({ data }: AnalistaDashboardProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <IndicatorCard title="Vencendo em 24h" indicador={data.vencendoEm24h}>
          {(value) => <KpiValue value={value} unit="processos" />}
        </IndicatorCard>

        <IndicatorCard
          title="Tempo médio de resolução (30 dias)"
          indicador={data.tempoMedioResolucaoHoras}
        >
          {(value) => <KpiValue value={value} unit="horas" />}
        </IndicatorCard>
      </div>

      <IndicatorCard title="Processos por status" indicador={data.porStatus}>
        {(value) => <StatusCounts porStatus={value} />}
      </IndicatorCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Distribuição por status" indicador={data.porStatus}>
          {(value) => <StatusPie porStatus={value} />}
        </ChartCard>

        <ChartCard title="Produtividade diária (30 dias)" indicador={data.produtividadeDiaria}>
          {(value) => <SerieDiariaLine serie={value} nomeMetrica="Processos concluídos" />}
        </ChartCard>
      </div>
    </div>
  );
}

export default AnalistaDashboard;
