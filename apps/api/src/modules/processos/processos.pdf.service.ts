import { createRequire } from 'node:module';
import type { PrismaClient } from '@prisma/client';
import { ErrorCodes } from '@auditar/shared';
import { AppError, notFound } from '../../utils/index.js';
import { registrar as defaultRegistrar } from '../auditoria/index.js';
import type { RegistrarAuditoriaDto } from '../auditoria/index.js';
import {
  montarConteudoPdf,
  CANAL_PUBLICO,
  type DadosProcessoPdf,
} from './pdf/processoPdfContent.js';
import { renderProcessoPdf } from './pdf/processoPdfRenderer.js';

/**
 * Serviço de Geração de PDF Consolidado do Processo (Task 22.3, Req. 26).
 *
 * Geração SÍNCRONA para um único Processo: carrega os dados necessários
 * (cabeçalho, respostas do Formulário_Dinâmico, movimentações, mensagens do
 * canal PÚBLICO e documentos), monta o conteúdo estruturado via
 * `montarConteudoPdf` (função pura, Task 22.1) e o renderiza em um Buffer PDF
 * 1.4 reutilizando a mesma abordagem de geração do `RelatorioWorker#toPdf`
 * (ver `pdf/processoPdfRenderer.ts`).
 *
 * A consulta de mensagens é restrita ao canal público (`canal: 'publico'`),
 * garantindo que as mensagens internas entre Servidores jamais sejam
 * carregadas — o `montarConteudoPdf` ainda aplica a filtragem defensivamente
 * (Req. 26.4).
 *
 * O registro no Módulo_de_Auditoria (Req. 26.3) usa o `registrar` assíncrono
 * (nunca lança) — a geração do PDF não deve falhar por causa da auditoria.
 *
 * Requisitos: 26.1, 26.2, 26.3, 26.4, 26.5
 */

const MODULO = 'processos';

const MENSAGEM_PROCESSO_NAO_ENCONTRADO = 'Processo não encontrado';
const MENSAGEM_PDF_FALHA =
  'Falha ao gerar o PDF do processo. Nenhum dado foi alterado; tente novamente.';

// ---------------------------------------------------------------------------
// Injeção de dependências (facilita testes; usa as instâncias reais por padrão)
// ---------------------------------------------------------------------------

/** Dependências injetáveis do serviço. */
export interface ProcessoPdfDeps {
  /** Precisa de `processo`, `movimentacaoProcesso`, `mensagem` e `documento`. */
  prisma: Pick<
    PrismaClient,
    'processo' | 'movimentacaoProcesso' | 'mensagem' | 'documento'
  >;
  /** Registro em Módulo_de_Auditoria (nunca lança — Req 17.8). */
  auditar: (dto: RegistrarAuditoriaDto) => Promise<void>;
  /** Renderizador do PDF (injetável para teste; default = renderer real). */
  render: typeof renderProcessoPdf;
}

let cachedPrisma: ProcessoPdfDeps['prisma'] | undefined;

/**
 * Resolve o Prisma real preguiçosamente (lazy). Só é chamada quando o chamador
 * NÃO injeta `deps.prisma` — importar este módulo não deve carregar o
 * `@prisma/client`.
 */
function getRealPrisma(): ProcessoPdfDeps['prisma'] {
  if (!cachedPrisma) {
    const requireLocal = createRequire(import.meta.url);
    const { prisma } = requireLocal('../../config/database.js') as { prisma: PrismaClient };
    cachedPrisma = prisma as unknown as ProcessoPdfDeps['prisma'];
  }
  return cachedPrisma;
}

function resolveDeps(deps?: Partial<ProcessoPdfDeps>): ProcessoPdfDeps {
  return {
    prisma: deps?.prisma ?? getRealPrisma(),
    auditar: deps?.auditar ?? defaultRegistrar,
    render: deps?.render ?? renderProcessoPdf,
  };
}

// ---------------------------------------------------------------------------
// Formatos crus carregados do Prisma
// ---------------------------------------------------------------------------

interface ProcessoPdfRow {
  protocolo: string;
  status: string;
  cidadao: { nome: string; cpf: string } | null;
  tipoProcesso: { nome: string } | null;
  unidade: { nome: string } | null;
  respostas: { campoId: string; valor: string }[];
}

interface MovimentacaoRow {
  observacao: string | null;
  realizadoEm: Date;
  servidor: { nome: string } | null;
}

interface MensagemRow {
  canal: string;
  conteudo: string;
  enviadaEm: Date;
  remetenteServidor: { nome: string } | null;
  remetenteCidadao: { nome: string } | null;
}

interface DocumentoRow {
  nomeOriginal: string;
}

// ---------------------------------------------------------------------------
// Carregamento dos dados
// ---------------------------------------------------------------------------

/**
 * Carrega todos os dados de um Processo necessários para o PDF consolidado.
 * As mensagens são consultadas EXCLUSIVAMENTE no canal público (Req. 26.4).
 *
 * @throws {AppError} 404 — Processo inexistente.
 */
