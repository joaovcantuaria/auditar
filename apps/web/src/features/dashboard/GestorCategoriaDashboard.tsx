import { ChartCard, IndicatorCard } from './DashboardCards';
import { BarrasSimples } from './DashboardCharts';
import { GrupoDimensaoTable } from './GrupoDimensaoTable';
import type { DashboardGestorCategoria } from './dashboard.types';

export interface GestorCategoriaDashboardProps {
  data: DashboardGestorCategoria;
}

/**
 * Dashboard do Gestor de Categoria (Req 9.3): totais por status agrupados por
 * unidade dentro da categoria, tempo médio de resolução por tipo de processo
 * (30d) e comparação entre unidades. Cada cartão trata a falha do seu próprio
 * indicador (Req 9.6).
 */
export function GestorCategoriaDashboard({ data }: GestorCategoriaDashboardProps) {
  return (
    <div className="flex flex-col gap-4">
      <IndicatorCard title="Processos por status por unidade" indicador={data.porStatusPorUnidade}>
        {(value) => <GrupoDimensaoTable grupos={value} dimensao="Unidade" />}
      </IndicatorCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Tempo médio por tipo (30 dias)" indicador={data.tempoMedioPorTipo}>
          {(value) => (
            <BarrasSimples
              data={value.map((t) => ({ nome: t.nome, valor: t.horas }))}
              nomeMetrica="Tempo médio de resolução"
              unidade="h"
            />
          )}
        </ChartCard>

        <IndicatorCard title="Comparação entre unidades" indicador={data.comparacaoUnidades}>
          {(value) => <GrupoDimensaoTable grupos={value} dimensao="Unidade" />}
        </IndicatorCard>
      </div>
    </div>
  );
}

export default GestorCategoriaDashboard;
