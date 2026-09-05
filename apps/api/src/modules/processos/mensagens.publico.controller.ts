import type { Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { ErrorCodes } from '@auditar/shared';
import { AppError } from '../../utils/index.js';
import { enviarMensagemCidadao, enviarMensagemServidor } from './mensagens.publico.service.js';

/**
 * Controllers HTTP do ENVIO de mensagens no canal público (Cidadão ↔
 * Servidor) de um Processo (Task 8.1).
 *
 * Traduzem a requisição Express para o serviço e serializam erros conhecidos
 * (`ZodError`, `AppError`) na forma de resposta `ApiError` (`{ error, code, field? }`),
 * mesmo padrão de `processos.controller.ts`/`documentos.controller.ts`.
 *
 * A LISTAGEM (GET) deste canal é responsabilidade de
 * `processos.detalhe.controller.ts` (tarefa 7.3) e do respectivo endpoint
 * administrativo — não duplicada aqui.
 *
 * Requisitos: 5.5, 5.6, 5.7, 13.1, 13.3, 13.7, 13.8
 */

/** Corpo aceito por ambos os endpoints de envio: apenas o texto da mensagem. */
const enviarMensagemSchema = z.object({
  conteudo: z
    .string()
    .trim()
    .min(1, 'O conteúdo da mensagem é obrigatório')
    .max(4000, 'O conteúdo da mensagem deve ter no máximo 4000 caracteres'),
});

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
      scope: 'mensagens.publico.controller',
      event: 'erro_nao_tratado',
      message: err instanceof Error ? err.message : String(err),
    }),
  );
  res.status(500).json({ error: 'Erro interno', code: ErrorCodes.SERVICO_INDISPONIVEL });
}

/**
 * POST /api/v1/processos/:id/mensagens
 *
 * Envia uma mensagem do Cidadão autenticado ao Servidor responsável pelo
 * Processo (Req 5.5, 5.6, 13.1). 404 quando o Processo não existe ou não
 * pertence ao Cidadão; 400 `PROCESSO_ENCERRADO` quando o Processo está
 * encerrado (Req 13.8).
 */
export async function postMensagemCidadao(req: Request, res: Response): Promise<void> {
  try {
    const dto = enviarMensagemSchema.parse(req.body);
    const mensagem = await enviarMensagemCidadao(req.params.id, req.user?.sub ?? '', dto.conteudo);
    res.status(201).json({ data: mensagem });
  } catch (err) {
    handleError(err, res);
  }
}

/**
 * POST /api/v1/admin/processos/:id/mensagens
 *
 * Envia uma mensagem do Servidor autenticado ao Cidadão do Processo (Req 13.1,
 * 13.3). A resposta inclui `notificacaoEntregue`, que é `false` quando o
 * Cidadão não possui conta ativa ou a notificação falha por qualquer outro
 * motivo (Req 13.7) — sem que isso afete o status HTTP de sucesso. 400
 * `PROCESSO_ENCERRADO` quando o Processo está encerrado (Req 13.8).
 */
export async function postMensagemServidor(req: Request, res: Response): Promise<void> {
  try {
    const dto = enviarMensagemSchema.parse(req.body);
    const resultado = await enviarMensagemServidor(
      req.params.id,
      req.user?.sub ?? '',
      dto.conteudo,
    );
    res.status(201).json({ data: resultado.mensagem, notificacaoEntregue: resultado.notificacaoEntregue });
  } catch (err) {
    handleError(err, res);
  }
}
