// Zod schemas for isomorphic validation (shared by API and frontend)
import { z } from 'zod';
import { TipoCampo, StatusProcesso, StatusTarefa } from '../constants/index.js';

// ---------------------------------------------------------------------------
// Primitive field schemas
// ---------------------------------------------------------------------------

/** CPF: exactly 11 numeric digits (no formatting) */
export const cpfSchema = z
  .string()
  .regex(/^\d{11}$/, 'CPF deve conter exatamente 11 dígitos numéricos');

/** Email: valid format, max 254 chars */
export const emailSchema = z
  .string()
  .email('Formato de e-mail inválido')
  .max(254, 'E-mail deve ter no máximo 254 caracteres');

/**
 * Senha for login: 8–128 characters (Req 2.1)
 * Broader range to accommodate server-set passwords.
 */
export const senhaSchema = z
  .string()
  .min(8, 'Senha deve ter no mínimo 8 caracteres')
  .max(128, 'Senha deve ter no máximo 128 caracteres');

/**
 * Senha for account settings / registration: 8–64 characters (Req 7.3)
 */
export const senhaCadastroSchema = z
  .string()
  .min(8, 'Senha deve ter no mínimo 8 caracteres')
  .max(64, 'Senha deve ter no máximo 64 caracteres');

/** Telefone: 10 or 11 numeric digits (Req 1.1) */
export const telefoneSchema = z
  .string()
  .regex(/^\d{10,11}$/, 'Telefone deve conter 10 ou 11 dígitos numéricos');

/** CEP: exactly 8 numeric digits (Req 1.1) */
export const cepSchema = z
  .string()
  .regex(/^\d{8}$/, 'CEP deve conter exatamente 8 dígitos numéricos');

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Full citizen registration form (Req 1.1) */
export const registerCidadaoSchema = z.object({
  nome:       z.string().min(1, 'Nome é obrigatório').max(150, 'Nome deve ter no máximo 150 caracteres'),
  cpf:        cpfSchema,
  email:      emailSchema,
  telefone:   telefoneSchema,
  logradouro: z.string().min(1, 'Logradouro é obrigatório').max(200, 'Logradouro deve ter no máximo 200 caracteres'),
  numero:     z.string().min(1, 'Número é obrigatório'),
  cep:        cepSchema,
  cidade:     z.string().min(1, 'Cidade é obrigatória'),
  estado:     z.string().length(2, 'Estado deve conter exatamente 2 caracteres'),
  senha:      senhaCadastroSchema,
});

export type RegisterCidadaoInput = z.infer<typeof registerCidadaoSchema>;

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export const loginSchema = z.object({
  cpf:   cpfSchema,
  senha: senhaSchema,
  manterConectado: z.boolean().optional().default(false),
});

