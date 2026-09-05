import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { ErrorCodes } from '@auditar/shared';
import { AppError } from '../../utils/index.js';
import { abrirProcessoAdminSchema } from './processos.schema.js';
import { abrirProcessoPeloServidor, type AtorServidor } from './processos.service.js';

/**
 * Controller da abertura de Processo pelo Servidor no Painel_Administrativo
 * (tarefa 20.2, Req. 23).
 *
 * `POST /api/v1/admin/processos` recebe o Cidadão previamente localizado
 * (`cidadaoId`), o Tipo_de_Processo, a Unidade e as respostas do
 * Formulário_Dinâmico, e delega ao motor único de criação
 * (`abrirProcessoPeloServidor`). O Servidor autor é extraído do token
 * (`req.user.sub`), registrado na Auditoria (Req. 23.6). Erros conhecidos são
 * serializados como `ApiError` para permitir nova tentativa preservando os
 * dados (Req. 23.7).
 */

/** Resolve o IP de origem da requisição, com fallback seguro. */
function resolveIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'desconhecido';
}

/** Extrai o Servidor autenticado (ator) da requisição. */
function resolveAtor(req: Request): AtorServidor {
  return { servidorId: req.user?.sub ?? 'desconhecido', enderecoIp: resolveIp(req) };
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
      scope: 'processos.abertura.controller',
      event: 'erro_nao_tratado',
      message: err instanceof Error ? err.message : String(err),
    }),
  );
  res.status(500).json({ error: 'Erro interno', code: ErrorCodes.SERVICO_INDISPONIVEL });
}

/**
 * POST /api/v1/admin/processos — abre um Processo em nome de um Cidadão
 * (Req. 23.4–23.7). Retorna 201 com o Protocolo gerado.
 */
export async function postAbrirProcessoAdmin(req: Request, res: Response): Promise<void> {
  try {
    const { cidadaoId, ...dto } = abrirProcessoAdminSchema.parse(req.body);
    const ator = resolveAtor(req);
    const resultado = await abrirProcessoPeloServidor(cidadaoId, dto, ator);
    res.status(201).json(resultado);
  } catch (err) {
    handleError(err, res);
  }
}
