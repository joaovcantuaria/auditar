import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TipoEvento, CanalNotificacao } from '@auditar/shared';

// ---------------------------------------------------------------------------
// Stub do módulo de infra (prisma) para evitar carregar `@prisma/client` real
// ou abrir conexões ao IMPORTAR o serviço. Todos os testes injetam um mock
// explícito via `deps`.
// ---------------------------------------------------------------------------
vi.mock('../../../config/database.js', () => ({ prisma: {} }));

// Import AFTER mocks are registered.
import {
  obterPreferencias,
  salvarPreferencias,
  TODOS_TIPOS_EVENTO,
  CANAIS_PADRAO,
  type PreferenciasDeps,
} from '../preferencias.service.js';
import {
  preferenciaSchema,
  salvarPreferenciasSchema,
} from '../preferencias.schema.js';

// ---------------------------------------------------------------------------
// Mock do prisma injetado.
// ---------------------------------------------------------------------------

const prismaMock = {
  preferenciaNotificacao: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
};

function deps(): Partial<PreferenciasDeps> {
  return { prisma: prismaMock as unknown as PreferenciasDeps['prisma'] };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.preferenciaNotificacao.deleteMany.mockResolvedValue({ count: 0 });
  prismaMock.preferenciaNotificacao.createMany.mockResolvedValue({ count: 0 });
});

// ---------------------------------------------------------------------------
// obterPreferencias
// ---------------------------------------------------------------------------

