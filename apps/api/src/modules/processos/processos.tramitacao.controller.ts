import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { ErrorCodes, Permissao } from '@auditar/shared';
import { AppError, forbidden } from '../../utils/index.js';
import { hasPermission } from '../../middleware/rbac.js';
import {
  avancarEtapaSchema,
  rejeitarSchema,
  solicitarDocumentosSchema,
  observacaoSchema,
  edicaoCorretivaSchema,
} from './processos.tramitacao.schema.js';
import {
  obterDetalheAdmin,
  obterTrilhaAuditoria,
  editarProcessoCorretivo,
  avancarEtapa,
  rejeitar,
  solicitarDocumentos,
  registrarObservacao,
} from './processos.tramitacao.service.js';
import { gerarPdfProcesso } from './processos.pdf.service.js';

/**
 * Controllers HTTP da Tramitação de Processo pelo Servidor (Task 7.6, Req 11).
 *
 * Traduzem a requisição Express para o serviço e serializam erros conhecidos
 * (`ZodError`, `AppError`) na forma de resposta `ApiError`
 * (`{ error, code, field? }`), mesmo padrão de `processos.admin.controller.ts`.
 *
 * As permissões condicionais ao conteúdo (aprovação na finalização — Req 11.7;
 * rejeição — Req 11.7; tipo de observação — Req 11.4/11.5) são computadas aqui
 * via `hasPermission(req.user, ...)` e repassadas ao serviço, que não acessa
 * `req.user`.
 */

/** Mensagem orientativa quando o Servidor não pode rejeitar processos (Req 11.7). */
const MSG_SEM_PERMISSAO_REJEITAR =
  'Você não possui permissão para rejeitar processos. Contate o Gestor responsável para solicitar essa permissão.';

/** Resolve o IP de origem da requisição, com fallback seguro (mesmo padrão de processos.controller). */
function resolveIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'desconhecido';
}

/** Resolve o id do Servidor autenticado a partir do token. */
function resolveServidorId(req: Request): string {
  return req.user?.sub ?? '';
}

/** Mapeia um erro conhecido para uma resposta HTTP; loga e responde 500 caso contrário. */
function handleError(err: unknown, res: Response): void {
  if (err instanceof ZodError) {
    const first = err.errors[0];
    res.status(400).json({
      error: first?.message ?? 'Dados inválidos',
      code: ErrorCodes.VALIDATION_ERROR,
      field: first?.path?.join('.') || undefined,
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message, code: err.code, field: err.field });
    return;
  }

  console.error(
    JSON.stringify({
      level: 'error',
      scope: 'processos.tramitacao.controller',
      event: 'erro_nao_tratado',
      message: err instanceof Error ? err.message : String(err),
    }),
  );
  res.status(500).json({ error: 'Erro interno', code: ErrorCodes.SERVICO_INDISPONIVEL });
}

/**
 * GET /api/v1/admin/processos/:id
 *
 * Detalhe administrativo do Processo para tramitação (Req 11.1): etapa atual,
 * etapas anteriores concluídas, próxima etapa e histórico completo.
 */
export async function getProcessoTramitacao(req: Request, res: Response): Promise<void> {
  try {
    const data = await obterDetalheAdmin(req.params.id);
    res.status(200).json({ data });
  } catch (err) {
    handleError(err, res);
  }
}

/**
 * GET /api/v1/admin/processos/:id/pdf
 *
 * Gera SÍNCRONAMENTE o PDF consolidado do Processo (Req 26.1) e o transmite
 * como binário para download direto (Req 26.2). A permissão `visualizar` é
 * aplicada por middleware no router (Req 26.6). Registra a geração no Módulo
 * de Auditoria (Req 26.3). Em falha, responde `PDF_001` sem alterar dados,
 * permitindo nova tentativa (Req 26.5).
 */