export type LoginInput = z.infer<typeof loginSchema>;

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export const paginacaoSchema = z.object({
  page:     z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginacaoInput = z.infer<typeof paginacaoSchema>;

// ---------------------------------------------------------------------------
// Process filter
// ---------------------------------------------------------------------------

export const filtroProcessoSchema = z.object({
  categoriaId:       z.string().uuid().optional(),
  tipoProcessoId:    z.string().uuid().optional(),
  status:            z.nativeEnum(StatusProcesso).optional(),
  dataAberturaInicio: z.coerce.date().optional(),
  dataAberturaFim:   z.coerce.date().optional(),
  prazoDe:           z.coerce.date().optional(),
  prazoAte:          z.coerce.date().optional(),
  servidorId:        z.string().uuid().optional(),
  nomeCidadao:       z.string().optional(),
  cpfCidadao:        z.string().regex(/^\d{11}$/).optional(),
  unidadeId:         z.string().uuid().optional(),
  prioridade:        z.coerce.number().int().optional(),
});

export type FiltroProcessoInput = z.infer<typeof filtroProcessoSchema>;

// ---------------------------------------------------------------------------
// Dynamic form field configuration (Req 16.1, 16.2)
// ---------------------------------------------------------------------------

export const campoFormularioSchema = z.object({
  tipo:             z.nativeEnum(TipoCampo),
  rotulo:           z.string().min(1, 'Rótulo é obrigatório').max(100, 'Rótulo deve ter no máximo 100 caracteres'),
  descricaoAuxiliar: z.string().max(300, 'Descrição deve ter no máximo 300 caracteres').optional(),
  obrigatorio:      z.boolean().default(false),
  validacao:        z.string().optional(),
  valorPadrao:      z.unknown().optional(),
  ordem:            z.number().int().min(0),
  opcoes:           z.array(z.string()).optional(),
});

export type CampoFormularioInput = z.infer<typeof campoFormularioSchema>;

// ---------------------------------------------------------------------------
// Server registration (Req 21.1)
// ---------------------------------------------------------------------------

export const registerServidorSchema = z.object({
  nome:         z.string().min(1, 'Nome é obrigatório').max(150, 'Nome deve ter no máximo 150 caracteres'),
  cpf:          cpfSchema,
  email:        emailSchema,
  telefone:     telefoneSchema.optional(),
  nivelAcesso:  z.number().int().min(1).max(7),
  unidadeId:    z.string().uuid('Unidade inválida'),
});

export type RegisterServidorInput = z.infer<typeof registerServidorSchema>;

// ---------------------------------------------------------------------------
// Password change (Req 7.3)
// ---------------------------------------------------------------------------

export const alterarSenhaSchema = z.object({
  senhaAtual: senhaSchema,
  novaSenha:  senhaCadastroSchema,
});

export type AlterarSenhaInput = z.infer<typeof alterarSenhaSchema>;

// ---------------------------------------------------------------------------
// Date range validation helper (Req 18.7)
// ---------------------------------------------------------------------------

export const filtroRelatorioSchema = z
  .object({
    dataInicio:    z.coerce.date(),
    dataFim:       z.coerce.date(),
    categoriaId:   z.string().uuid().optional(),
    tipoProcessoId: z.string().uuid().optional(),
    unidadeId:     z.string().uuid().optional(),
    servidorId:    z.string().uuid().optional(),
    formato:       z.enum(['csv', 'pdf']).optional(),
  })
  .refine((data) => data.dataFim >= data.dataInicio, {
    message: 'Data final deve ser igual ou posterior à data inicial',
    path: ['dataFim'],
  })
  .refine(
    (data) => {
      const diff = data.dataFim.getTime() - data.dataInicio.getTime();
      const days = diff / (1000 * 60 * 60 * 24);
      return days <= 366;
    },
    {
      message: 'O intervalo de datas não pode ser superior a 366 dias',
      path: ['dataFim'],
    },
  );

export type FiltroRelatorioInput = z.infer<typeof filtroRelatorioSchema>;

// ---------------------------------------------------------------------------
// Tarefas (Req. 27 — Organizador de Tarefas)
// ---------------------------------------------------------------------------

/**
 * Criação de Tarefa (Req. 27.1, 27.2, 27.3).
 * Campos obrigatórios: título, prazo (data futura) e ao menos um destinatário.
 * Opcionais: descrição, prioridade e vínculo a Processo.
 */
export const criarTarefaSchema = z.object({
  titulo:      z.string().min(1, 'Título é obrigatório').max(150, 'Título deve ter no máximo 150 caracteres'),
  descricao:   z.string().max(2000, 'Descrição deve ter no máximo 2000 caracteres').optional(),
  // Prazo com data e hora; deve ser futuro em relação ao momento da validação
  prazo:       z.coerce.date().refine((d) => d.getTime() > Date.now(), {
    message: 'O prazo deve ser uma data futura',
  }),
  // Prioridade opcional: 0=baixa, 1=média, 2=alta
  prioridade:  z.coerce.number().int().min(0).max(2).optional(),
  processoId:  z.string().uuid('Processo inválido').optional(),
  // Destinatários: ao menos um Servidor (ids). O modo "todos" é resolvido no backend.
  destinatarios: z
    .array(z.string().uuid('Destinatário inválido'))
    .min(1, 'Selecione ao menos um destinatário'),
});

export type CriarTarefaInput = z.infer<typeof criarTarefaSchema>;

/**
 * Atualização de status de uma Atribuição de Tarefa (Req. 27.6, 27.7).
 */
export const atualizarStatusTarefaSchema = z.object({
  status: z.nativeEnum(StatusTarefa),
});

export type AtualizarStatusTarefaInput = z.infer<typeof atualizarStatusTarefaSchema>;

/**
 * Filtros da listagem de Tarefas (Req. 27.10, 27.11).
 */
export const filtroTarefaSchema = z.object({
  status:     z.nativeEnum(StatusTarefa).optional(),
  prazoDe:    z.coerce.date().optional(),
  prazoAte:   z.coerce.date().optional(),
  processoId: z.string().uuid().optional(),
});

export type FiltroTarefaInput = z.infer<typeof filtroTarefaSchema>;
