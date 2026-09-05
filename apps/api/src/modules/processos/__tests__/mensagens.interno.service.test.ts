import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorCodes, StatusProcesso, TipoEvento } from '@auditar/shared';

// Stub do barrel de auditoria: evita carregar `auditoria.worker.ts` (que
// importa `bullmq` como valor real) apenas por importar o serviço sob teste
// — mesmo padrão de `documentos.service.test.ts`.
vi.mock('../../../config/env.js', () => ({
  env: { MINIO_BUCKET_PROCESSOS: 'processos' },
}));
vi.mock('../../auditoria/index.js', () => ({ registrar: vi.fn() }));

import {
  enviarInterna,
  listarInternas,
  type MensagensInternoDeps,
} from '../mensagens.interno.service.js';

/**
 * Testes unitários do canal de mensagens internas (Servidor ↔ Servidor) de um
 * Processo (Task 8.2).
 *
 * Todas as dependências (prisma, notificar, auditar) são injetadas
 * explicitamente via `deps` — nenhum I/O real é exercitado. O serviço só
 * toca `config/database.js`/`jobs/queues.js` de forma preguiçosa (apenas
 * quando `deps` está ausente), então não é necessário mockar esses módulos
 * aqui (mesmo padrão de `mensagens.publico.service.test.ts`).
 *
 * Requisitos cobertos: 13.2, 13.4, 13.5, 13.6, 13.8
 */

const processoMock = {
  findUnique: vi.fn(),
};

const mensagemMock = {
  create: vi.fn(),
  findMany: vi.fn(),
};

const notificarMock = vi.fn();
const auditarMock = vi.fn();

function deps(): Partial<MensagensInternoDeps> {
  return {
    prisma: { processo: processoMock, mensagem: mensagemMock } as unknown as MensagensInternoDeps['prisma'],
    notificar: notificarMock,
    auditar: auditarMock,
  };
}

function makeProcesso(overrides: Record<string, unknown> = {}) {
  return {
    status: StatusProcesso.EM_ANDAMENTO,
    ...overrides,
  };
}

function makeMensagemCriada(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    processoId: 'proc-1',
    canal: 'interno',
    conteudo: 'Observação interna',
    remetenteServidorId: 'srv-1',
    destinatarioServidorId: null,
    caminhoAnexo: null,
    enviadaEm: new Date('2024-06-01T10:00:00Z'),
    ...overrides,
  };
}

