import { describe, it, expect, vi, beforeEach } from 'vitest';

// Infra stubs — nunca devem ser tocados porque todas as chamadas injetam `deps`
// explicitamente, mas mockamos por segurança (mesmo padrão de
// documentos.service.test.ts) para garantir que importar o módulo não abra
// nenhuma conexão real.
vi.mock('../../config/database.js', () => ({ prisma: {} }));
vi.mock('../../config/mailer.js', () => ({ mailer: {}, fromAddress: 'Auditar <no-reply@auditar>' }));
vi.mock('../../config/env.js', () => ({
  env: { FEATURE_SMS_ENABLED: false, FEATURE_PUSH_ENABLED: false },
}));
// bullmq/bullmqConnection são importados como valores no módulo sob teste;
// mockamos para não abrir conexão Redis ao importar (mesmo padrão de
// queues.test.ts). O Worker não é instanciado nestes testes unitários.
vi.mock('bullmq', () => ({ Worker: class {}, Queue: class {} }));
vi.mock('../../config/bullmq.js', () => ({ bullmqConnection: {} }));

import {
  processarNotificacao,
  gravarPainel,
  enviarEmail,
  enviarSms,
  enviarPush,
  calcularDelaySilencio,
  deveEntregar,
  tratarFalhaFinal,
  ehUltimaTentativa,
  type NotificacaoDeps,
} from '../notificacao.worker.js';
import type { NotificacaoJob } from '../types.js';
import type { Job } from 'bullmq';

// ---------------------------------------------------------------------------
// Mocks das dependências injetadas
// ---------------------------------------------------------------------------

const notificacaoMock = { create: vi.fn() };
const preferenciaMock = { findMany: vi.fn() };
const sendMailMock = vi.fn();
const emitMock = vi.fn();
const enqueueMock = vi.fn();

const AGORA = new Date('2024-06-01T12:00:00'); // meio-dia local, fora de silêncio

function deps(overrides: Partial<NotificacaoDeps> = {}): Partial<NotificacaoDeps> {
  return {
    prisma: {
      notificacao: notificacaoMock,
      preferenciaNotificacao: preferenciaMock,
    } as unknown as NotificacaoDeps['prisma'],
    mailer: { sendMail: sendMailMock },
    fromAddress: 'Auditar <no-reply@auditar>',
    emit: emitMock,
    enqueue: enqueueMock,
    smsEnabled: false,
    pushEnabled: false,
    agora: () => AGORA,
    ...overrides,
  };
}

function job(data: Partial<NotificacaoJob> = {}): Job<NotificacaoJob> {
  return {
    data: {
      tipo: 'painel',
      destinatario: { cidadaoId: 'cid-1' },
      tipoEvento: 'aprovacao',
      conteudo: 'Seu processo foi aprovado.',
      ...data,
    },
    attemptsMade: 0,
    opts: { attempts: 3 },
  } as unknown as Job<NotificacaoJob>;
}

