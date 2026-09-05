import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import type { PrismaClient, Documento } from '@prisma/client';
import { ErrorCodes } from '@auditar/shared';
import { env } from '../../config/env.js';
import { badRequest, notFound, AppError } from '../../utils/index.js';
import { registrar as defaultRegistrar } from '../auditoria/index.js';
import type { RegistrarAuditoriaDto, AtorAuditoria } from '../auditoria/index.js';
import type { ArquivoInput } from './documentos.schema.js';

/**
 * Serviço de Upload/Download de Documentos via MinIO (Task 7.2).
 *
 * O binário do arquivo NUNCA passa pela API: o upload é feito diretamente do
 * navegador para o MinIO usando uma presigned URL (Req. 4.5, 5.4). O fluxo é:
 *
 *  1. `gerarUploadUrl` — valida formato/tamanho e os limites agregados do
 *     Processo, monta o caminho no bucket e devolve uma presigned URL de
 *     escrita (expiração de 5 minutos).
 *  2. O cliente faz o upload (PUT) diretamente ao MinIO usando essa URL.
 *  3. `confirmarUpload` — grava a linha `Documento` no banco após o upload
 *     confirmado e registra a Auditoria.
 *  4. `gerarDownloadUrl` — verifica autorização (ownership) e devolve uma
 *     presigned URL de leitura (expiração de 5 minutos), também auditada.
 *
 * Requisitos: 4.5, 4.7, 5.4
 */

const MODULO = 'processos';

// ---------------------------------------------------------------------------
// Constantes de validação (Req. 4.5, 4.7)
// ---------------------------------------------------------------------------

/** Extensões de arquivo permitidas para anexação a um Processo (Req. 4.5). */
export const FORMATOS_PERMITIDOS = ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx'] as const;
export type FormatoPermitido = (typeof FORMATOS_PERMITIDOS)[number];

/** MIME type aceito para cada extensão permitida — usado como checagem adicional. */
const MIME_TYPES_PERMITIDOS: Record<FormatoPermitido, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** Conjunto de todos os MIME types aceitos (independente da extensão específica). */
const MIME_TYPES_PERMITIDOS_SET = new Set(Object.values(MIME_TYPES_PERMITIDOS));

/** Tamanho máximo por arquivo: 10 MB (Req. 4.5, 4.7). */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Tamanho máximo total por Processo: 50 MB (Req. 4.5). */
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

/** Quantidade máxima de arquivos por Processo (Req. 4.5). */
export const MAX_FILES = 20;

/** Validade da presigned URL de upload/download: 5 minutos (Req. 4.5, 5.4). */
export const PRESIGNED_URL_TTL_SECONDS = 300;

// ---------------------------------------------------------------------------
// Metadados do arquivo (validados pelo controller via Zod)
// ---------------------------------------------------------------------------

/** Metadados de um arquivo informados pelo cliente antes do upload. */
export type ArquivoMetadados = ArquivoInput;

/** Extrai a extensão (lowercase, sem o ponto) do nome do arquivo. */
function obterExtensao(nomeOriginal: string): string {
  const partes = nomeOriginal.trim().toLowerCase().split('.');
  return partes.length > 1 ? partes[partes.length - 1] : '';
}

/** Type guard: verifica se a extensão está entre os formatos permitidos. */
function formatoPermitido(extensao: string): extensao is FormatoPermitido {
  return (FORMATOS_PERMITIDOS as readonly string[]).includes(extensao);
}

/**
 * Remove separadores de caminho e caracteres inseguros do nome do arquivo,
 * preservando apenas letras, dígitos, ponto, hífen e underscore. Também
 * neutraliza pontos iniciais (ex.: `..`) para evitar nomes ambíguos no
 * caminho de armazenamento.
 */
export function sanitizeFilename(nomeOriginal: string): string {
  const semCaminho = nomeOriginal.split(/[/\\]/).pop() ?? nomeOriginal;
  return semCaminho.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '_');
}

/**
 * Valida o formato e o tamanho de um arquivo ANTES de gerar a presigned URL
 * de upload (Req. 4.7).
 *
 * - Formato: a extensão do nome do arquivo deve estar entre os permitidos
 *   (Req. 4.5) E o MIME type informado deve corresponder a um dos aceitos —
 *   ambos os sinais são checados para reduzir o risco de um arquivo disfarçado
 *   por extensão.
 * - Tamanho: rejeita arquivos acima de `MAX_FILE_BYTES` (10 MB).
 *
 * @throws {AppError} `ARQUIVO_FORMATO_INVALIDO` quando o formato não é aceito.
 * @throws {AppError} `ARQUIVO_MUITO_GRANDE` quando o arquivo excede 10 MB.
 */
