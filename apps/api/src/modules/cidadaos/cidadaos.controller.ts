import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { ErrorCodes } from '@auditar/shared';
import { AppError } from '../../utils/index.js';
import {
  editarPerfilSchema,
  alterarEmailSchema,
  confirmarEmailSchema,
  alterarSenhaSchema,
} from './cidadaos.schema.js';
import { salvarPreferenciasSchema } from './preferencias.schema.js';
import {
  obterPerfil,
  editarPerfil,
  solicitarAlteracaoEmail,
  confirmarAlteracaoEmail,
  alterarSenha,
  historicoAcessos,
  solicitarExclusao,
  type AtorCidadao,
} from './cidadaos.service.js';
import {
  obterPreferencias,
  salvarPreferencias,
} from './preferencias.service.js';

/**
 * Controllers HTTP da Gestão de Conta do Cidadão (Req. 7).
 * Traduzem a requisição Express para o serviço e serializam erros conhecidos
 * (`ZodError`, `AppError`) na forma de resposta `ApiError` (`{ error, code, field? }`).
 * O id do cidadão é sempre extraído do token autenticado (`req.user.sub`).
 */

/** Resolve o IP de origem da requisição, com fallback seguro. */
function resolveIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'desconhecido';
}

/** Extrai o cidadão autenticado da requisição. */
function resolveAtor(req: Request): AtorCidadao {
  return { cidadaoId: req.user?.sub ?? 'desconhecido', enderecoIp: resolveIp(req) };
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
      scope: 'cidadaos.controller',
      event: 'erro_nao_tratado',
      message: err instanceof Error ? err.message : String(err),
    }),
  );
  res.status(500).json({ error: 'Erro interno', code: ErrorCodes.SERVICO_INDISPONIVEL });
}

/** GET /api/v1/cidadao/conta */
export async function getPerfil(req: Request, res: Response): Promise<void> {
  try {
    const perfil = await obterPerfil(req.user?.sub ?? '');
    res.status(200).json({ data: perfil });
  } catch (err) {
    handleError(err, res);
  }
}

/** PATCH /api/v1/cidadao/conta */
export async function patchPerfil(req: Request, res: Response): Promise<void> {
  try {
    const dto = editarPerfilSchema.parse(req.body);
    const ator = resolveAtor(req);
    const perfil = await editarPerfil(ator.cidadaoId, dto, ator);
    res.status(200).json({ data: perfil });
  } catch (err) {
    handleError(err, res);
  }
}

/** POST /api/v1/cidadao/conta/alterar-email */
export async function postAlterarEmail(req: Request, res: Response): Promise<void> {
  try {
    const dto = alterarEmailSchema.parse(req.body);
    const ator = resolveAtor(req);
    await solicitarAlteracaoEmail(ator.cidadaoId, dto.novoEmail, ator);
    res.status(202).json({
      message: 'Enviamos um link de confirmação para o novo e-mail. Ele é válido por 24 horas.',
    });
  } catch (err) {
    handleError(err, res);
  }
}

/** POST /api/v1/cidadao/conta/confirmar-email */
export async function postConfirmarEmail(req: Request, res: Response): Promise<void> {
  try {
    const dto = confirmarEmailSchema.parse(req.body);
    const perfil = await confirmarAlteracaoEmail(dto.token);
    res.status(200).json({ data: perfil });
  } catch (err) {
    handleError(err, res);
  }
}

/** POST /api/v1/cidadao/conta/alterar-senha */
export async function postAlterarSenha(req: Request, res: Response): Promise<void> {
  try {
    const dto = alterarSenhaSchema.parse(req.body);
    const ator = resolveAtor(req);
    await alterarSenha(ator.cidadaoId, dto.senhaAtual, dto.novaSenha, ator);
    res.status(200).json({ message: 'Senha alterada com sucesso' });
  } catch (err) {
    handleError(err, res);
  }
}

/** GET /api/v1/cidadao/conta/acessos */
export async function getAcessos(req: Request, res: Response): Promise<void> {
  try {
    const acessos = await historicoAcessos(req.user?.sub ?? '');
    res.status(200).json({ data: acessos });
  } catch (err) {
    handleError(err, res);
  }
}

/**
 * DELETE /api/v1/cidadao/conta?confirmar=true — exclusão de conta (LGPD).
 *
 * Sem `confirmar=true`, quando há processos em andamento, responde 409 com a
 * lista de processos impactados, exigindo confirmação explícita (Req. 7.7).
 * Caso contrário, registra a solicitação e responde 202 com o prazo-limite de
 * processamento (Req. 7.6).
 */
export async function deleteConta(req: Request, res: Response): Promise<void> {
  try {
    const ator = resolveAtor(req);
    const confirmar = req.query.confirmar === 'true';
    const resultado = await solicitarExclusao(ator.cidadaoId, confirmar, ator);

    if (resultado.requerConfirmacao) {
      res.status(409).json({
        error: 'Existem processos em andamento. Confirme a exclusão para prosseguir.',
        code: ErrorCodes.VALIDATION_ERROR,
        requerConfirmacao: true,
        processos: resultado.processos,
      });
      return;
    }

    res.status(202).json({
      message:
        'Solicitação de exclusão registrada. Seus dados serão anonimizados conforme a LGPD.',
      agendadoPara: resultado.agendadoPara,
      processos: resultado.processos,
    });
  } catch (err) {
    handleError(err, res);
  }
}

/** GET /api/v1/cidadao/conta/notificacoes/preferencias (Req. 6.3, 6.4) */
export async function getPreferencias(req: Request, res: Response): Promise<void> {
  try {
    const preferencias = await obterPreferencias(req.user?.sub ?? '');
    res.status(200).json({ data: preferencias });
  } catch (err) {
    handleError(err, res);
  }
}

/** PUT /api/v1/cidadao/conta/notificacoes/preferencias (Req. 6.3, 6.4) */
export async function putPreferencias(req: Request, res: Response): Promise<void> {
  try {
    const dto = salvarPreferenciasSchema.parse(req.body);
    const preferencias = await salvarPreferencias(req.user?.sub ?? '', dto);
    res.status(200).json({ data: preferencias });
  } catch (err) {
    handleError(err, res);
  }
}