describe('obterPreferencias', () => {
  it('retorna as linhas armazenadas e extrai o horário de silêncio', async () => {
    prismaMock.preferenciaNotificacao.findMany.mockResolvedValue([
      {
        id: 'p1',
        cidadaoId: 'cid-1',
        tipoEvento: TipoEvento.CRIACAO_PROCESSO,
        canais: [CanalNotificacao.EMAIL, CanalNotificacao.SMS],
        inicioSilencio: '22:00',
        fimSilencio: '07:00',
      },
      {
        id: 'p2',
        cidadaoId: 'cid-1',
        tipoEvento: TipoEvento.NOVA_MENSAGEM,
        canais: [CanalNotificacao.PAINEL],
        inicioSilencio: '22:00',
        fimSilencio: '07:00',
      },
    ]);

    const result = await obterPreferencias('cid-1', deps());

    expect(prismaMock.preferenciaNotificacao.findMany).toHaveBeenCalledWith({
      where: { cidadaoId: 'cid-1' },
    });
    expect(result.preferencias).toEqual([
      { tipoEvento: TipoEvento.CRIACAO_PROCESSO, canais: ['email', 'sms'] },
      { tipoEvento: TipoEvento.NOVA_MENSAGEM, canais: ['painel'] },
    ]);
    expect(result.inicioSilencio).toBe('22:00');
    expect(result.fimSilencio).toBe('07:00');
  });

  it('retorna os padrões (todos os eventos → [painel, email], sem silêncio) quando não há preferências', async () => {
    prismaMock.preferenciaNotificacao.findMany.mockResolvedValue([]);

    const result = await obterPreferencias('cid-1', deps());

    expect(result.preferencias).toHaveLength(TODOS_TIPOS_EVENTO.length);
    for (const pref of result.preferencias) {
      expect(pref.canais).toEqual(CANAIS_PADRAO);
    }
    // Cobre todos os tipos de evento.
    const eventos = result.preferencias.map((p) => p.tipoEvento).sort();
    expect(eventos).toEqual([...TODOS_TIPOS_EVENTO].sort());
    expect(result.inicioSilencio).toBeNull();
    expect(result.fimSilencio).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// salvarPreferencias
// ---------------------------------------------------------------------------

describe('salvarPreferencias', () => {
  it('persiste uma linha por evento com os canais escolhidos (Req 6.3)', async () => {
    const dto = {
      preferencias: [
        {
          tipoEvento: TipoEvento.APROVACAO,
          canais: [CanalNotificacao.EMAIL, CanalNotificacao.PUSH],
        },
        {
          tipoEvento: TipoEvento.REJEICAO,
          canais: [CanalNotificacao.PAINEL],
        },
      ],
    };

    const result = await salvarPreferencias('cid-1', dto, deps());

    // Remove as antigas antes de recriar.
    expect(prismaMock.preferenciaNotificacao.deleteMany).toHaveBeenCalledWith({
      where: { cidadaoId: 'cid-1' },
    });
    expect(prismaMock.preferenciaNotificacao.createMany).toHaveBeenCalledWith({
      data: [
        {
          cidadaoId: 'cid-1',
          tipoEvento: TipoEvento.APROVACAO,
          canais: ['email', 'push'],
          inicioSilencio: null,
          fimSilencio: null,
        },
        {
          cidadaoId: 'cid-1',
          tipoEvento: TipoEvento.REJEICAO,
          canais: ['painel'],
          inicioSilencio: null,
          fimSilencio: null,
        },
      ],
    });
    expect(result.preferencias).toEqual(dto.preferencias);
  });

  it('replica o horário de silêncio em todas as linhas persistidas (Req 6.4)', async () => {
    const dto = {
      preferencias: [
        { tipoEvento: TipoEvento.VENCIMENTO_PRAZO, canais: [CanalNotificacao.EMAIL] },
        { tipoEvento: TipoEvento.NOVA_MENSAGEM, canais: [CanalNotificacao.SMS] },
      ],
      inicioSilencio: '22:00',
      fimSilencio: '07:00',
    };

    const result = await salvarPreferencias('cid-1', dto, deps());

    const call = prismaMock.preferenciaNotificacao.createMany.mock.calls[0][0];
    for (const row of call.data) {
      expect(row.inicioSilencio).toBe('22:00');
      expect(row.fimSilencio).toBe('07:00');
    }
    expect(result.inicioSilencio).toBe('22:00');
    expect(result.fimSilencio).toBe('07:00');
  });

  it('não chama createMany quando não há preferências, mas ainda limpa as antigas', async () => {
    const result = await salvarPreferencias('cid-1', { preferencias: [] }, deps());

    expect(prismaMock.preferenciaNotificacao.deleteMany).toHaveBeenCalledWith({
      where: { cidadaoId: 'cid-1' },
    });
    expect(prismaMock.preferenciaNotificacao.createMany).not.toHaveBeenCalled();
    expect(result.preferencias).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Validação de schema (Req 6.3, 6.4)
// ---------------------------------------------------------------------------

describe('salvarPreferenciasSchema / preferenciaSchema', () => {
  it('rejeita preferência com lista de canais vazia (Req 6.3)', () => {
    const result = preferenciaSchema.safeParse({
      tipoEvento: TipoEvento.APROVACAO,
      canais: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejeita horário de silêncio em formato inválido (fora de HH:MM)', () => {
    const invalidos = ['24:00', '9:00', '22:60', '2200', 'abc', '23:5'];
    for (const inicioSilencio of invalidos) {
      const result = salvarPreferenciasSchema.safeParse({
        preferencias: [
          { tipoEvento: TipoEvento.NOVA_MENSAGEM, canais: [CanalNotificacao.EMAIL] },
        ],
        inicioSilencio,
      });
      expect(result.success, `esperava rejeitar "${inicioSilencio}"`).toBe(false);
    }
  });

  it('aceita horário de silêncio válido em HH:MM e canais não vazios', () => {
    const result = salvarPreferenciasSchema.safeParse({
      preferencias: [
        {
          tipoEvento: TipoEvento.CRIACAO_PROCESSO,
          canais: [CanalNotificacao.EMAIL, CanalNotificacao.PAINEL],
        },
      ],
      inicioSilencio: '00:00',
      fimSilencio: '23:59',
    });
    expect(result.success).toBe(true);
  });

  it('rejeita tipo de evento inválido', () => {
    const result = preferenciaSchema.safeParse({
      tipoEvento: 'evento_inexistente',
      canais: [CanalNotificacao.EMAIL],
    });
    expect(result.success).toBe(false);
  });
});
