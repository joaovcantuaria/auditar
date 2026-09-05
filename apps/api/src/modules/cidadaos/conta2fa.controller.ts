import type { Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { ErrorCodes } from '@auditar/shared';
import { AppError } from '../../utils/index.js';
import { ativar2fa, desativar2fa, type Canal2fa } from '../auth/auth.2fa.service.js';

/**
 * Controller HTTP da configuração de autenticação de dois fatores (2FA) na
 * Gestão de Conta do Cidadão (Req. 2.5).
 *
 * Segue o mesmo padrão dos demais controllers de `cidadaos`:
 *  - o id do cidadão vem sempre do token autenticado (`req.user.sub`);
 *  - a entrada é validada com zod;
 *  - erros conhecidos (`ZodError`, `AppError`) são serializados na forma
 *    `ApiError` (`{ error, code, field? }`), demais erros viram 500.
 */

/** Schema do corpo do PATCH /2fa. Quando `ativo === true`, o canal é obrigatório. */
const patch2faSchema = z
  .object({
    ativo: z.boolean(),
    canal: z.enum(['email', 'sms']).optional(),
  })
  .refine((dto) => !dto.ativo || dto.canal !== undefined, {
    message: 'O canal é obrigatório ao ativar a autenticação de dois fatores',
    path: ['canal'],
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
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      field: err.field,
    });
    return;
  }

  console.error(
    JSON.stringify({
      level: 'error',
      scope: 'cidadaos.conta2fa.controller',
      event: 'erro_nao_tratado',
      message: err instanceof Error ? err.message : String(err),
    }),
  );
  res.status(500).json({ error: 'Erro interno', code: ErrorCodes.SERVICO_INDISPONIVEL });
}

/**
 * PATCH /api/v1/cidadao/conta/2fa — ativa ou desativa o 2FA do cidadão.
 *
 * Body: `{ ativo: boolean, canal?: 'email' | 'sms' }`.
 *  - `ativo === true` exige `canal` e habilita o 2FA no canal informado.
 *  - `ativo === false` desabilita o 2FA (canal volta a `null`).
 *
 * Responde 200 com `{ doisFatoresAtivo, doisFatoresCanal }` refletindo o estado
 * resultante.
 */
export async function patch2fa(req: Request, res: Response): Promise<void> {
  try {
    const cidadaoId = req.user?.sub ?? '';
    const dto = patch2faSchema.parse(req.body);

    if (dto.ativo) {
      const canal = dto.canal as Canal2fa;
      await ativar2fa(cidadaoId, canal);
      res.status(200).json({ doisFatoresAtivo: true, doisFatoresCanal: canal });
      return;
    }

    await desativar2fa(cidadaoId);
    res.status(200).json({ doisFatoresAtivo: false, doisFatoresCanal: null });
  } catch (err) {
    handleError(err, res);
  }
}