export function validarArquivo(arquivo: ArquivoMetadados): void {
  const extensao = obterExtensao(arquivo.nomeOriginal);
  const mimeType = (arquivo.mimeType ?? '').trim().toLowerCase();

  if (!formatoPermitido(extensao) || !MIME_TYPES_PERMITIDOS_SET.has(mimeType)) {
    throw badRequest(
      ErrorCodes.ARQUIVO_FORMATO_INVALIDO,
      `Formato de arquivo não permitido. Formatos aceitos: ${FORMATOS_PERMITIDOS.join(', ').toUpperCase()}`,
      'nomeOriginal',
    );
  }

  if (arquivo.tamanhoBytes > MAX_FILE_BYTES) {
    throw badRequest(
      ErrorCodes.ARQUIVO_MUITO_GRANDE,
      `Arquivo excede o tamanho máximo de ${MAX_FILE_BYTES / (1024 * 1024)}MB por arquivo`,
      'tamanhoBytes',
    );
  }
}

// ---------------------------------------------------------------------------
// Injeção de dependências (facilita testes; usa as instâncias reais por padrão)
// ---------------------------------------------------------------------------

/** Contrato mínimo do cliente MinIO usado pelo serviço (facilita mocks em testes). */
export interface MinioLike {
  presignedPutObject(bucketName: string, objectName: string, expiry?: number): Promise<string>;
  presignedGetObject(bucketName: string, objectName: string, expiry?: number): Promise<string>;
}

/** Dependências injetáveis do serviço. */
export interface DocumentosDeps {
  prisma: Pick<PrismaClient, 'documento' | 'processo'>;
  minio: MinioLike;
  auditar: (dto: RegistrarAuditoriaDto) => Promise<void>;
}

/** Ator que dispara a operação — compatível por spread com `RegistrarAuditoriaDto`. */
export interface AtorDocumento {
  ator: AtorAuditoria;
  atorCidadaoId?: string;
  atorServidorId?: string;
  enderecoIp: string;
}

let cachedPrisma: DocumentosDeps['prisma'] | undefined;
let cachedMinio: MinioLike | undefined;

/**
 * Resolve o Prisma real preguiçosamente (lazy). Só é chamada quando o chamador
 * NÃO injeta `deps.prisma` — importar este módulo não deve carregar o
 * `@prisma/client`.
 */
function getRealPrisma(): DocumentosDeps['prisma'] {
  if (!cachedPrisma) {
    const requireLocal = createRequire(import.meta.url);
    const { prisma } = requireLocal('../../config/database.js') as { prisma: PrismaClient };
    cachedPrisma = prisma as unknown as DocumentosDeps['prisma'];
  }
  return cachedPrisma;
}

/**
 * Resolve o cliente MinIO real preguiçosamente (lazy). Só é chamada quando o
 * chamador NÃO injeta `deps.minio` — importar este módulo não deve carregar o
 * pacote `minio`.
 */
function getRealMinio(): MinioLike {
  if (!cachedMinio) {
    const requireLocal = createRequire(import.meta.url);
    const { minio } = requireLocal('../../config/minio.js') as { minio: MinioLike };
    cachedMinio = minio;
  }
  return cachedMinio;
}

