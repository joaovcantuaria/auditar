import { z } from 'zod';
import { TipoCampo, StatusProcesso, StatusTarefa } from '../constants/index.js';
/** CPF: exactly 11 numeric digits (no formatting) */
export declare const cpfSchema: z.ZodString;
/** Email: valid format, max 254 chars */
export declare const emailSchema: z.ZodString;
/**
 * Senha for login: 8–128 characters (Req 2.1)
 * Broader range to accommodate server-set passwords.
 */
export declare const senhaSchema: z.ZodString;
/**
 * Senha for account settings / registration: 8–64 characters (Req 7.3)
 */
export declare const senhaCadastroSchema: z.ZodString;
/** Telefone: 10 or 11 numeric digits (Req 1.1) */
export declare const telefoneSchema: z.ZodString;
/** CEP: exactly 8 numeric digits (Req 1.1) */
export declare const cepSchema: z.ZodString;
/** Full citizen registration form (Req 1.1) */
export declare const registerCidadaoSchema: z.ZodObject<{
    nome: z.ZodString;
    cpf: z.ZodString;
    email: z.ZodString;
    telefone: z.ZodString;
    logradouro: z.ZodString;
    numero: z.ZodString;
    cep: z.ZodString;
    cidade: z.ZodString;
    estado: z.ZodString;
    senha: z.ZodString;
}, "strip", z.ZodTypeAny, {
    cpf: string;
    email: string;
    nome: string;
    telefone: string;
    logradouro: string;
    numero: string;
    cep: string;
    cidade: string;
    estado: string;
    senha: string;
}, {
    cpf: string;
    email: string;
    nome: string;
    telefone: string;
    logradouro: string;
    numero: string;
    cep: string;
    cidade: string;
    estado: string;
    senha: string;
}>;
export type RegisterCidadaoInput = z.infer<typeof registerCidadaoSchema>;
export declare const loginSchema: z.ZodObject<{
    cpf: z.ZodString;
    senha: z.ZodString;
    manterConectado: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, "strip", z.ZodTypeAny, {
    cpf: string;
    senha: string;
    manterConectado: boolean;
}, {
    cpf: string;
    senha: string;
    manterConectado?: boolean | undefined;
}>;
export type LoginInput = z.infer<typeof loginSchema>;
export declare const paginacaoSchema: z.ZodObject<{
    page: z.ZodDefault<z.ZodNumber>;
    pageSize: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    page: number;
    pageSize: number;
}, {
    page?: number | undefined;
    pageSize?: number | undefined;
}>;
export type PaginacaoInput = z.infer<typeof paginacaoSchema>;
export declare const filtroProcessoSchema: z.ZodObject<{
    categoriaId: z.ZodOptional<z.ZodString>;
    tipoProcessoId: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodNativeEnum<typeof StatusProcesso>>;
    dataAberturaInicio: z.ZodOptional<z.ZodDate>;
    dataAberturaFim: z.ZodOptional<z.ZodDate>;
    prazoDe: z.ZodOptional<z.ZodDate>;
    prazoAte: z.ZodOptional<z.ZodDate>;
    servidorId: z.ZodOptional<z.ZodString>;
    nomeCidadao: z.ZodOptional<z.ZodString>;
    cpfCidadao: z.ZodOptional<z.ZodString>;
    unidadeId: z.ZodOptional<z.ZodString>;
    prioridade: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    status?: StatusProcesso | undefined;
    unidadeId?: string | undefined;
    servidorId?: string | undefined;
    categoriaId?: string | undefined;
    tipoProcessoId?: string | undefined;
    prioridade?: number | undefined;
    dataAberturaInicio?: Date | undefined;
    dataAberturaFim?: Date | undefined;
    nomeCidadao?: string | undefined;
    cpfCidadao?: string | undefined;
    prazoDe?: Date | undefined;
    prazoAte?: Date | undefined;
}, {
    status?: StatusProcesso | undefined;
    unidadeId?: string | undefined;
    servidorId?: string | undefined;
    categoriaId?: string | undefined;
    tipoProcessoId?: string | undefined;
    prioridade?: number | undefined;
    dataAberturaInicio?: Date | undefined;
    dataAberturaFim?: Date | undefined;
    nomeCidadao?: string | undefined;
    cpfCidadao?: string | undefined;
    prazoDe?: Date | undefined;
    prazoAte?: Date | undefined;
}>;
export type FiltroProcessoInput = z.infer<typeof filtroProcessoSchema>;
export declare const campoFormularioSchema: z.ZodObject<{
    tipo: z.ZodNativeEnum<typeof TipoCampo>;
    rotulo: z.ZodString;
    descricaoAuxiliar: z.ZodOptional<z.ZodString>;
    obrigatorio: z.ZodDefault<z.ZodBoolean>;
    validacao: z.ZodOptional<z.ZodString>;
    valorPadrao: z.ZodOptional<z.ZodUnknown>;
    ordem: z.ZodNumber;
    opcoes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    ordem: number;
    tipo: TipoCampo;
    rotulo: string;
    obrigatorio: boolean;
    descricaoAuxiliar?: string | undefined;
    validacao?: string | undefined;
    valorPadrao?: unknown;
    opcoes?: string[] | undefined;
}, {
    ordem: number;
    tipo: TipoCampo;
    rotulo: string;
    descricaoAuxiliar?: string | undefined;
    obrigatorio?: boolean | undefined;
    validacao?: string | undefined;
    valorPadrao?: unknown;
    opcoes?: string[] | undefined;
}>;
export type CampoFormularioInput = z.infer<typeof campoFormularioSchema>;
export declare const registerServidorSchema: z.ZodObject<{
    nome: z.ZodString;
    cpf: z.ZodString;
    email: z.ZodString;
    telefone: z.ZodOptional<z.ZodString>;
    nivelAcesso: z.ZodNumber;
    unidadeId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    cpf: string;
    email: string;
    nome: string;
    nivelAcesso: number;
    unidadeId: string;
    telefone?: string | undefined;
}, {
    cpf: string;
    email: string;
    nome: string;
    nivelAcesso: number;
    unidadeId: string;
    telefone?: string | undefined;
}>;
export type RegisterServidorInput = z.infer<typeof registerServidorSchema>;
export declare const alterarSenhaSchema: z.ZodObject<{
    senhaAtual: z.ZodString;
    novaSenha: z.ZodString;
}, "strip", z.ZodTypeAny, {
    senhaAtual: string;
    novaSenha: string;
}, {
    senhaAtual: string;
    novaSenha: string;
}>;
export type AlterarSenhaInput = z.infer<typeof alterarSenhaSchema>;
export declare const filtroRelatorioSchema: z.ZodEffects<z.ZodEffects<z.ZodObject<{
    dataInicio: z.ZodDate;
    dataFim: z.ZodDate;
    categoriaId: z.ZodOptional<z.ZodString>;
    tipoProcessoId: z.ZodOptional<z.ZodString>;
    unidadeId: z.ZodOptional<z.ZodString>;
    servidorId: z.ZodOptional<z.ZodString>;
    formato: z.ZodOptional<z.ZodEnum<["csv", "pdf"]>>;
}, "strip", z.ZodTypeAny, {
    dataInicio: Date;
    dataFim: Date;
    unidadeId?: string | undefined;
    servidorId?: string | undefined;
    categoriaId?: string | undefined;
    tipoProcessoId?: string | undefined;
    formato?: "pdf" | "csv" | undefined;
}, {
    dataInicio: Date;
    dataFim: Date;
    unidadeId?: string | undefined;
    servidorId?: string | undefined;
    categoriaId?: string | undefined;
    tipoProcessoId?: string | undefined;
    formato?: "pdf" | "csv" | undefined;
}>, {
    dataInicio: Date;
    dataFim: Date;
    unidadeId?: string | undefined;
    servidorId?: string | undefined;
    categoriaId?: string | undefined;
    tipoProcessoId?: string | undefined;
    formato?: "pdf" | "csv" | undefined;
}, {
    dataInicio: Date;
    dataFim: Date;
    unidadeId?: string | undefined;
    servidorId?: string | undefined;
    categoriaId?: string | undefined;
    tipoProcessoId?: string | undefined;
    formato?: "pdf" | "csv" | undefined;
}>, {
    dataInicio: Date;
    dataFim: Date;
    unidadeId?: string | undefined;
    servidorId?: string | undefined;
    categoriaId?: string | undefined;
    tipoProcessoId?: string | undefined;
    formato?: "pdf" | "csv" | undefined;
}, {
    dataInicio: Date;
    dataFim: Date;
    unidadeId?: string | undefined;
    servidorId?: string | undefined;
    categoriaId?: string | undefined;
    tipoProcessoId?: string | undefined;
    formato?: "pdf" | "csv" | undefined;
}>;
export type FiltroRelatorioInput = z.infer<typeof filtroRelatorioSchema>;
/**
 * Criação de Tarefa (Req. 27.1, 27.2, 27.3).
 * Campos obrigatórios: título, prazo (data futura) e ao menos um destinatário.
 * Opcionais: descrição, prioridade e vínculo a Processo.
 */
export declare const criarTarefaSchema: z.ZodObject<{
    titulo: z.ZodString;
    descricao: z.ZodOptional<z.ZodString>;
    prazo: z.ZodEffects<z.ZodDate, Date, Date>;
    prioridade: z.ZodOptional<z.ZodNumber>;
    processoId: z.ZodOptional<z.ZodString>;
    destinatarios: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    prazo: Date;
    titulo: string;
    destinatarios: string[];
    prioridade?: number | undefined;
    processoId?: string | undefined;
    descricao?: string | undefined;
}, {
    prazo: Date;
    titulo: string;
    destinatarios: string[];
    prioridade?: number | undefined;
    processoId?: string | undefined;
    descricao?: string | undefined;
}>;
export type CriarTarefaInput = z.infer<typeof criarTarefaSchema>;
/**
 * Atualização de status de uma Atribuição de Tarefa (Req. 27.6, 27.7).
 */
export declare const atualizarStatusTarefaSchema: z.ZodObject<{
    status: z.ZodNativeEnum<typeof StatusTarefa>;
}, "strip", z.ZodTypeAny, {
    status: StatusTarefa;
}, {
    status: StatusTarefa;
}>;
export type AtualizarStatusTarefaInput = z.infer<typeof atualizarStatusTarefaSchema>;
/**
 * Filtros da listagem de Tarefas (Req. 27.10, 27.11).
 */
export declare const filtroTarefaSchema: z.ZodObject<{
    status: z.ZodOptional<z.ZodNativeEnum<typeof StatusTarefa>>;
    prazoDe: z.ZodOptional<z.ZodDate>;
    prazoAte: z.ZodOptional<z.ZodDate>;
    processoId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status?: StatusTarefa | undefined;
    processoId?: string | undefined;
    prazoDe?: Date | undefined;
    prazoAte?: Date | undefined;
}, {
    status?: StatusTarefa | undefined;
    processoId?: string | undefined;
    prazoDe?: Date | undefined;
    prazoAte?: Date | undefined;
}>;
export type FiltroTarefaInput = z.infer<typeof filtroTarefaSchema>;
//# sourceMappingURL=index.d.ts.map