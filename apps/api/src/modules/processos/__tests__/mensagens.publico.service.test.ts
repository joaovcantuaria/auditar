import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorCodes, StatusProcesso, TipoEvento } from '@auditar/shared';

// Stub do barrel de auditoria: evita carregar `auditoria.worker.ts` (que
// importa `bullmq` como valor real) apenas por importar o serviço sob teste
// — mesmo padrão de `documentos.service.test.ts`.
vi.mock('../../auditoria/index.js', () => ({ registrar: vi.fn() }));

import {
  enviarMensagemCidadao,
  enviarMensagemServidor,
  STATUS_ENCERRADOS,
  type MensagensPublicoDeps,
} from '../mensagens.publico.service.js';

/**
 * Testes unitários do ENVIO de mensagens no canal público (Cidadão ↔
 * Servidor) de um Processo (Task 8.1).
 *
 * Todas as dependências (prisma, notificar) são injetadas explicitamente via
 * `deps` — nenhum I/O real é exercitado. O serviço só toca
 * `config/database.js`/`jobs/queues.js` de forma preguiçosa (apenas quando
 * `deps` está ausente), então não é necessário mockar esses módulos aqui
 * (mesmo padrão de `processos.service.test.ts`).
 *
 * Requisitos cobertos: 5.5, 5.6, 5.7, 13.1, 13.3, 13.7, 13.8
 */

const processoMock = {
  findUnique: vi.fn(),
};

const mensagemMock = {
  create: vi.fn(),
};

const notificarMock = vi.fn();
const auditarMock = vi.fn();

function deps(): Partial<MensagensPublicoDeps> {
  return {
    prisma: { processo: processoMock, mensagem: mensagemMock } as unknown as MensagensPublicoDeps['prisma'],
    notificar: notificarMock,
    auditar: auditarMock,
  };
}

function makeProcessoCidadao(overrides: Record<string, unknown> = {}) {
  return {
    cidadaoId: 'cid-1',
    status: StatusProcesso.EM_ANDAMENTO,
    servidorResponsavelId: 'srv-1',
    ...overrides,
  };
}

function makeProcessoServidor(overrides: Record<string, unknown> = {}) {
  return {
    cidadaoId: 'cid-1',
    status: StatusProcesso.EM_ANDAMENTO,
    cidadao: { ativo: true },
    ...overrides,
  };
}

function makeMensagemCriada(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    processoId: 'proc-1',
    canal: 'publico',
    conteudo: 'Olá, gostaria de saber o andamento',
    enviadaEm: new Date('2024-06-01T10:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  notificarMock.mockResolvedValue(undefined);
  auditarMock.mockResolvedValue(undefined);
  mensagemMock.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
    makeMensagemCriada(data),
  );
});

// ---------------------------------------------------------------------------
// STATUS_ENCERRADOS (Req 13.8)
// ---------------------------------------------------------------------------

describe('STATUS_ENCERRADOS', () => {
  it('inclui finalizado, rejeitado e aprovado', () => {
    expect(STATUS_ENCERRADOS).toEqual([
      StatusProcesso.FINALIZADO,
      StatusProcesso.REJEITADO,
      StatusProcesso.APROVADO,
    ]);
  });
});

// ---------------------------------------------------------------------------
// enviarMensagemCidadao (Req 5.5, 5.6, 5.7, 13.1, 13.8)
// ---------------------------------------------------------------------------

