import type { Request, Response } from 'express';
import { ZodError, z } from 'zod';
import {
  ErrorCodes,
  criarTarefaSchema,
  filtroTarefaSchema,
  atualizarStatusTarefaSchema,
} from '@auditar/shared';
import { AppError } from '../../utils/errors.js';
import {
  listar,
  criar,
  obter,
  editar,
  remover,
  minhas,
  alterarStatusMinha,
  type Ator,
  type CriarTarefaDto,
} from './tarefas.service.js';

/**
 * Controllers HTTP do Organizador de Tarefas (Req. 27).
 *
 * Cada handler: (1) valida a entrada, (2) chama o serviço, (3) mapeia erros
 * conhecidos para a estrutura `{ error, code, field }`.
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

  console.error('[tarefas] erro inesperado:', err instanceof Error ? err.message : err);
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

/**
 * Schema de criação estendido: aceita `todos` (direcionar a todos os Servidores
 * ativos). Quando `todos` é `true`, `destinatarios` torna-se opcional, pois a
 * lista é resolvida no serviço a partir dos Servidores ativos (Req. 27.4).
 */
const criarTarefaBodySchema = criarTarefaSchema
  .extend({
    todos: z.boolean().optional(),
    destinatarios: criarTarefaSchema.shape.destinatarios.optional(),
  })
  .refine((v) => v.todos === true || (v.destinatarios?.length ?? 0) >= 1, {
    message: 'Selecione ao menos um destinatário',
    path: ['destinatarios'],
  });

/** Schema de edição da Tarefa (todos os campos opcionais — Req. 27.1, 27.12). */
const editarTarefaBodySchema = z.object({
  titulo: z.string().min(1).max(150).optional(),
  descricao: z.string().max(2000).nullable().optional(),
  prazo: z.coerce.date().optional(),
  prioridade: z.coerce.number().int().min(0).max(2).nullable().optional(),
  processoId: z.string().uuid().nullable().optional(),
});

/** POST /  — cria uma Tarefa e distribui as atribuições. */
export async function postTarefa(req: Request, res: Response): Promise<void> {
  try {
    const dto = criarTarefaBodySchema.parse(req.body) as CriarTarefaDto;
    const resultado = await criar(dto, extrairAtor(req));
    res.status(201).json(resultado);
  } catch (err) {
    handleError(err, res);
  }
}

/** GET /  — lista Tarefas com filtros opcionais. */
export async function getTarefas(req: Request, res: Response): Promise<void> {
  try {
    const filtros = filtroTarefaSchema.parse(req.query);
    const tarefas = await listar(filtros);
    res.status(200).json(tarefas);
  } catch (err) {
    handleError(err, res);
  }
}

/** GET /minhas  — atribuições do servidor autenticado agrupadas por status. */
export async function getMinhasTarefas(req: Request, res: Response): Promise<void> {
  try {
    const servidorId = req.user?.sub ?? 'desconhecido';
    const grupos = await minhas(servidorId);
    res.status(200).json(grupos);
  } catch (err) {
    handleError(err, res);
  }
}

/** GET /:id  — detalhe da Tarefa com suas atribuições. */
export async function getTarefa(req: Request, res: Response): Promise<void> {
  try {
    const tarefa = await obter(req.params.id);
    res.status(200).json(tarefa);
  } catch (err) {
    handleError(err, res);
  }
}

/** PATCH /:id  — edita a Tarefa. */
export async function patchTarefa(req: Request, res: Response): Promise<void> {
  try {
    const dto = editarTarefaBodySchema.parse(req.body ?? {});
    const tarefa = await editar(req.params.id, dto, extrairAtor(req));
    res.status(200).json(tarefa);
  } catch (err) {
    handleError(err, res);
  }
}

/** DELETE /:id  — remove a Tarefa. */
export async function deleteTarefa(req: Request, res: Response): Promise<void> {
  try {
    const resultado = await remover(req.params.id, extrairAtor(req));
    res.status(200).json(resultado);
  } catch (err) {
    handleError(err, res);
  }
}

/** PATCH /:id/atribuicoes/minha  — altera o status da própria atribuição. */
export async function patchMinhaAtribuicao(req: Request, res: Response): Promise<void> {
  try {
    const dto = atualizarStatusTarefaSchema.parse(req.body ?? {});
    const servidorId = req.user?.sub ?? 'desconhecido';
    const atualizada = await alterarStatusMinha(req.params.id, servidorId, dto, extrairAtor(req));
    res.status(200).json(atualizada);
  } catch (err) {
    handleError(err, res);
  }
}