function resolveDeps(deps?: Partial<DocumentosDeps>): DocumentosDeps {
  return {
    prisma: deps?.prisma ?? getRealPrisma(),
    minio: deps?.minio ?? getRealMinio(),
    auditar: deps?.auditar ?? defaultRegistrar,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Carrega o `unidadeId` do Processo, lançando `notFound` quando o Processo não
 * existe. Usado pelo controller para montar o caminho de armazenamento antes
 * de solicitar a presigned URL de upload.
 */
export async function obterUnidadeDoProcesso(
  processoId: string,
  deps?: Partial<DocumentosDeps>,
): Promise<string> {
  const d = resolveDeps(deps);
  const processo = await d.prisma.processo.findUnique({
    where: { id: processoId },
    select: { unidadeId: true },
  });
  if (!processo) {
    throw notFound(ErrorCodes.VALIDATION_ERROR, 'Processo não encontrado');
  }
  return (processo as { unidadeId: string }).unidadeId;
}

// ---------------------------------------------------------------------------
// Upload (Req. 4.5, 4.7, 5.4)
// ---------------------------------------------------------------------------

/** Resultado da geração da presigned URL de upload. */
export interface UploadUrlResult {
  uploadUrl: string;
  caminhoStorage: string;
  expiraEm: string;
}

/**
 * Gera uma presigned URL de upload direto ao MinIO (Req. 4.5, 4.7, 5.4).
 *
 * 1. Valida o formato e o tamanho do arquivo (`validarArquivo`).
 * 2. Verifica os limites agregados do Processo: no máximo `MAX_FILES` arquivos
 *    e `MAX_TOTAL_BYTES` no total — sem apagar nenhum arquivo já anexado.
 * 3. Monta o caminho de armazenamento `processos/{unidadeId}/{processoId}/{uuid}-{nome}`.
 * 4. Solicita ao MinIO uma presigned URL de escrita (expiração de 5 minutos).
 *
 * @throws {AppError} `ARQUIVO_FORMATO_INVALIDO` / `ARQUIVO_MUITO_GRANDE` — arquivo inválido.
 * @throws {AppError} `LIMITE_ARQUIVOS` — o Processo já possui `MAX_FILES` arquivos.
 * @throws {AppError} `ARQUIVO_MUITO_GRANDE` — o total ultrapassaria `MAX_TOTAL_BYTES`.
 */
export async function gerarUploadUrl(
  processoId: string,
  unidadeId: string,
  arquivo: ArquivoMetadados,
  // `ator` não é usado aqui: a geração da URL não é, por si, uma ação de
  // negócio auditável — a Auditoria ocorre em `confirmarUpload`, quando o
  // arquivo de fato passa a existir no Processo. O parâmetro é mantido na
  // assinatura por consistência com o restante do fluxo (upload → confirmação).
  _ator: AtorDocumento,
  deps?: Partial<DocumentosDeps>,
): Promise<UploadUrlResult> {
  validarArquivo(arquivo);

  const d = resolveDeps(deps);

  const [agregado, quantidadeAtual] = await Promise.all([
    d.prisma.documento.aggregate({
      where: { processoId },
      _sum: { tamanhoBytes: true },
    }),
    d.prisma.documento.count({ where: { processoId } }),
  ]);

  if (quantidadeAtual >= MAX_FILES) {
    throw badRequest(
      ErrorCodes.LIMITE_ARQUIVOS,
      `Este processo já atingiu o limite de ${MAX_FILES} arquivos anexados`,
    );
  }

  const somaAtual = (agregado as { _sum: { tamanhoBytes: number | null } })._sum.tamanhoBytes ?? 0;
  if (somaAtual + arquivo.tamanhoBytes > MAX_TOTAL_BYTES) {
    throw badRequest(
      ErrorCodes.ARQUIVO_MUITO_GRANDE,
      `O total de anexos do processo não pode exceder ${MAX_TOTAL_BYTES / (1024 * 1024)}MB`,
    );
  }

  const caminhoStorage = `processos/${unidadeId}/${processoId}/${randomUUID()}-${sanitizeFilename(arquivo.nomeOriginal)}`;

  const uploadUrl = await d.minio.presignedPutObject(
    env.MINIO_BUCKET_PROCESSOS,
    caminhoStorage,
    PRESIGNED_URL_TTL_SECONDS,
  );

  return {
    uploadUrl,
    caminhoStorage,
    expiraEm: new Date(Date.now() + PRESIGNED_URL_TTL_SECONDS * 1000).toISOString(),
  };
}

/**
 * Confirma um upload já realizado no MinIO, persistindo a linha `Documento`
 * e registrando a Auditoria (Req. 4.5, 5.4).
 */
export async function confirmarUpload(
  processoId: string,
  arquivo: ArquivoMetadados,
  caminhoStorage: string,
  enviadoPorId: string,
  enviadoPorCidadao: boolean,
  ator: AtorDocumento,
  deps?: Partial<DocumentosDeps>,
): Promise<Documento> {
  const d = resolveDeps(deps);

  const documento = await d.prisma.documento.create({
    data: {
      processoId,
      nomeOriginal: arquivo.nomeOriginal,
      mimeType: arquivo.mimeType,
      tamanhoBytes: arquivo.tamanhoBytes,
      caminhoStorage,
      enviadoPorCidadao,
      enviadoPorId,
    },
  });

  await d.auditar({
    tipoAcao: 'anexar_documento',
    modulo: MODULO,
    objetoId: processoId,
    tipoObjeto: 'Processo',
    ...ator,
  });

  return documento as Documento;
}

// ---------------------------------------------------------------------------
// Download (Req. 5.4)
// ---------------------------------------------------------------------------

/** Linha de `Documento` com o `cidadaoId` do Processo relacionado (para ownership). */
interface DocumentoComProcesso {
  id: string;
  processoId: string;
  nomeOriginal: string;
  caminhoStorage: string;
  processo: { cidadaoId: string };
}

/** Resultado da geração da presigned URL de download. */
export interface DownloadUrlResult {
  downloadUrl: string;
  nomeOriginal: string;
  expiraEm: string;
}

/**
 * Gera uma presigned URL de leitura (download) para um Documento (Req. 5.4).
 *
 * Quando `solicitanteCidadaoId` é informado, valida que o Documento pertence a
 * um Processo daquele cidadão — caso contrário, responde 404 (não 403) para
 * não revelar a existência do Documento a quem não é o dono do Processo, no
 * mesmo padrão usado no detalhe do Processo. Quando `solicitanteCidadaoId` é
 * `undefined`, o chamador é tratado como um Servidor já autorizado pelo RBAC
 * na camada de rota, e a checagem de ownership é ignorada.
 *
 * @throws {AppError} 404 — Documento inexistente ou não pertencente ao cidadão solicitante.
 */
export async function gerarDownloadUrl(
  documentoId: string,
  solicitanteCidadaoId: string | undefined,
  deps?: Partial<DocumentosDeps>,
): Promise<DownloadUrlResult> {
  const d = resolveDeps(deps);

  const documento = (await d.prisma.documento.findUnique({
    where: { id: documentoId },
    include: { processo: { select: { cidadaoId: true } } },
  })) as DocumentoComProcesso | null;

  if (!documento) {
    throw notFound(ErrorCodes.VALIDATION_ERROR, 'Documento não encontrado');
  }

  if (solicitanteCidadaoId !== undefined && documento.processo.cidadaoId !== solicitanteCidadaoId) {
    throw new AppError(404, ErrorCodes.VALIDATION_ERROR, 'Documento não encontrado');
  }

  const downloadUrl = await d.minio.presignedGetObject(
    env.MINIO_BUCKET_PROCESSOS,
    documento.caminhoStorage,
    PRESIGNED_URL_TTL_SECONDS,
  );

  await d.auditar({
    // Esta função recebe apenas o id do documento e o cidadão solicitante (ou
    // `undefined` para Servidor) — não há IP de origem disponível nesta camada.
    // "desconhecido" segue o mesmo fallback usado nos controllers quando o IP
    // não pode ser determinado.
    ator: solicitanteCidadaoId ? 'cidadao' : 'servidor',
    atorCidadaoId: solicitanteCidadaoId,
    enderecoIp: 'desconhecido',
    tipoAcao: 'download_documento',
    modulo: MODULO,
    objetoId: documento.processoId,
    tipoObjeto: 'Processo',
  });

  return {
    downloadUrl,
    nomeOriginal: documento.nomeOriginal,
    expiraEm: new Date(Date.now() + PRESIGNED_URL_TTL_SECONDS * 1000).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Listagem (Req. 5.4)
// ---------------------------------------------------------------------------

/** Item exibido na lista de documentos anexados a um Processo (Req. 5.4). */
export interface DocumentoResumo {
  id: string;
  nomeOriginal: string;
  tamanhoBytes: number;
  enviadoEm: Date;
  enviadoPorCidadao: boolean;
}

/**
 * Lista os documentos anexados a um Processo, ordenados por data de envio
 * crescente (Req. 5.4).
 */
export async function listarDocumentos(
  processoId: string,
  deps?: Partial<DocumentosDeps>,
): Promise<DocumentoResumo[]> {
  const d = resolveDeps(deps);

  const documentos = await d.prisma.documento.findMany({
    where: { processoId },
    orderBy: { enviadoEm: 'asc' },
    select: {
      id: true,
      nomeOriginal: true,
      tamanhoBytes: true,
      enviadoEm: true,
      enviadoPorCidadao: true,
    },
  });

  return documentos as DocumentoResumo[];
}