describe('enviarMensagemCidadao', () => {
  it('rejeita com 404 quando o Processo não existe', async () => {
    processoMock.findUnique.mockResolvedValue(null);

    await expect(
      enviarMensagemCidadao('proc-1', 'cid-1', 'Olá', deps()),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mensagemMock.create).not.toHaveBeenCalled();
  });

  it('rejeita com 404 quando o Processo pertence a outro cidadão (não revela existência)', async () => {
    processoMock.findUnique.mockResolvedValue(makeProcessoCidadao({ cidadaoId: 'outro-cid' }));

    await expect(
      enviarMensagemCidadao('proc-1', 'cid-1', 'Olá', deps()),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mensagemMock.create).not.toHaveBeenCalled();
  });

  it.each([StatusProcesso.FINALIZADO, StatusProcesso.REJEITADO, StatusProcesso.APROVADO])(
    'rejeita com 400 PROCESSO_ENCERRADO quando o status é %s (Req 13.8)',
    async (status) => {
      processoMock.findUnique.mockResolvedValue(makeProcessoCidadao({ status }));

      await expect(
        enviarMensagemCidadao('proc-1', 'cid-1', 'Olá', deps()),
      ).rejects.toMatchObject({ statusCode: 400, code: ErrorCodes.PROCESSO_ENCERRADO });
      expect(mensagemMock.create).not.toHaveBeenCalled();
    },
  );

  it('persiste a mensagem com remetenteCidadaoId e notifica o servidor responsável', async () => {
    processoMock.findUnique.mockResolvedValue(makeProcessoCidadao());

    const resultado = await enviarMensagemCidadao('proc-1', 'cid-1', 'Qual o andamento?', deps());

    expect(mensagemMock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        processoId: 'proc-1',
        canal: 'publico',
        conteudo: 'Qual o andamento?',
        remetenteCidadaoId: 'cid-1',
        enviadaEm: expect.any(Date),
      }),
    });
    expect(resultado.conteudo).toBe('Qual o andamento?');

    // Notificação é fire-and-forget: aguarda a microtask para o `.catch` já
    // registrado ser observável antes de checar a chamada.
    await Promise.resolve();
    expect(notificarMock).toHaveBeenCalledWith({
      tipo: 'painel',
      destinatario: { servidorId: 'srv-1' },
      tipoEvento: TipoEvento.NOVA_MENSAGEM,
      conteudo: 'Qual o andamento?',
      processoId: 'proc-1',
    });
  });

  it('não notifica quando o Processo não tem servidor responsável atribuído', async () => {
    processoMock.findUnique.mockResolvedValue(
      makeProcessoCidadao({ servidorResponsavelId: null }),
    );

    await enviarMensagemCidadao('proc-1', 'cid-1', 'Olá', deps());

    await Promise.resolve();
    expect(notificarMock).not.toHaveBeenCalled();
  });

  it('registra a resposta no Módulo_de_Auditoria com a identificação do Cidadão (Req 13.4)', async () => {
    processoMock.findUnique.mockResolvedValue(makeProcessoCidadao());

    await enviarMensagemCidadao('proc-1', 'cid-1', 'Qual o andamento?', deps());

    expect(auditarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tipoAcao: 'enviar_mensagem_cidadao',
        modulo: 'processos',
        objetoId: 'proc-1',
        tipoObjeto: 'Processo',
        ator: 'cidadao',
        atorCidadaoId: 'cid-1',
      }),
    );
  });

  it('mantém a mensagem persistida e não lança quando a notificação falha (Req 5.6, 5.7)', async () => {
    processoMock.findUnique.mockResolvedValue(makeProcessoCidadao());
    notificarMock.mockRejectedValue(new Error('fila indisponível'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const resultado = await enviarMensagemCidadao('proc-1', 'cid-1', 'Texto preservado', deps());

    expect(resultado.conteudo).toBe('Texto preservado');
    expect(mensagemMock.create).toHaveBeenCalledTimes(1);

    // Drena a microtask onde o `.catch` do fire-and-forget é executado.
    await Promise.resolve();
    await Promise.resolve();
    expect(errSpy).toHaveBeenCalled();

    errSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// enviarMensagemServidor (Req 13.1, 13.3, 13.7, 13.8)
// ---------------------------------------------------------------------------

describe('enviarMensagemServidor', () => {
  it('rejeita com 404 quando o Processo não existe', async () => {
    processoMock.findUnique.mockResolvedValue(null);

    await expect(
      enviarMensagemServidor('proc-1', 'srv-1', 'Olá', deps()),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mensagemMock.create).not.toHaveBeenCalled();
  });

  it.each([StatusProcesso.FINALIZADO, StatusProcesso.REJEITADO, StatusProcesso.APROVADO])(
    'rejeita com 400 PROCESSO_ENCERRADO quando o status é %s (Req 13.8)',
    async (status) => {
      processoMock.findUnique.mockResolvedValue(makeProcessoServidor({ status }));

      await expect(
        enviarMensagemServidor('proc-1', 'srv-1', 'Olá', deps()),
      ).rejects.toMatchObject({ statusCode: 400, code: ErrorCodes.PROCESSO_ENCERRADO });
      expect(mensagemMock.create).not.toHaveBeenCalled();
    },
  );

  it('persiste a mensagem com remetenteServidorId e retorna notificacaoEntregue=true no sucesso', async () => {
    processoMock.findUnique.mockResolvedValue(makeProcessoServidor());

    const resultado = await enviarMensagemServidor('proc-1', 'srv-1', 'Envie o documento X', deps());

    expect(mensagemMock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        processoId: 'proc-1',
        canal: 'publico',
        conteudo: 'Envie o documento X',
        remetenteServidorId: 'srv-1',
        enviadaEm: expect.any(Date),
      }),
    });
    expect(notificarMock).toHaveBeenCalledWith({
      tipo: 'painel',
      destinatario: { cidadaoId: 'cid-1' },
      tipoEvento: TipoEvento.NOVA_MENSAGEM,
      conteudo: 'Envie o documento X',
      processoId: 'proc-1',
    });
    expect(resultado.notificacaoEntregue).toBe(true);
    expect(resultado.mensagem.conteudo).toBe('Envie o documento X');
  });

  it('retorna notificacaoEntregue=false sem lançar quando o cidadão não tem conta ativa (Req 13.7)', async () => {
    processoMock.findUnique.mockResolvedValue(
      makeProcessoServidor({ cidadao: { ativo: false } }),
    );

    const resultado = await enviarMensagemServidor('proc-1', 'srv-1', 'Olá', deps());

    expect(mensagemMock.create).toHaveBeenCalledTimes(1);
    expect(notificarMock).not.toHaveBeenCalled();
    expect(resultado.notificacaoEntregue).toBe(false);
  });

  it('retorna notificacaoEntregue=false sem lançar quando a notificação falha', async () => {
    processoMock.findUnique.mockResolvedValue(makeProcessoServidor());
    notificarMock.mockRejectedValue(new Error('fila indisponível'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const resultado = await enviarMensagemServidor('proc-1', 'srv-1', 'Olá', deps());

    expect(mensagemMock.create).toHaveBeenCalledTimes(1);
    expect(resultado.notificacaoEntregue).toBe(false);
    expect(errSpy).toHaveBeenCalled();

    errSpy.mockRestore();
  });
});
