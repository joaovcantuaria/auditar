import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { ErrorCodes } from '@auditar/shared';
import { AppError } from '../../utils/errors.js';
import {
  criarServidorSchema,
  editarServidorSchema,
  paginacaoServidorSchema,
  desativarServidorSchema,
  atualizarPermissoesSchema,
} from './servidores.schema.js';
import {
  listar,
  criar,
  obter,
  editar,
  desativar,
  atualizarPermissoes,
  type Ator,
} from './servidores.service.js';

/**
 * Controllers HTTP do CRUD de Servidores (Req. 21).
 *
 * Cada handler: (1) valida a entrada, (2) chama o serviço, (3) mapeia erros
 * conhecidos para a estrutura `{ error, code, field }`.
 *
 * _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5, 21.9_
 */

/** Serializa erros conhecidos para a resposta padrão da API. */
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

  console.error('[servidores] erro inesperado:', err instanceof Error ? err.message : err);
  res
    .status(500)
    .json({ error: 'Erro interno do servidor', code: ErrorCodes.SERVICO_INDISPONIVEL });
}

/** Resolve o IP de origem da requisição, com fallback seguro. */
function resolveIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'desconhecido';
}

/** Extrai o ator (servidor autenticado) + IP a partir da requisição. */
function extrairAtor(req: Request): Ator {
  return { servidorId: req.user?.sub ?? 'desconhecido', enderecoIp: resolveIp(req) };
}

/** GET /  — lista Servidores paginados, com filtros opcionais. */
export async function getServidores(req: Request, res: Response): Promise<void> {
  try {
    const filtros = paginacaoServidorSchema.parse(req.query);
    const resultado = await listar(filtros);
    res.status(200).json(resultado);
  } catch (err) {
    handleError(err, res);
  }
}

/**
 * POST /  — cadastra um Servidor.
 *
 * Responde 201 com o Servidor criado (sem hash de senha) e sinaliza se a senha
 * temporária foi enviada por email. Em caso de falha no envio (Req. 21.4), o
 * cadastro é mantido e `senhaEnviada = false`, orientando o Admin a reenviar.
 */
export async function postServidor(req: Request, res: Response): Promise<void> {
  try {
    const dto = criarServidorSchema.parse(req.body);
    const { servidor, senhaEnviada } = await criar(dto, extrairAtor(req));
    res.status(201).json({
      servidor,
      senhaEnviada,
      mensagem: senhaEnviada
        ? 'Servidor cadastrado. Uma senha temporária foi enviada ao email institucional.'
        : 'Servidor cadastrado, mas o envio da senha temporária por email falhou. Reenvie o email.',
    });
  } catch (err) {
    handleError(err, res);
  }
}

/** GET /:id  — obtém um Servidor com suas permissões granulares. */
export async function getServidor(req: Request, res: Response): Promise<void> {
  try {
    const servidor = await obter(req.params.id);
    res.status(200).json(servidor);
  } catch (err) {
    handleError(err, res);
  }
}

/** PATCH /:id  — edita um Servidor (CPF imutável). */
export async function patchServidor(req: Request, res: Response): Promise<void> {
  try {
    const dto = editarServidorSchema.parse(req.body);
    const servidor = await editar(req.params.id, dto, extrairAtor(req));
    res.status(200).json(servidor);
  } catch (err) {
    handleError(err, res);
  }
}

/**
 * POST /:id/desativar  — desativa um Servidor (Req. 21.6, 21.7, 21.8).
 *
 * Exige a reatribuição de todos os Processos em andamento atribuídos antes de
 * confirmar. Se faltar cobrir algum, o serviço lança 400 listando os Processos
 * pendentes. No sucesso, encerra as sessões ativas do Servidor via kill-switch.
 */
export async function postDesativar(req: Request, res: Response): Promise<void> {
  try {
    const { reatribuicoes } = desativarServidorSchema.parse(req.body ?? {});
    const resultado = await desativar(req.params.id, reatribuicoes, extrairAtor(req));
    res.status(200).json(resultado);
  } catch (err) {
    handleError(err, res);
  }
}

/**
 * PUT /:id/permissoes  — substitui as permissões granulares de um Servidor
 * (Req. 8.6/8.9), registrando os valores anterior/posterior na Auditoria.
 */
export async function putPermissoes(req: Request, res: Response): Promise<void> {
  try {
    const { permissoes } = atualizarPermissoesSchema.parse(req.body ?? {});
    const atualizadas = await atualizarPermissoes(req.params.id, permissoes, extrairAtor(req));
    res.status(200).json({ permissoes: atualizadas });
  } catch (err) {
    handleError(err, res);
  }
}
