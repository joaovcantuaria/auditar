import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorCodes } from '@auditar/shared';

// Stub da infra para não abrir conexão real ao importar o serviço.
vi.mock('../../../config/database.js', () => ({ prisma: {} }));
vi.mock('../../../config/minio.js', () => ({ minio: {} }));
vi.mock('../../../config/env.js', () => ({
  env: { MINIO_BUCKET_PROCESSOS: 'processos' },
}));
vi.mock('../../auditoria/index.js', () => ({ registrar: vi.fn() }));

import {
  validarArquivo,
  gerarUploadUrl,
  confirmarUpload,
  gerarDownloadUrl,
  listarDocumentos,
  sanitizeFilename,
  FORMATOS_PERMITIDOS,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  MAX_FILES,
  type DocumentosDeps,
  type AtorDocumento,
} from '../documentos.service.js';
import { AppError } from '../../../utils/index.js';

// ---------------------------------------------------------------------------
// Mocks das dependências injetadas
// ---------------------------------------------------------------------------

const documentoMock = {
  findMany: vi.fn(),
  aggregate: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  findUnique: vi.fn(),
};

const processoMock = {
  findUnique: vi.fn(),
};

const presignedPutObject = vi.fn();
const presignedGetObject = vi.fn();

const auditarMock = vi.fn();

function deps(): Partial<DocumentosDeps> {
  return {
    prisma: { documento: documentoMock, processo: processoMock } as unknown as DocumentosDeps['prisma'],
    minio: { presignedPutObject, presignedGetObject },
    auditar: auditarMock,
  };
}

const ATOR_CIDADAO: AtorDocumento = {
  ator: 'cidadao',
  atorCidadaoId: 'cid-1',
  enderecoIp: '203.0.113.10',
};

const PROCESSO_ID = 'proc-1';
const UNIDADE_ID = 'uni-1';

function arquivoValido(overrides: Record<string, unknown> = {}) {
  return {
    nomeOriginal: 'comprovante.pdf',
    mimeType: 'application/pdf',
    tamanhoBytes: 1024,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  auditarMock.mockResolvedValue(undefined);
  presignedPutObject.mockResolvedValue('https://minio.local/put-fake-url');
  presignedGetObject.mockResolvedValue('https://minio.local/get-fake-url');
  documentoMock.aggregate.mockResolvedValue({ _sum: { tamanhoBytes: 0 } });
  documentoMock.count.mockResolvedValue(0);
});

// ---------------------------------------------------------------------------
// sanitizeFilename
// ---------------------------------------------------------------------------

describe('sanitizeFilename', () => {
  it('remove separadores de caminho', () => {
    expect(sanitizeFilename('../../etc/passwd')).not.toMatch(/[/\\]/);
    expect(sanitizeFilename('C:\\Users\\a\\arquivo.pdf')).toBe('arquivo.pdf');
  });

  it('substitui caracteres inseguros mantendo a extensão', () => {
    expect(sanitizeFilename('meu arquivo (1)!.pdf')).toBe('meu_arquivo__1__.pdf');
  });
});

// ---------------------------------------------------------------------------
// validarArquivo (Req. 4.5, 4.7)
// ---------------------------------------------------------------------------

