export interface PaginatedResult<T> {
    data: T[];
    meta: {
        total: number;
        page: number;
        pageSize: number;
        totalPages: number;
    };
}
export interface ApiError {
    error: string;
    code: string;
    field?: string;
    details?: unknown;
}
export interface Cidadao {
    id: string;
    nome: string;
    cpf: string;
    email: string;
    telefone: string;
    logradouro: string;
    numero: string;
    cep: string;
    cidade: string;
    estado: string;
    senhaHash: string;
    ativo: boolean;
    emailConfirmado: boolean;
    tokenAtivacao?: string | null;
    tokenAtivacaoExpira?: Date | null;
    tentativasLogin: number;
    bloqueadoAte?: Date | null;
    doisFatoresAtivo: boolean;
    doisFatoresCanal?: string | null;
    criadoEm: Date;
    atualizadoEm: Date;
}
export interface Servidor {
    id: string;
    nome: string;
    cpf: string;
    email: string;
    telefone?: string | null;
    senhaHash: string;
    nivelAcesso: number;
    ativo: boolean;
    senhaTemporaria: boolean;
    tentativasLogin: number;
    bloqueadoAte?: Date | null;
    unidadeId: string;
    criadoEm: Date;
    atualizadoEm: Date;
}
export interface PermissaoServidor {
    id: string;
    servidorId: string;
    permissao: string;
    concedida: boolean;
}
export interface Unidade {
    id: string;
    nome: string;
    secretaria: string;
    endereco?: string | null;
    telefone?: string | null;
    horarioFuncionamento?: string | null;
    ativa: boolean;
    modoAtribuicao: string;
    gestorId?: string | null;
    prefixoProtocolo?: string | null;
    criadoEm: Date;
}
export interface Categoria {
    id: string;
    nome: string;
    descricao?: string | null;
    icone?: string | null;
    cor?: string | null;
    secretaria?: string | null;
    ativa: boolean;
    gestorId?: string | null;
    prefixoProtocolo?: string | null;
    criadoEm: Date;
}
export interface TipoProcesso {
    id: string;
    nome: string;
    prazoTotalDiasUteis: number;
    ativo: boolean;
    categoriaId: string;
    fluxoId?: string | null;
    criadoEm: Date;
}
export interface Fluxo {
    id: string;
    nome: string;
    versao: number;
    criadoEm: Date;
    criadoPorId: string;
}
export interface Etapa {
    id: string;
    nome: string;
    prazosDiasUteis: number;
    ordem: number;
    fluxoId: string;
    servidorPadraoId?: string | null;
    criadoEm: Date;
}
export interface Automacao {
    id: string;
    etapaId: string;
    tipo: string;
    payload: string;
}
export interface FormularioDinamico {
    id: string;
    tipoProcessoId: string;
    unidadeId: string;
    ativo: boolean;
    criadoEm: Date;
    criadoPorId: string;
}
export interface CampoFormulario {
    id: string;
    formularioId: string;
    tipo: string;
    rotulo: string;
    descricaoAuxiliar?: string | null;
    obrigatorio: boolean;
    validacao?: string | null;
    valorPadrao?: unknown;
    ordem: number;
    opcoes?: string[] | null;
}
export interface Processo {
    id: string;
    protocolo: string;
    status: string;
    prioridade: number;
    cidadaoId: string;
    tipoProcessoId: string;
    unidadeId: string;
    servidorResponsavelId?: string | null;
    etapaAtualId?: string | null;
    fluxoVersaoId: string;
    abertoEm: Date;
    prazoFinal: Date;
    encerradoEm?: Date | null;
    criadoEm: Date;
    atualizadoEm: Date;
}
export interface RespostaFormulario {
    id: string;
    processoId: string;
    campoId: string;
    valor: string;
}
export interface MovimentacaoProcesso {
    id: string;
    processoId: string;
    etapaOrigemId?: string | null;
    etapaDestinoId?: string | null;
    servidorId: string;
    observacao?: string | null;
    realizadoEm: Date;
}
export interface Documento {
    id: string;
    processoId: string;
    nomeOriginal: string;
    mimeType: string;
    tamanhoBytes: number;
    caminhoStorage: string;
    enviadoPorCidadao: boolean;
    enviadoPorId: string;
    enviadoEm: Date;
}
export interface Mensagem {
    id: string;
    processoId: string;
    canal: string;
    conteudo: string;
    remetenteCidadaoId?: string | null;
    remetenteServidorId?: string | null;
    caminhoAnexo?: string | null;
    enviadaEm: Date;
    lida?: Date | null;
}
export interface Notificacao {
    id: string;
    cidadaoId?: string | null;
    servidorId?: string | null;
    tipoEvento: string;
    canal: string;
    conteudo: string;
    entregue: boolean;
    tentativas: number;
    agendadaPara?: Date | null;
    entregueEm?: Date | null;
    criadaEm: Date;
}
export interface PreferenciaNotificacao {
    id: string;
    cidadaoId: string;
    tipoEvento: string;
    canais: string[];
    inicioSilencio?: string | null;
    fimSilencio?: string | null;
}
export interface AuditoriaLog {
    id: string;
    ator: string;
    atorCidadaoId?: string | null;
    atorServidorId?: string | null;
    enderecoIp: string;
    tipoAcao: string;
    modulo: string;
    objetoId?: string | null;
    tipoObjeto?: string | null;
    valorAnterior?: string | null;
    valorPosterior?: string | null;
    realizadaEmUtc: Date;
}
export interface AcessoHistorico {
    id: string;
    cidadaoId?: string | null;
    servidorId?: string | null;
    enderecoIp: string;
    acessadoEm: Date;
}
export interface Tarefa {
    id: string;
    titulo: string;
    descricao?: string | null;
    status: string;
    prioridade?: number | null;
    criadoPorId: string;
    processoId?: string | null;
    prazo: Date;
    criadoEm: Date;
    atualizadoEm: Date;
}
export interface TarefaAtribuicao {
    id: string;
    tarefaId: string;
    servidorId: string;
    status: string;
    notificadoProximidade: boolean;
    notificadoVencida: boolean;
    concluidaEm?: Date | null;
    criadoEm: Date;
    atualizadoEm: Date;
}
//# sourceMappingURL=index.d.ts.map