function arquivoValido(overrides: Record<string, unknown> = {}) {
  return {
    nomeOriginal: 'comprovante.pdf',
    mimeType: 'application/pdf',
    tamanhoBytes: 1024,
    caminhoStorage: 'processos/uni-1/proc-1/uuid-comprovante.pdf',
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
// enviarInterna (Req 13.2, 13.5, 13.6, 13.8)
// ---------------------------------------------------------------------------

describe('enviarInterna', () => {
  it('rejeita com 404 quando o Processo não existe', async () => {
    processoMock.findUnique.mockResolvedValue(null);

    await expect(
      enviarInterna('proc-1', 'srv-1', { conteudo: 'Olá' }, deps()),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mensagemMock.create).not.toHaveBeenCalled();
  });

  it.each([StatusProcesso.FINALIZADO, StatusProcesso.REJEITADO, StatusProcesso.APROVADO])(
    'rejeita com 400 PROCESSO_ENCERRADO quando o status é %s (Req 13.8)',
    async (status) => {
      processoMock.findUnique.mockResolvedValue(makeProcesso({ status }));

      await expect(
        enviarInterna('proc-1', 'srv-1', { conteudo: 'Olá' }, deps()),
      ).rejects.toMatchObject({ statusCode: 400, code: ErrorCodes.PROCESSO_ENCERRADO });
      expect(mensagemMock.create).not.toHaveBeenCalled();
    },
  );

  it('persiste a mensagem sem anexo e sem destinatário, e não notifica ninguém', async () => {
    processoMock.findUnique.mockResolvedValue(makeProcesso());

    const resultado = await enviarInterna(
      'proc-1',
      'srv-1',
      { conteudo: 'Nota interna geral' },
      deps(),
    );

    expect(mensagemMock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        processoId: 'proc-1',
        canal: 'interno',
        conteudo: 'Nota interna geral',
        remetenteServidorId: 'srv-1',
        destinatarioServidorId: null,
        caminhoAnexo: null,
        enviadaEm: expect.any(Date),
      }),
    });
    expect(resultado.conteudo).toBe('Nota interna geral');

    await Promise.resolve();
    expect(notificarMock).not.toHaveBeenCalled();
  });

  it('persiste a mensagem com anexo válido, salvando caminhoAnexo', async () => {
    processoMock.findUnique.mockResolvedValue(makeProcesso());

    const resultado = await enviarInterna(
      'proc-1',
      'srv-1',
      { conteudo: 'Segue documento', anexo: arquivoValido() },
      deps(),
    );

    expect(mensagemMock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        caminhoAnexo: 'processos/uni-1/proc-1/uuid-comprovante.pdf',
      }),
    });
    expect(resultado.caminhoAnexo).toBe('processos/uni-1/proc-1/uuid-comprovante.pdf');
  });

  it('rejeita o anexo com formato inválido antes de criar a mensagem (Req 13.5)', async () => {
    processoMock.findUnique.mockResolvedValue(makeProcesso());

    await expect(
      enviarInterna(
        'proc-1',
        'srv-1',
        {
          conteudo: 'Segue vírus',
          anexo: arquivoValido({ nomeOriginal: 'virus.exe', mimeType: 'application/x-msdownload' }),
        },
        deps(),
      ),
    ).rejects.toMatchObject({ code: ErrorCodes.ARQUIVO_FORMATO_INVALIDO });

    expect(mensagemMock.create).not.toHaveBeenCalled();
  });

  it('rejeita o anexo acima de 10MB antes de criar a mensagem (Req 13.5)', async () => {
    processoMock.findUnique.mockResolvedValue(makeProcesso());

    await expect(
      enviarInterna(
        'proc-1',
        'srv-1',
        {
          conteudo: 'Arquivo grande',
          anexo: arquivoValido({ tamanhoBytes: 10 * 1024 * 1024 + 1 }),
        },
        deps(),
      ),
    ).rejects.toMatchObject({ code: ErrorCodes.ARQUIVO_MUITO_GRANDE });

    expect(mensagemMock.create).not.toHaveBeenCalled();
  });

  it('notifica o destinatário específico de forma fire-and-forget (Req 13.6)', async () => {
    processoMock.findUnique.mockResolvedValue(makeProcesso());

    await enviarInterna(
      'proc-1',
      'srv-1',
      { conteudo: 'Pode revisar isso?', destinatarioServidorId: 'srv-2' },
      deps(),
    );

    await Promise.resolve();
    expect(notificarMock).toHaveBeenCalledWith({
      tipo: 'painel',
      destinatario: { servidorId: 'srv-2' },
      tipoEvento: TipoEvento.NOVA_MENSAGEM,
      conteudo: 'Pode revisar isso?',
      processoId: 'proc-1',
    });
  });

  it('não notifica quando não há destinatarioServidorId (nota interna geral)', async () => {
    processoMock.findUnique.mockResolvedValue(makeProcesso());

    await enviarInterna('proc-1', 'srv-1', { conteudo: 'Nota geral' }, deps());

    await Promise.resolve();
    expect(notificarMock).not.toHaveBeenCalled();
  });

  it('mantém a mensagem persistida e não lança quando a notificação falha', async () => {
    processoMock.findUnique.mockResolvedValue(makeProcesso());
    notificarMock.mockRejectedValue(new Error('fila indisponível'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const resultado = await enviarInterna(
      'proc-1',
      'srv-1',
      { conteudo: 'Texto preservado', destinatarioServidorId: 'srv-2' },
      deps(),
    );

    expect(resultado.conteudo).toBe('Texto preservado');
    expect(mensagemMock.create).toHaveBeenCalledTimes(1);

    await Promise.resolve();
    await Promise.resolve();
    expect(errSpy).toHaveBeenCalled();

    errSpy.mockRestore();
  });

  it('registra sempre a ação no Módulo_de_Auditoria (Req 13.6)', async () => {
    processoMock.findUnique.mockResolvedValue(makeProcesso());

    await enviarInterna(
      'proc-1',
      'srv-1',
      { conteudo: 'Nota interna', destinatarioServidorId: 'srv-2' },
      deps(),
    );

    expect(auditarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tipoAcao: 'enviar_mensagem_interna',
        modulo: 'processos',
        objetoId: 'proc-1',
        tipoObjeto: 'Processo',
        ator: 'servidor',
        atorServidorId: 'srv-1',
      }),
    );
  });

  it('registra a auditoria mesmo sem destinatário específico', async () => {
    processoMock.findUnique.mockResolvedValue(makeProcesso());

    await enviarInterna('proc-1', 'srv-1', { conteudo: 'Nota geral' }, deps());

    expect(auditarMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// listarInternas (Req 13.2)
// ---------------------------------------------------------------------------

describe('listarInternas', () => {
  it('rejeita com 404 quando o Processo não existe', async () => {
    processoMock.findUnique.mockResolvedValue(null);

    await expect(listarInternas('proc-1', deps())).rejects.toMatchObject({ statusCode: 404 });
    expect(mensagemMock.findMany).not.toHaveBeenCalled();
  });

  it('lista apenas mensagens canal=interno, ordenadas por enviadaEm asc', async () => {
    processoMock.findUnique.mockResolvedValue({ id: 'proc-1' });
    const linhas = [
      {
        id: 'msg-1',
        conteudo: 'Primeira nota',
        remetenteServidor: { nome: 'Ana' },
        destinatarioServidorId: null,
        caminhoAnexo: null,
        enviadaEm: new Date('2024-01-01T00:00:00Z'),
      },
      {
        id: 'msg-2',
        conteudo: 'Segunda nota',
        remetenteServidor: { nome: 'Bruno' },
        destinatarioServidorId: 'srv-3',
        caminhoAnexo: 'processos/uni-1/proc-1/uuid-anexo.pdf',
        enviadaEm: new Date('2024-01-02T00:00:00Z'),
      },
    ];
    mensagemMock.findMany.mockResolvedValue(linhas);

    const resultado = await listarInternas('proc-1', deps());

    expect(mensagemMock.findMany).toHaveBeenCalledWith({
      where: { processoId: 'proc-1', canal: 'interno' },
      orderBy: { enviadaEm: 'asc' },
      select: {
        id: true,
        conteudo: true,
        remetenteServidor: { select: { nome: true } },
        destinatarioServidorId: true,
        caminhoAnexo: true,
        enviadaEm: true,
      },
    });
    expect(resultado).toEqual(linhas);
  });
});