export async function getProcessoPdf(req: Request, res: Response): Promise<void> {
  try {
    const { buffer, nomeArquivo } = await gerarPdfProcesso(
      req.params.id,
      resolveServidorId(req),
      resolveIp(req),
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.status(200).end(buffer);
  } catch (err) {
    handleError(err, res);
  }
}

/**
 * GET /api/v1/admin/processos/:id/auditoria
 *
 * Trilha de auditoria do Processo em ordem cronológica (Req 24.2), combinando
 * `MovimentacaoProcesso` e `AuditoriaLog` num formato unificado.
 */
export async function getTrilhaAuditoria(req: Request, res: Response): Promise<void> {
  try {
    const data = await obterTrilhaAuditoria(req.params.id);
    res.status(200).json({ data });
  } catch (err) {
    handleError(err, res);
  }
}

/**
 * PATCH /api/v1/admin/processos/:id
 *
 * Edição_Corretiva de dados do Processo (Req 24.4, 24.5, 24.7). Requer a
 * Permissão_Granular `editar` (aplicada por middleware no router). Persiste as
 * correções e registra a auditoria por campo alterado dentro de transação;
 * falha na auditoria ⇒ 500 `AUDITORIA_FALHA` (`SYS_001`), sem persistir.
 */
export async function patchProcessoCorretivo(req: Request, res: Response): Promise<void> {
  try {
    const input = edicaoCorretivaSchema.parse(req.body);
    const data = await editarProcessoCorretivo(
      req.params.id,
      resolveServidorId(req),
      resolveIp(req),
      input,
    );
    res.status(200).json({ data });
  } catch (err) {
    handleError(err, res);
  }
}

/**
 * POST /api/v1/admin/processos/:id/avancar-etapa
 *
 * Avança o Processo para a próxima Etapa, ou o finaliza (aprova) na última
 * (Req 11.2, 11.3, 11.9). A finalização exige a permissão APROVAR, computada
 * aqui e repassada ao serviço.
 */
export async function postAvancarEtapa(req: Request, res: Response): Promise<void> {
  try {
    const { observacao } = avancarEtapaSchema.parse(req.body);
    const podeAprovar = hasPermission(req.user, Permissao.APROVAR);
    const data = await avancarEtapa(
      req.params.id,
      resolveServidorId(req),
      resolveIp(req),
      podeAprovar,
      observacao,
    );
    res.status(200).json({ data });
  } catch (err) {
    handleError(err, res);
  }
}

/**
 * POST /api/v1/admin/processos/:id/rejeitar
 *
 * Rejeita o Processo (Req 11.7). A permissão REJEITAR é verificada aqui para
 * poder devolver a mensagem orientativa customizada quando ausente.
 */
export async function postRejeitar(req: Request, res: Response): Promise<void> {
  try {
    if (!hasPermission(req.user, Permissao.REJEITAR)) {
      res.status(403).json({
        error: MSG_SEM_PERMISSAO_REJEITAR,
        code: ErrorCodes.INSUFFICIENT_PERMISSIONS,
      });
      return;
    }
    const { motivo } = rejeitarSchema.parse(req.body);
    const data = await rejeitar(req.params.id, resolveServidorId(req), resolveIp(req), motivo);
    res.status(200).json({ data });
  } catch (err) {
    handleError(err, res);
  }
}

/**
 * POST /api/v1/admin/processos/:id/solicitar-documentos
 *
 * Solicita documentos adicionais ao Cidadão e coloca o Processo em
 * "Aguardando Documentos" (Req 11.6).
 */
export async function postSolicitarDocumentos(req: Request, res: Response): Promise<void> {
  try {
    const { documentos } = solicitarDocumentosSchema.parse(req.body);
    const data = await solicitarDocumentos(
      req.params.id,
      resolveServidorId(req),
      resolveIp(req),
      documentos,
    );
    res.status(200).json({ data });
  } catch (err) {
    handleError(err, res);
  }
}

/**
 * POST /api/v1/admin/processos/:id/observacoes
 *
 * Registra uma observação interna ou pública (Req 11.4, 11.5). A permissão
 * exigida depende do `tipo`: `OBSERVACAO_INTERNA` para internas,
 * `OBSERVACAO_PUBLICA` para públicas.
 */
export async function postObservacao(req: Request, res: Response): Promise<void> {
  try {
    const { tipo, conteudo } = observacaoSchema.parse(req.body);
    const permissaoNecessaria =
      tipo === 'interna' ? Permissao.OBSERVACAO_INTERNA : Permissao.OBSERVACAO_PUBLICA;
    if (!hasPermission(req.user, permissaoNecessaria)) {
      throw forbidden();
    }
    const data = await registrarObservacao(
      req.params.id,
      resolveServidorId(req),
      resolveIp(req),
      tipo,
      conteudo,
    );
    res.status(200).json({ data });
  } catch (err) {
    handleError(err, res);
  }
}
