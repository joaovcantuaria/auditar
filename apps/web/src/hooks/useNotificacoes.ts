import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from '@/lib/axiosInstance';
import {
  useNotificacaoStore,
  type Notificacao,
} from '@/store/notificacaoStore';
import { queryKeys } from './useSocket';

/**
 * Hook consumido pelo `NotificationBell` (Header, task 11.2). Expõe o estado do
 * painel de notificações e as ações de leitura, mantendo o store como fonte de
 * verdade em memória (alimentado em tempo real por `useSocket`).
 *
 * Carga inicial: quando a API expuser um endpoint de listagem de notificações
 * persistidas do painel, o fetch abaixo popula o store com `setNotificacoes`.
 * No momento a API só possui rotas de *preferências* de notificação
 * (`/cidadao/conta/notificacoes/preferencias`), não de listagem — portanto o
 * fetch fica DESABILITADO por padrão (`enabled: false`) e o hook opera apenas
 * com o estado em memória. Ao adicionar `GET /notificacoes`, basta habilitar a
 * query (remover/ajustar o guard) para a carga inicial passar a funcionar.
 *
 * _Requirements: 5.9, 6.1_
 */

/** Endpoint (futuro) de listagem de notificações persistidas do painel. */
const NOTIFICACOES_ENDPOINT = '/notificacoes';

/**
 * Ative para ligar a carga inicial assim que o endpoint estiver disponível na
 * API. Mantido em `false` enquanto a rota não existe, evitando 404 em runtime.
 */
const CARGA_INICIAL_HABILITADA = false;

/** Formato esperado da resposta da API (quando o endpoint existir). */
interface NotificacaoApi {
  id: string;
  tipo: string;
  conteudo: string;
  lida: boolean;
  criadaEm: string;
}

/** Mapeia a notificação da API para o formato do store. */
function mapNotificacao(dto: NotificacaoApi): Notificacao {
  return {
    id: dto.id,
    tipo: dto.tipo,
    conteudo: dto.conteudo,
    lida: dto.lida,
    criadaEm: dto.criadaEm,
  };
}

/** Busca a lista persistida (usada apenas quando `CARGA_INICIAL_HABILITADA`). */
async function fetchNotificacoes(): Promise<Notificacao[]> {
  const { data } = await axiosInstance.get<NotificacaoApi[]>(NOTIFICACOES_ENDPOINT);
  return data.map(mapNotificacao);
}

export interface UseNotificacoesResult {
  /** Lista atual de notificações (mais recente primeiro). */
  notificacoes: Notificacao[];
  /** Quantidade de não lidas (derivado). */
  naoLidas: number;
  /** True enquanto a carga inicial está em andamento. */
  carregando: boolean;
  /** Marca uma notificação específica como lida. */
  marcarComoLida: (id: string) => void;
  /** Marca todas como lidas. */
  marcarTodasComoLidas: () => void;
}

export function useNotificacoes(): UseNotificacoesResult {
  const notificacoes = useNotificacaoStore((s) => s.notificacoes);
  const naoLidas = useNotificacaoStore((s) => s.naoLidas);
  const marcarComoLida = useNotificacaoStore((s) => s.marcarComoLida);
  const marcarTodasComoLidas = useNotificacaoStore((s) => s.marcarTodasComoLidas);
  const setNotificacoes = useNotificacaoStore((s) => s.setNotificacoes);

  // Carga inicial das notificações persistidas. Desabilitada até a API expor o
  // endpoint; quando habilitada, popula o store via `setNotificacoes`.
  const { isLoading } = useQuery({
    queryKey: queryKeys.notificacoes(),
    queryFn: async () => {
      const lista = await fetchNotificacoes();
      setNotificacoes(lista);
      return lista;
    },
    enabled: CARGA_INICIAL_HABILITADA,
  });

  return {
    notificacoes,
    naoLidas,
    carregando: isLoading,
    marcarComoLida,
    marcarTodasComoLidas,
  };
}

export default useNotificacoes;
