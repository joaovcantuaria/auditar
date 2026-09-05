import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Spinner } from '@/components/ui';
import { axiosInstance } from '@/lib/axiosInstance';
import { useAuthStore } from '@/store/authStore';
import { queryKeys } from '@/hooks/useSocket';
import { AnalistaDashboard } from './AnalistaDashboard';
import { GestorUnidadeDashboard } from './GestorUnidadeDashboard';
import { GestorCategoriaDashboard } from './GestorCategoriaDashboard';
import { GestorGeralDashboard } from './GestorGeralDashboard';
import { DashboardEstendidaSection } from './DashboardEstendidaSection';
import { MinhasTarefas } from '@/features/tarefas/MinhasTarefas';
import {
  DASHBOARD_ENDPOINT,
  perfilPorNivel,
  type DashboardAnalista,
  type DashboardGestorCategoria,
  type DashboardGestorGeral,
  type DashboardGestorUnidade,
  type DashboardPerfil,
} from './dashboard.types';

/**
 * Página de Dashboard do Painel Administrativo (Req 9).
 *
 * Seleciona o dashboard a exibir pelo `nivel` do servidor logado
 * ({@link perfilPorNivel}) e busca o endpoint correspondente via React Query.
 *
 * Auto-refresh (Req 9.5): `refetchInterval` de 5 minutos refaz o fetch em
 * segundo plano — o React Query atualiza os dados sem recarregar a página,
 * preservando o scroll e o DOM. Além disso, o evento de socket
 * `dashboard:atualizar` invalida `queryKeys.dashboard()` (ver `useSocket.ts`),
 * disparando um refetch imediato quando o backend sinaliza mudança.
 *
 * Resiliência (Req 9.6): a falha isolada de um indicador NÃO derruba a página —
 * o backend devolve `{ value: null, erro: true }` naquele indicador e o cartão
 * correspondente exibe um alerta inline enquanto os demais seguem exibindo.
 *
 * _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_
 */

/** Intervalo de auto-refresh: 5 minutos (Req 9.5). */
const REFETCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Nível máximo (inclusive) que enxerga a seção estendida de gestão
 * (cards de resumo + prazos + desempenho da equipe). Corresponde a
 * Administrador (1) → Gestor_de_Unidade (4). Analista (5) NÃO a vê (Req 9.9–9.12).
 */
const NIVEL_MAX_SECAO_ESTENDIDA = 4;

/** União das respostas possíveis, discriminada pelo perfil resolvido. */
type DashboardData =
  | DashboardAnalista
  | DashboardGestorUnidade
  | DashboardGestorCategoria
  | DashboardGestorGeral;

/** Título humano por perfil, exibido no cabeçalho da página. */
const PERFIL_TITULO: Record<DashboardPerfil, string> = {
  analista: 'Meu Dashboard',
  'gestor-unidade': 'Dashboard da Unidade',
  'gestor-categoria': 'Dashboard da Categoria',
  'gestor-geral': 'Dashboard Geral',
};

/** Renderiza o dashboard concreto do perfil a partir dos dados carregados. */
function renderPorPerfil(perfil: DashboardPerfil, data: DashboardData) {
  switch (perfil) {
    case 'analista':
      return <AnalistaDashboard data={data as DashboardAnalista} />;
    case 'gestor-unidade':
      return <GestorUnidadeDashboard data={data as DashboardGestorUnidade} />;
    case 'gestor-categoria':
      return <GestorCategoriaDashboard data={data as DashboardGestorCategoria} />;
    case 'gestor-geral':
    default:
      return <GestorGeralDashboard data={data as DashboardGestorGeral} />;
  }
}

export function DashboardPage() {
  const nivel = useAuthStore((state) => state.user?.nivel);
  const perfil = perfilPorNivel(nivel);
  const endpoint = DASHBOARD_ENDPOINT[perfil];

  // Gestores/Administrador (nivel <= 4) veem a seção estendida; Analista (5) não.
  const mostrarSecaoEstendida =
    typeof nivel === 'number' && nivel <= NIVEL_MAX_SECAO_ESTENDIDA;

  const { data, isPending, isError, refetch, isRefetching } = useQuery<DashboardData>({
    // Chave compartilhada com o socket: `dashboard:atualizar` invalida esta key.
    queryKey: queryKeys.dashboard(),
    queryFn: async () => {
      const { data: body } = await axiosInstance.get<DashboardData>(endpoint);
      return body;
    },
    // Auto-refresh a cada 5 min, sem reload (Req 9.5). Mantém rodando em
    // segundo plano para que a UI não fique defasada.
    refetchInterval: REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
  });

  return (
    <main className="flex flex-col gap-6 p-4 md:p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="font-heading text-2xl font-semibold text-text-primary">
          {PERFIL_TITULO[perfil]}
        </h1>
        {isRefetching && <Spinner size="sm" label="Atualizando indicadores…" />}
      </header>

      {isPending ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" label="Carregando indicadores…" />
        </div>
      ) : isError ? (
        <Alert variant="danger" title="Não foi possível carregar o dashboard">
          <p>Ocorreu um erro ao buscar os indicadores. Tente novamente.</p>
          <div className="mt-3">
            <Button variant="secondary" size="sm" onClick={() => void refetch()}>
              Tentar novamente
            </Button>
          </div>
        </Alert>
      ) : (
        renderPorPerfil(perfil, data)
      )}

      {/* Seção estendida de gestão (Req 9.7–9.12), adicionada sem remover o
          dashboard por-perfil existente. Visível a Administrador/Gestores. */}
      {mostrarSecaoEstendida && <DashboardEstendidaSection />}

      {/* Minhas Tarefas (Req 27.6, 27.7): exibida para TODOS os servidores, pois
          qualquer servidor pode ter tarefas atribuídas. Atualiza em tempo real
          via eventos `tarefa:*` (useSocket, montado no AppShell). */}
      <MinhasTarefas />
    </main>
  );
}

export default DashboardPage;
