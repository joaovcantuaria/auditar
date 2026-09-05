export declare enum StatusProcesso {
    ABERTO = "aberto",
    EM_ANDAMENTO = "em_andamento",
    AGUARDANDO_DOCS = "aguardando_docs",
    AGUARDANDO_CIDADAO = "aguardando_cidadao",
    VENCIDO = "vencido",
    APROVADO = "aprovado",
    REJEITADO = "rejeitado",
    FINALIZADO = "finalizado"
}
export declare enum NivelAcesso {
    ADMINISTRADOR = 1,
    GESTOR_GERAL = 2,
    GESTOR_CATEGORIA = 3,
    GESTOR_UNIDADE = 4,
    ANALISTA = 5,
    INSPETOR = 6,
    VISUALIZADOR = 7
}
export declare enum Permissao {
    VISUALIZAR = "visualizar",
    EDITAR = "editar",
    MOVER_ETAPA = "mover_etapa",
    REJEITAR = "rejeitar",
    SOLICITAR_DOCUMENTOS = "solicitar_documentos",
    OBSERVACAO_PUBLICA = "observacao_publica",
    OBSERVACAO_INTERNA = "observacao_interna",
    ACESSAR_RELATORIOS = "acessar_relatorios",
    GERENCIAR_USUARIOS = "gerenciar_usuarios",
    CONFIGURAR_FLUXOS = "configurar_fluxos",
    ACESSAR_AUDITORIA = "acessar_auditoria",
    ATRIBUIR = "atribuir",
    APROVAR = "aprovar",
    GERENCIAR_TAREFAS = "gerenciar_tarefas"
}
export declare enum StatusTarefa {
    PENDENTE = "pendente",
    EM_ANDAMENTO = "em_andamento",
    CONCLUIDA = "concluida"
}
export declare enum TipoCampo {
    TEXTO_CURTO = "texto_curto",
    TEXTO_LONGO = "texto_longo",
    NUMERO = "numero",
    DATA = "data",
    SELECAO_UNICA = "selecao_unica",
    SELECAO_MULTIPLA = "selecao_multipla",
    UPLOAD = "upload",
    CPF = "cpf"
}
export declare enum TipoEvento {
    CRIACAO_PROCESSO = "criacao_processo",
    MOVIMENTACAO_ETAPA = "movimentacao_etapa",
    SOLICITACAO_DOCUMENTOS = "solicitacao_documentos",
    APROVACAO = "aprovacao",
    REJEICAO = "rejeicao",
    NOVA_MENSAGEM = "nova_mensagem",
    VENCIMENTO_PRAZO = "vencimento_prazo",
    ATRIBUICAO = "atribuicao",
    TAREFA_ATRIBUIDA = "tarefa_atribuida",
    TAREFA_PROXIMA_VENCIMENTO = "tarefa_proxima_vencimento",
    TAREFA_VENCIDA = "tarefa_vencida"
}
export declare enum CanalNotificacao {
    EMAIL = "email",
    SMS = "sms",
    PAINEL = "painel",
    PUSH = "push"
}
export declare enum ModoAtribuicao {
    AUTOMATICO = "automatico",
    MANUAL = "manual",
    FILA_GERAL = "fila_geral"
}
export declare const ErrorCodes: {
    readonly INVALID_CREDENTIALS: "AUTH_001";
    readonly ACCOUNT_LOCKED: "AUTH_002";
    readonly ACCOUNT_NOT_ACTIVATED: "AUTH_003";
    readonly TOKEN_EXPIRED: "AUTH_004";
    readonly INSUFFICIENT_PERMISSIONS: "AUTH_005";
    readonly VALIDATION_ERROR: "VAL_001";
    readonly CPF_DUPLICADO: "VAL_002";
    readonly CPF_INVALIDO: "VAL_003";
    readonly CAMPO_OBRIGATORIO: "VAL_004";
    readonly FORMATO_INVALIDO: "VAL_005";
    readonly PROCESSO_NAO_ENCONTRADO: "PROC_001";
    readonly PROCESSO_ACESSO_NEGADO: "PROC_002";
    readonly DOCUMENTOS_PENDENTES: "PROC_003";
    readonly PROCESSO_ENCERRADO: "PROC_004";
    readonly ARQUIVO_FORMATO_INVALIDO: "ARQ_001";
    readonly ARQUIVO_MUITO_GRANDE: "ARQ_002";
    readonly LIMITE_ARQUIVOS: "ARQ_003";
    readonly TAREFA_NAO_ENCONTRADA: "TAR_001";
    readonly TAREFA_PRAZO_PASSADO: "TAR_002";
    readonly TAREFA_SEM_DESTINATARIO: "TAR_003";
    readonly PDF_GERACAO_FALHA: "PDF_001";
    readonly AUDITORIA_FALHA: "SYS_001";
    readonly SERVICO_INDISPONIVEL: "SYS_002";
};
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
//# sourceMappingURL=index.d.ts.map