import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Socket } from 'socket.io-client';

// Mocka o queryClient compartilhado para inspecionar as invalidações.
vi.mock('@/lib/queryClient', () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));

import { queryClient } from '@/lib/queryClient';
import { useNotificacaoStore } from '@/store/notificacaoStore';
import {
  registrarListeners,
  SOCKET_EVENTS,
  queryKeys,
  type ProcessoStatusAtualizadoPayload,
  type ProcessoNovaMensagemPayload,
  type ProcessoAtribuidoPayload,
  type ProcessoEtapaAvancadaPayload,
  type FilaNovoProcessoPayload,
  type NotificacaoNovaPayload,
} from '../useSocket';

type Listener = (payload: unknown) => void;

/**
 * Socket falso: registra listeners em um mapa e permite disparar eventos
 * manualmente, sem qualquer conexão real.
 */
function createFakeSocket() {
  const listeners = new Map<string, Listener>();
  const socket = {
    on: vi.fn((event: string, fn: Listener) => {
      listeners.set(event, fn);
    }),
    off: vi.fn((event: string) => {
      listeners.delete(event);
    }),
  } as unknown as Socket;

  const emit = (event: string, payload: unknown) => {
    const fn = listeners.get(event);
    if (!fn) throw new Error(`Nenhum listener registrado para ${event}`);
    fn(payload);
  };

  return { socket, listeners, emit };
}

const invalidateMock = queryClient.invalidateQueries as unknown as ReturnType<typeof vi.fn>;

describe('useSocket · registrarListeners', () => {
  beforeEach(() => {
    invalidateMock.mockClear();
    useNotificacaoStore.setState({ notificacoes: [], naoLidas: 0 });
  });

  it('invalida lista e detalhe do processo em processo:status_atualizado', () => {
    const { socket, emit } = createFakeSocket();
    registrarListeners(socket);

    const payload: ProcessoStatusAtualizadoPayload = {
      processoId: 'p1',
      novoStatus: 'em_analise',
      etapa: 'triagem',
    };
    emit(SOCKET_EVENTS.processoStatusAtualizado, payload);

    expect(invalidateMock).toHaveBeenCalledWith({ queryKey: queryKeys.processos() });
    expect(invalidateMock).toHaveBeenCalledWith({ queryKey: queryKeys.processo('p1') });
  });

  it('invalida lista e detalhe em processo:etapa_avancada', () => {
    const { socket, emit } = createFakeSocket();
    registrarListeners(socket);

    const payload: ProcessoEtapaAvancadaPayload = {
      processoId: 'p2',
      etapaDestino: 'parecer',
    };
    emit(SOCKET_EVENTS.processoEtapaAvancada, payload);

    expect(invalidateMock).toHaveBeenCalledWith({ queryKey: queryKeys.processos() });
    expect(invalidateMock).toHaveBeenCalledWith({ queryKey: queryKeys.processo('p2') });
  });

  it('invalida lista e detalhe em processo:atribuido', () => {
    const { socket, emit } = createFakeSocket();
    registrarListeners(socket);

    const payload: ProcessoAtribuidoPayload = { processoId: 'p3', servidorId: 's1' };
    emit(SOCKET_EVENTS.processoAtribuido, payload);

    expect(invalidateMock).toHaveBeenCalledWith({ queryKey: queryKeys.processos() });
    expect(invalidateMock).toHaveBeenCalledWith({ queryKey: queryKeys.processo('p3') });
  });

  it('invalida mensagens do processo em processo:nova_mensagem', () => {
    const { socket, emit } = createFakeSocket();
    registrarListeners(socket);

    const payload: ProcessoNovaMensagemPayload = {
      mensagemId: 'm1',
      processoId: 'p4',
      remetente: 'servidor',
      conteudo: 'Olá',
    };
    emit(SOCKET_EVENTS.processoNovaMensagem, payload);

    expect(invalidateMock).toHaveBeenCalledWith({
      queryKey: queryKeys.processoMensagens('p4'),
    });
  });

  it('invalida fila e lista de processos em fila:novo_processo', () => {
    const { socket, emit } = createFakeSocket();
    registrarListeners(socket);

    const payload: FilaNovoProcessoPayload = { processoId: 'p5', protocolo: '2025-00001' };
    emit(SOCKET_EVENTS.filaNovoProcesso, payload);

    expect(invalidateMock).toHaveBeenCalledWith({ queryKey: queryKeys.fila() });
    expect(invalidateMock).toHaveBeenCalledWith({ queryKey: queryKeys.processos() });
  });

  it('invalida dashboard em dashboard:atualizar', () => {
    const { socket, emit } = createFakeSocket();
    registrarListeners(socket);

    emit(SOCKET_EVENTS.dashboardAtualizar, {});

    expect(invalidateMock).toHaveBeenCalledWith({ queryKey: queryKeys.dashboard() });
  });

  it('adiciona notificação ao store e invalida em notificacao:nova', () => {
    const { socket, emit } = createFakeSocket();
    registrarListeners(socket);

    const payload: NotificacaoNovaPayload = {
      notificacaoId: 'n1',
      tipo: 'nova_mensagem',
      conteudo: 'Você tem uma nova mensagem',
    };
    emit(SOCKET_EVENTS.notificacaoNova, payload);

    const state = useNotificacaoStore.getState();
    expect(state.notificacoes).toHaveLength(1);
    expect(state.notificacoes[0]).toMatchObject({
      id: 'n1',
      tipo: 'nova_mensagem',
      conteudo: 'Você tem uma nova mensagem',
      lida: false,
    });
    expect(state.naoLidas).toBe(1);
    expect(invalidateMock).toHaveBeenCalledWith({ queryKey: queryKeys.notificacoes() });
  });

  it('cleanup remove todos os listeners', () => {
    const { socket, listeners, emit } = createFakeSocket();
    const cleanup = registrarListeners(socket);
    expect(listeners.size).toBe(7);

    cleanup();
    expect(listeners.size).toBe(0);
    expect(() => emit(SOCKET_EVENTS.dashboardAtualizar, {})).toThrow();
  });
});