export async function carregarDadosPdf(
  processoId: string,
  deps?: Partial<ProcessoPdfDeps>,
): Promise<DadosProcessoPdf> {
  const d = resolveDeps(deps);

  const processo = (await d.prisma.processo.findUnique({
    where: { id: processoId },
    select: {
      protocolo: true,
      status: true,
      cidadao: { select: { nome: true, cpf: true } },
      tipoProcesso: { select: { nome: true } },
      unidade: { select: { nome: true } },
      respostas: { select: { campoId: true, valor: true } },
    },
  })) as ProcessoPdfRow | null;

  if (!processo) {
    throw notFound(ErrorCodes.PROCESSO_NAO_ENCONTRADO, MENSAGEM_PROCESSO_NAO_ENCONTRADO);
  }

  const movimentacoes = (await d.prisma.movimentacaoProcesso.findMany({
    where: { processoId },
    orderBy: { realizadoEm: 'asc' },
    select: {
      observacao: true,
      realizadoEm: true,
      servidor: { select: { nome: true } },
    },
  })) as MovimentacaoRow[];

  // Req. 26.4 — SOMENTE mensagens do canal público são carregadas.
  const mensagens = (await d.prisma.mensagem.findMany({
    where: { processoId, canal: CANAL_PUBLICO },
    orderBy: { enviadaEm: 'asc' },
    select: {
      canal: true,
      conteudo: true,
      enviadaEm: true,
      remetenteServidor: { select: { nome: true } },
      remetenteCidadao: { select: { nome: true } },
    },
  })) as MensagemRow[];

  const documentos = (await d.prisma.documento.findMany({
    where: { processoId },
    // Modelo Documento usa `enviadoEm` (não `enviadaEm`, que é do Mensagem).
    orderBy: { enviadoEm: 'asc' },
    select: { nomeOriginal: true },
  })) as DocumentoRow[];

  return {
    cabecalho: {
      protocolo: processo.protocolo,
      tipoProcesso: processo.tipoProcesso?.nome ?? '',
      unidade: processo.unidade?.nome ?? '',
      status: processo.status,
      cidadao: processo.cidadao,
    },
    respostas: processo.respostas.map((r) => ({ campoId: r.campoId, valor: r.valor })),
    movimentacoes: movimentacoes.map((m) => ({
      autor: m.servidor?.nome ?? null,
      data: m.realizadoEm,
      observacao: m.observacao,
    })),
    mensagens: mensagens.map((m) => ({
      canal: m.canal,
      conteudo: m.conteudo,
      enviadaEm: m.enviadaEm,
      autor: m.remetenteServidor?.nome ?? m.remetenteCidadao?.nome ?? null,
    })),
    documentos: documentos.map((doc) => ({ nomeOriginal: doc.nomeOriginal })),
  };
}

// ---------------------------------------------------------------------------
// Geração síncrona do PDF (Req. 26.1, 26.2, 26.3, 26.5)
// ---------------------------------------------------------------------------

/** Resultado da geração: buffer do PDF e o nome de arquivo sugerido. */
export interface ProcessoPdfResultado {
  buffer: Buffer;
  /** Nome de arquivo para download (ex.: `PROT-2026-0001.pdf`). */
  nomeArquivo: string;
}

/**
 * Gera o PDF consolidado de um Processo de forma síncrona (Req. 26.1, 26.2).
 *
 * 1. Carrega os dados (404 se o Processo não existe).
 * 2. Monta o conteúdo estruturado (função pura) e renderiza o Buffer PDF.
 * 3. Registra a auditoria da geração (Req. 26.3): identidade do Servidor,
 *    id do Processo e data/hora (implícita no registro).
 *
 * Em qualquer falha da renderização/montagem, lança 500 `PDF_GERACAO_FALHA`
 * (`PDF_001`) — nenhum dado do Processo é alterado, permitindo nova tentativa
 * (Req. 26.5). Erros de 404 (Processo inexistente) são propagados como estão.
 *
 * @throws {AppError} 404 — Processo inexistente.
 * @throws {AppError} 500 `PDF_GERACAO_FALHA` — falha na geração do PDF.
 */
export async function gerarPdfProcesso(
  processoId: string,
  servidorId: string,
  enderecoIp: string,
  deps?: Partial<ProcessoPdfDeps>,
): Promise<ProcessoPdfResultado> {
  const d = resolveDeps(deps);

  const dados = await carregarDadosPdf(processoId, deps);

  let buffer: Buffer;
  try {
    const conteudo = montarConteudoPdf(dados);
    buffer = d.render(conteudo);
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error('Renderização do PDF produziu um artefato vazio');
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        scope: 'processos.pdf.service',
        event: 'pdf_geracao_falhou',
        processoId,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    // Req. 26.5 — nenhuma alteração de dados; nova tentativa permitida.
    throw new AppError(500, ErrorCodes.PDF_GERACAO_FALHA, MENSAGEM_PDF_FALHA);
  }

  // Req. 26.3 — registra a geração no Módulo_de_Auditoria (nunca lança).
  await d.auditar({
    tipoAcao: 'gerar_pdf_processo',
    modulo: MODULO,
    objetoId: processoId,
    tipoObjeto: 'Processo',
    ator: 'servidor',
    atorServidorId: servidorId,
    enderecoIp,
  });

  const protocoloLimpo = dados.cabecalho.protocolo.replace(/[^a-zA-Z0-9._-]/g, '_') || 'processo';

  return { buffer, nomeArquivo: `${protocoloLimpo}.pdf` };
}