describe('validarArquivo', () => {
  it('aceita todos os formatos permitidos', () => {
    for (const ext of FORMATOS_PERMITIDOS) {
      const mimePorExtensao: Record<string, string> = {
        pdf: 'application/pdf',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        doc: 'application/msword',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      };
      expect(() =>
        validarArquivo(
          arquivoValido({ nomeOriginal: `arquivo.${ext}`, mimeType: mimePorExtensao[ext] }),
        ),
      ).not.toThrow();
    }
  });

  it('rejeita formato não permitido (.exe)', () => {
    try {
      validarArquivo(arquivoValido({ nomeOriginal: 'virus.exe', mimeType: 'application/x-msdownload' }));
      throw new Error('deveria ter lançado');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe(ErrorCodes.ARQUIVO_FORMATO_INVALIDO);
    }
  });

  it('rejeita arquivo acima de 10MB', () => {
    try {
      validarArquivo(arquivoValido({ tamanhoBytes: MAX_FILE_BYTES + 1 }));
      throw new Error('deveria ter lançado');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe(ErrorCodes.ARQUIVO_MUITO_GRANDE);
    }
  });

  it('aceita arquivo exatamente no limite de 10MB', () => {
    expect(() => validarArquivo(arquivoValido({ tamanhoBytes: MAX_FILE_BYTES }))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// gerarUploadUrl (Req. 4.5, 4.7, 5.4)
// ---------------------------------------------------------------------------

describe('gerarUploadUrl', () => {
  it('rejeita quando o processo já possui MAX_FILES arquivos', async () => {
    documentoMock.count.mockResolvedValue(MAX_FILES);

    await expect(
      gerarUploadUrl(PROCESSO_ID, UNIDADE_ID, arquivoValido(), ATOR_CIDADAO, deps()),
    ).rejects.toMatchObject({ code: ErrorCodes.LIMITE_ARQUIVOS });

    expect(presignedPutObject).not.toHaveBeenCalled();
  });

  it('rejeita quando a soma total ultrapassaria 50MB', async () => {
    documentoMock.aggregate.mockResolvedValue({ _sum: { tamanhoBytes: MAX_TOTAL_BYTES - 100 } });

    await expect(
      gerarUploadUrl(PROCESSO_ID, UNIDADE_ID, arquivoValido({ tamanhoBytes: 200 }), ATOR_CIDADAO, deps()),
    ).rejects.toMatchObject({ code: ErrorCodes.ARQUIVO_MUITO_GRANDE });

    expect(presignedPutObject).not.toHaveBeenCalled();
  });

  it('preserva os arquivos existentes ao rejeitar (não chama delete/remove)', async () => {
    documentoMock.count.mockResolvedValue(MAX_FILES);

    await expect(
      gerarUploadUrl(PROCESSO_ID, UNIDADE_ID, arquivoValido(), ATOR_CIDADAO, deps()),
    ).rejects.toBeInstanceOf(AppError);

    expect(documentoMock.create).not.toHaveBeenCalled();
  });

  it('retorna uma presigned URL e um caminhoStorage no formato esperado', async () => {
    const resultado = await gerarUploadUrl(
      PROCESSO_ID,
      UNIDADE_ID,
      arquivoValido(),
      ATOR_CIDADAO,
      deps(),
    );

    expect(resultado.uploadUrl).toBe('https://minio.local/put-fake-url');
    expect(resultado.caminhoStorage).toMatch(
      new RegExp(`^processos/${UNIDADE_ID}/${PROCESSO_ID}/[0-9a-f-]+-comprovante\\.pdf$`),
    );
    expect(new Date(resultado.expiraEm).getTime()).toBeGreaterThan(Date.now());

    expect(presignedPutObject).toHaveBeenCalledWith('processos', resultado.caminhoStorage, 300);
  });

  it('valida o arquivo antes de consultar os limites agregados', async () => {
    await expect(
      gerarUploadUrl(
        PROCESSO_ID,
        UNIDADE_ID,
        arquivoValido({ nomeOriginal: 'virus.exe', mimeType: 'application/x-msdownload' }),
        ATOR_CIDADAO,
        deps(),
      ),
    ).rejects.toMatchObject({ code: ErrorCodes.ARQUIVO_FORMATO_INVALIDO });

    expect(documentoMock.aggregate).not.toHaveBeenCalled();
    expect(documentoMock.count).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// confirmarUpload (Req. 4.5, 5.4)
// ---------------------------------------------------------------------------

describe('confirmarUpload', () => {
  it('persiste um Documento e audita anexar_documento', async () => {
    const documentoCriado = {
      id: 'doc-1',
      processoId: PROCESSO_ID,
      nomeOriginal: 'comprovante.pdf',
      mimeType: 'application/pdf',
      tamanhoBytes: 1024,
      caminhoStorage: `processos/${UNIDADE_ID}/${PROCESSO_ID}/uuid-comprovante.pdf`,
      enviadoPorCidadao: true,
      enviadoPorId: 'cid-1',
      enviadoEm: new Date(),
    };
    documentoMock.create.mockResolvedValue(documentoCriado);

    const resultado = await confirmarUpload(
      PROCESSO_ID,
      arquivoValido(),
      documentoCriado.caminhoStorage,
      'cid-1',
      true,
      ATOR_CIDADAO,
      deps(),
    );

    expect(documentoMock.create).toHaveBeenCalledWith({
      data: {
        processoId: PROCESSO_ID,
        nomeOriginal: 'comprovante.pdf',
        mimeType: 'application/pdf',
        tamanhoBytes: 1024,
        caminhoStorage: documentoCriado.caminhoStorage,
        enviadoPorCidadao: true,
        enviadoPorId: 'cid-1',
      },
    });

    expect(auditarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tipoAcao: 'anexar_documento',
        modulo: 'processos',
        objetoId: PROCESSO_ID,
        tipoObjeto: 'Processo',
        ator: 'cidadao',
        atorCidadaoId: 'cid-1',
      }),
    );

    expect(resultado).toEqual(documentoCriado);
  });
});

// ---------------------------------------------------------------------------
// gerarDownloadUrl (Req. 5.4)
// ---------------------------------------------------------------------------

describe('gerarDownloadUrl', () => {
  const DOCUMENTO_ID = 'doc-1';

  function documentoComProcesso(cidadaoId: string) {
    return {
      id: DOCUMENTO_ID,
      processoId: PROCESSO_ID,
      nomeOriginal: 'comprovante.pdf',
      caminhoStorage: `processos/${UNIDADE_ID}/${PROCESSO_ID}/uuid-comprovante.pdf`,
      processo: { cidadaoId },
    };
  }

  it('retorna uma presigned GET url e audita download_documento', async () => {
    documentoMock.findUnique.mockResolvedValue(documentoComProcesso('cid-1'));

    const resultado = await gerarDownloadUrl(DOCUMENTO_ID, 'cid-1', deps());

    expect(resultado.downloadUrl).toBe('https://minio.local/get-fake-url');
    expect(resultado.nomeOriginal).toBe('comprovante.pdf');
    expect(presignedGetObject).toHaveBeenCalledWith(
      'processos',
      `processos/${UNIDADE_ID}/${PROCESSO_ID}/uuid-comprovante.pdf`,
      300,
    );
    expect(auditarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tipoAcao: 'download_documento',
        modulo: 'processos',
        objetoId: PROCESSO_ID,
        tipoObjeto: 'Processo',
      }),
    );
  });

  it('permite servidor (sem solicitanteCidadaoId) baixar sem checagem de ownership', async () => {
    documentoMock.findUnique.mockResolvedValue(documentoComProcesso('cid-1'));

    const resultado = await gerarDownloadUrl(DOCUMENTO_ID, undefined, deps());

    expect(resultado.downloadUrl).toBe('https://minio.local/get-fake-url');
  });

  it('rejeita com 404 quando solicitanteCidadaoId não corresponde ao dono do processo', async () => {
    documentoMock.findUnique.mockResolvedValue(documentoComProcesso('cid-dono'));

    await expect(gerarDownloadUrl(DOCUMENTO_ID, 'cid-intruso', deps())).rejects.toMatchObject({
      statusCode: 404,
    });

    expect(presignedGetObject).not.toHaveBeenCalled();
  });

  it('rejeita com 404 quando o documento não existe', async () => {
    documentoMock.findUnique.mockResolvedValue(null);

    await expect(gerarDownloadUrl('doc-inexistente', 'cid-1', deps())).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

// ---------------------------------------------------------------------------
// listarDocumentos (Req. 5.4)
// ---------------------------------------------------------------------------

describe('listarDocumentos', () => {
  it('retorna a forma esperada ordenada por enviadoEm asc', async () => {
    const linhas = [
      {
        id: 'doc-1',
        nomeOriginal: 'a.pdf',
        tamanhoBytes: 100,
        enviadoEm: new Date('2024-01-01T00:00:00Z'),
        enviadoPorCidadao: true,
      },
      {
        id: 'doc-2',
        nomeOriginal: 'b.pdf',
        tamanhoBytes: 200,
        enviadoEm: new Date('2024-01-02T00:00:00Z'),
        enviadoPorCidadao: false,
      },
    ];
    documentoMock.findMany.mockResolvedValue(linhas);

    const resultado = await listarDocumentos(PROCESSO_ID, deps());

    expect(documentoMock.findMany).toHaveBeenCalledWith({
      where: { processoId: PROCESSO_ID },
      orderBy: { enviadoEm: 'asc' },
      select: {
        id: true,
        nomeOriginal: true,
        tamanhoBytes: true,
        enviadoEm: true,
        enviadoPorCidadao: true,
      },
    });
    expect(resultado).toEqual(linhas);
  });
});
