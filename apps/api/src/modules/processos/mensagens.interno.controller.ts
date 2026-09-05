import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { ErrorCodes } from '@auditar/shared';
import { AppError } from '../../utils/index.js';
import { enviarMensagemInternaSchema } from './mensagens.interno.schema.js';
import { enviarInterna, listarInternas } from './mensagens.interno.service.js';

/**
 * Controllers HTTP do canal de mensagens internas (Servidor ↔ Servidor) de um
 * Processo (Task 8.2).
 *
 * Traduzem a requisição Express para o serviço e serializam erros conhecidos
 * (`ZodError`, `AppError`) na forma de resposta `ApiError` (`{ error, code, field? }`),
 * mesmo padrão de `mensagens.publico.controller.ts`.
 *
 * Requisitos: 13.2, 13.4, 13.5, 13.6, 13.8
 */

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
      scope: 'mensagens.interno.controller',
      event: 'erro_nao_tratado',
      message: err instanceof Error ? err.message : String(err),
    }),
  );
  res.status(500).json({ error: 'Erro interno', code: ErrorCodes.SERVICO_INDISPONIVEL });
}

/**
 * GET /api/v1/admin/processos/:id/mensagens/internas
 *
 * Lista as mensagens internas (Servidor ↔ Servidor) do Processo, invisíveis
 * ao Cidadão (Req 13.2). 404 quando o Processo não existe.
 */
export async function getMensagensInternas(req: Request, res: Response): Promise<void> {
  try {
    const data = await listarInternas(req.params.id);
    res.status(200).json({ data });
  } catch (err) {
    handleError(err, res);
  }
}

/**
 * POST /api/v1/admin/processos/:id/mensagens/internas
 *
 * Envia uma mensagem interna do Servidor autenticado (Req 13.2, 13.5, 13.6).
 * 400 `PROCESSO_ENCERRADO` quando o Processo está encerrado (Req 13.8); 400
 * `ARQUIVO_FORMATO_INVALIDO`/`ARQUIVO_MUITO_GRANDE` quando o anexo informado é
 * inválido (Req 13.5).
 */
export async function postMensagemInterna(req: Request, res: Response): Promise<void> {
  try {
    const dto = enviarMensagemInternaSchema.parse(req.body);
    const mensagem = await enviarInterna(req.params.id, req.user?.sub ?? '', dto);
    res.status(201).json({ data: mensagem });
  } catch (err) {
    handleError(err, res);
  }
}
