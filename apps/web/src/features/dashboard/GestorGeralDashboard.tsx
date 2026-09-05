import { ChartCard, IndicatorCard, KpiValue } from './DashboardCards';
import { SerieSemanalBar } from './DashboardCharts';
import { GrupoDimensaoTable } from './GrupoDimensaoTable';
import type { DashboardGestorGeral } from './dashboard.types';

export interface GestorGeralDashboardProps {
  data: DashboardGestorGeral;
}

/**
 * Dashboard do Gestor Geral (Req 9.4) — também exibido ao Administrador.
 * Totais por status agrupados por categoria, volume semanal (90d) e comparação
 * entre períodos consecutivos de 30 dias. Cada cartão trata a falha do seu
 * próprio indicador (Req 9.6).
 */
export function GestorGeralDashboard({ data }: GestorGeralDashboardProps) {
  return (
    <div className="flex flex-col gap-4">
      <IndicatorCard
        title="Processos por status por categoria"
        indicador={data.porStatusPorCategoria}
      >
        {(value) => <GrupoDimensaoTable grupos={value} dimensao="Categoria" />}
      </IndicatorCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <IndicatorCard
          title="Comparação de períodos (30 dias)"
          indicador={data.comparacaoPeriodos}
        >
          {(value) => (
            <div className="flex flex-col gap-1">
              <KpiValue value={value.periodoAtual} unit="processos (período atual)" />
              <p className="text-sm text-text-secondary">
                Período anterior: {value.periodoAnterior} · Variação:{' '}
                <span
                  className={
                    value.variacaoPercentual >= 0 ? 'text-success' : 'text-danger'
                  }
                >
                  {value.variacaoPercentual >= 0 ? '+' : ''}
                  {value.variacaoPercentual}%
                </span>
              </p>
            </div>
          )}
        </IndicatorCard>

        <ChartCard title="Volume semanal (90 dias)" indicador={data.volumeSemanal}>
          {(value) => <SerieSemanalBar serie={value} nomeMetrica="Processos abertos" />}
        </ChartCard>
      </div>
    </div>
  );
}

export default GestorGeralDashboard;
