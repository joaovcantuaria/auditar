import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from '@/lib/axiosInstance';
import { FiltrosDashboard } from './components/FiltrosDashboard';
import { ResumoCards } from './components/ResumoCards';
import { IndicadorPrazos } from './components/IndicadorPrazos';
import { PainelDesempenhoEquipe } from './components/PainelDesempenhoEquipe';
import {
  DASHBOARD_DESEMPENHO_ENDPOINT,
  DASHBOARD_RESUMO_ENDPOINT,
  filtrosParaParams,
  type DashboardResumo,
  type DesempenhoEquipeResposta,
  type FiltrosDashboardEstado,
  type OrdenarDesempenhoPor,
} from './dashboardEstendida.types';

/**
 * Seção estendida da Dashboard (Tasks 27.1 + 27.2, Req 9.7–9.12) para gestores e
 * administradores. Compõe:
 *  - {@link FiltrosDashboard}: unidade/categoria/período (estado local, propagado
 *    aos fetches);
 *  - {@link ResumoCards}: 8 cards de contagem (indicador `cards`);
 *  - {@link IndicadorPrazos}: vencendo/vencidos (indicador `prazos`);
 *  - {@link PainelDesempenhoEquipe}: tabela por servidor, ordenável por coluna.
 *
 * Resiliência (Req 9.6): cada indicador da resposta de `/resumo` já vem
 * embrulhado em `{ value, erro }`, e os componentes tratam o erro por indicador
 * (aviso no card afetado) sem derrubar os demais. `/desempenho-equipe` também é
 * um indicador embrulhado.
 *
 * O escopo RBAC é resolvido no backend a partir do JWT; aqui só enviamos os
 * filtros opcionais.
 */

/** Intervalo de auto-refresh alinhado ao dashboard principal: 5 minutos. */
const REFETCH_INTERVAL_MS = 5 * 60 * 1000;

export function DashboardEstendidaSection() {
  const [filtros, setFiltros] = useState<FiltrosDashboardEstado>({});
  const [ordenarPor, setOrdenarPor] = useState<OrdenarDesempenhoPor>('nome');

  const params = filtrosParaParams(filtros);

  const resumoQuery = useQuery<DashboardResumo>({
    queryKey: ['dashboard', 'resumo', params],
    queryFn: async () => {
      const { data } = await axiosInstance.get<DashboardResumo>(DASHBOARD_RESUMO_ENDPOINT, {
        params,
      });
      return data;
    },
    refetchInterval: REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
  });

  const desempenhoQuery = useQuery<DesempenhoEquipeResposta>({
    queryKey: ['dashboard', 'desempenho-equipe', params, ordenarPor],
    queryFn: async () => {
      const { data } = await axiosInstance.get<DesempenhoEquipeResposta>(
        DASHBOARD_DESEMPENHO_ENDPOINT,
        { params: { ...params, ordenarPor } },
      );
      return data;
    },
    refetchInterval: REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
  });

  return (
    <section className="flex flex-col gap-4" aria-label="Indicadores da gestão">
      <h2 className="font-heading text-lg font-semibold text-text-primary">
        Visão geral da gestão
      </h2>

      <FiltrosDashboard filtros={filtros} onChange={setFiltros} />

      <ResumoCards indicador={resumoQuery.data?.cards} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <IndicadorPrazos indicador={resumoQuery.data?.prazos} />
        <PainelDesempenhoEquipe
          indicador={desempenhoQuery.data}
          ordenarPor={ordenarPor}
          onOrdenarPorChange={setOrdenarPor}
        />
      </div>
    </section>
  );
}

export default DashboardEstendidaSection;