beforeEach(() => {
  vi.clearAllMocks();
  notificacaoMock.create.mockResolvedValue({ id: 'notif-1' });
  preferenciaMock.findMany.mockResolvedValue([]);
  sendMailMock.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// calcularDelaySilencio (função pura)
// ---------------------------------------------------------------------------

describe('calcularDelaySilencio', () => {
  it('retorna 0 quando não há janela configurada', () => {
    expect(calcularDelaySilencio(new Date('2024-06-01T03:00:00'), null, null)).toBe(0);
    expect(calcularDelaySilencio(new Date('2024-06-01T03:00:00'), '22:00', null)).toBe(0);
    expect(calcularDelaySilencio(new Date('2024-06-01T03:00:00'), '22:00', '22:00')).toBe(0);
  });

  it('retorna 0 quando NOW está fora de uma janela no mesmo dia', () => {
    // janela 08:00–12:00, agora 15:00 → fora
    expect(calcularDelaySilencio(new Date('2024-06-01T15:00:00'), '08:00', '12:00')).toBe(0);
  });

  it('retorna o tempo restante quando NOW está dentro de janela no mesmo dia', () => {
    // janela 08:00–12:00, agora 11:00 → falta 1h
    const delay = calcularDelaySilencio(new Date('2024-06-01T11:00:00'), '08:00', '12:00');
    expect(delay).toBe(60 * 60 * 1000);
  });

  it('lida com janela que cruza a meia-noite (22:00–07:00), NOW após 22:00', () => {
    // agora 23:00 → falta até 07:00 = 8h
    const delay = calcularDelaySilencio(new Date('2024-06-01T23:00:00'), '22:00', '07:00');
    expect(delay).toBe(8 * 60 * 60 * 1000);
  });

  it('lida com janela que cruza a meia-noite (22:00–07:00), NOW antes das 07:00', () => {
    // agora 02:00 → falta até 07:00 = 5h
    const delay = calcularDelaySilencio(new Date('2024-06-01T02:00:00'), '22:00', '07:00');
    expect(delay).toBe(5 * 60 * 60 * 1000);
  });

  it('retorna 0 quando NOW está fora de janela que cruza a meia-noite', () => {
    // janela 22:00–07:00, agora 12:00 → fora
    expect(calcularDelaySilencio(new Date('2024-06-01T12:00:00'), '22:00', '07:00')).toBe(0);
  });

  it('desconta segundos/millis já decorridos no minuto atual', () => {
    // agora 11:59:30, janela 08:00–12:00 → falta ~30s
    const delay = calcularDelaySilencio(new Date('2024-06-01T11:59:30.000'), '08:00', '12:00');
    expect(delay).toBe(30 * 1000);
  });
});

// ---------------------------------------------------------------------------
// deveEntregar
// ---------------------------------------------------------------------------

describe('deveEntregar', () => {
  it('painel sempre é entregue, mesmo sem preferências ou com opt-out', () => {
    expect(deveEntregar(job({ tipo: 'painel' }).data, [])).toBe(true);
    expect(
      deveEntregar(job({ tipo: 'painel' }).data, [{ tipoEvento: 'aprovacao', canais: ['email'] }]),
    ).toBe(true);
  });

  it('entrega canal não-painel apenas quando habilitado para o evento', () => {
    const prefs = [{ tipoEvento: 'aprovacao', canais: ['email', 'painel'] }];
    expect(deveEntregar(job({ tipo: 'email' }).data, prefs)).toBe(true);
    expect(deveEntregar(job({ tipo: 'sms' }).data, prefs)).toBe(false);
  });

  it('não entrega canal não-painel quando não há preferências (Req. 6.7)', () => {
    expect(deveEntregar(job({ tipo: 'email' }).data, [])).toBe(false);
    expect(deveEntregar(job({ tipo: 'email' }).data, null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Roteamento por tipo + canais
// ---------------------------------------------------------------------------

describe('gravarPainel', () => {
  it('persiste Notificacao (entregue=true, canal=painel) e emite via Socket.io', async () => {
    await gravarPainel(job({ tipo: 'painel' }).data, deps());

    expect(notificacaoMock.create).toHaveBeenCalledTimes(1);
    const arg = notificacaoMock.create.mock.calls[0][0].data;
    expect(arg).toMatchObject({
      cidadaoId: 'cid-1',
      canal: 'painel',
      entregue: true,
      conteudo: 'Seu processo foi aprovado.',
    });
    expect(arg.entregueEm).toBeInstanceOf(Date);

    expect(emitMock).toHaveBeenCalledWith('cidadao:cid-1', 'notificacao:nova', {
      notificacaoId: 'notif-1',
      tipo: 'aprovacao',
      conteudo: 'Seu processo foi aprovado.',
    });
  });

  it('emite para sala de servidor quando destinatário é servidor', async () => {
    await gravarPainel(
      job({ tipo: 'painel', destinatario: { servidorId: 'srv-9' } }).data,
      deps(),
    );
    expect(emitMock).toHaveBeenCalledWith('servidor:srv-9', 'notificacao:nova', expect.any(Object));
  });
});

describe('enviarEmail', () => {
  it('entrega via mailer quando há endereço', async () => {
    const data = { ...job({ tipo: 'email' }).data, email: 'cidadao@ex.com' } as NotificacaoJob;
    await enviarEmail(data, deps());
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock.mock.calls[0][0]).toMatchObject({
      to: 'cidadao@ex.com',
      from: 'Auditar <no-reply@auditar>',
    });
  });

  it('re-lança o erro do mailer para acionar o retry do BullMQ (Req. 6.5)', async () => {
    sendMailMock.mockRejectedValueOnce(new Error('SMTP down'));
    const data = { ...job({ tipo: 'email' }).data, email: 'cidadao@ex.com' } as NotificacaoJob;
    await expect(enviarEmail(data, deps())).rejects.toThrow('SMTP down');
  });

  it('degrada para painel quando não há endereço de e-mail', async () => {
    await enviarEmail(job({ tipo: 'email' }).data, deps());
    expect(sendMailMock).not.toHaveBeenCalled();
    expect(notificacaoMock.create).toHaveBeenCalledTimes(1);
  });
});

describe('enviarSms / enviarPush — gated por feature flags', () => {
  it('SMS é no-op quando FEATURE_SMS_ENABLED=false', async () => {
    await enviarSms(job({ tipo: 'sms' }).data, deps({ smsEnabled: false }));
    // sem throw, sem I/O
    expect(notificacaoMock.create).not.toHaveBeenCalled();
  });

  it('Push é no-op quando FEATURE_PUSH_ENABLED=false', async () => {
    await enviarPush(job({ tipo: 'push' }).data, deps({ pushEnabled: false }));
    expect(notificacaoMock.create).not.toHaveBeenCalled();
  });

  it('SMS executa o caminho de envio (stub) quando habilitado', async () => {
    await expect(enviarSms(job({ tipo: 'sms' }).data, deps({ smsEnabled: true }))).resolves.toBeUndefined();
  });
});

describe('processarNotificacao — roteamento', () => {
  it('roteia painel → grava Notificacao', async () => {
    await processarNotificacao(job({ tipo: 'painel' }), deps());
    expect(notificacaoMock.create).toHaveBeenCalledTimes(1);
    expect(notificacaoMock.create.mock.calls[0][0].data.canal).toBe('painel');
  });

  it('servidor sempre recebe (sem consultar preferências)', async () => {
    await processarNotificacao(
      job({ tipo: 'painel', destinatario: { servidorId: 'srv-1' } }),
      deps(),
    );
    expect(preferenciaMock.findMany).not.toHaveBeenCalled();
    expect(notificacaoMock.create).toHaveBeenCalledTimes(1);
  });

  it('cidadão com opt-out de e-mail → não entrega (Req. 6.2)', async () => {
    preferenciaMock.findMany.mockResolvedValueOnce([
      { tipoEvento: 'aprovacao', canais: ['painel'], inicioSilencio: null, fimSilencio: null },
    ]);
    await processarNotificacao(job({ tipo: 'email' }), deps());
    expect(sendMailMock).not.toHaveBeenCalled();
    expect(notificacaoMock.create).not.toHaveBeenCalled();
  });

  it('cidadão com e-mail habilitado → entrega via mailer', async () => {
    preferenciaMock.findMany.mockResolvedValueOnce([
      { tipoEvento: 'aprovacao', canais: ['email'], inicioSilencio: null, fimSilencio: null },
    ]);
    const j = job({ tipo: 'email' });
    (j.data as { email?: string }).email = 'cidadao@ex.com';
    await processarNotificacao(j, deps());
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });
});

describe('processarNotificacao — horário de silêncio (Req. 6.4)', () => {
  it('reenfileira com delay quando NOW está dentro da janela em vez de entregar', async () => {
    preferenciaMock.findMany.mockResolvedValueOnce([
      { tipoEvento: 'aprovacao', canais: ['painel'], inicioSilencio: '08:00', fimSilencio: '13:00' },
    ]);
    // AGORA é meio-dia → dentro de 08:00–13:00, falta 1h
    await processarNotificacao(job({ tipo: 'painel' }), deps());

    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const [, opts] = enqueueMock.mock.calls[0];
    expect(opts.delay).toBe(60 * 60 * 1000);
    // Não entregou agora
    expect(notificacaoMock.create).not.toHaveBeenCalled();
  });

  it('entrega normalmente quando NOW está fora da janela', async () => {
    preferenciaMock.findMany.mockResolvedValueOnce([
      { tipoEvento: 'aprovacao', canais: ['painel'], inicioSilencio: '22:00', fimSilencio: '07:00' },
    ]);
    // AGORA meio-dia → fora de 22:00–07:00
    await processarNotificacao(job({ tipo: 'painel' }), deps());
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(notificacaoMock.create).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Fallback após falha final (Req. 6.5)
// ---------------------------------------------------------------------------

describe('ehUltimaTentativa', () => {
  it('true quando attemptsMade atinge o máximo', () => {
    expect(ehUltimaTentativa({ attemptsMade: 3, opts: { attempts: 3 } } as Job)).toBe(true);
    expect(ehUltimaTentativa({ attemptsMade: 2, opts: { attempts: 3 } } as Job)).toBe(false);
    expect(ehUltimaTentativa({ attemptsMade: 3, opts: {} } as unknown as Job)).toBe(true);
  });
});

describe('tratarFalhaFinal', () => {
  it('registra a falha (entregue=false, canal, tentativas) e entrega via painel', async () => {
    const data = job({ tipo: 'email' }).data;
    await tratarFalhaFinal(data, 3, deps());

    // Duas linhas: a de falha e a do painel de fallback
    expect(notificacaoMock.create).toHaveBeenCalledTimes(2);

    const falha = notificacaoMock.create.mock.calls[0][0].data;
    expect(falha).toMatchObject({
      canal: 'email',
      tipoEvento: 'aprovacao',
      entregue: false,
      tentativas: 3,
    });

    const painel = notificacaoMock.create.mock.calls[1][0].data;
    expect(painel).toMatchObject({ canal: 'painel', entregue: true });

    // Fallback também emite em tempo real
    expect(emitMock).toHaveBeenCalledWith('cidadao:cid-1', 'notificacao:nova', expect.any(Object));
  });
});
