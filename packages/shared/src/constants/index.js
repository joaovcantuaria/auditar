// Constants and enums for the Auditar system
// ---------------------------------------------------------------------------
// StatusProcesso
// ---------------------------------------------------------------------------
export var StatusProcesso;
(function (StatusProcesso) {
    StatusProcesso["ABERTO"] = "aberto";
    StatusProcesso["EM_ANDAMENTO"] = "em_andamento";
    StatusProcesso["AGUARDANDO_DOCS"] = "aguardando_docs";
    StatusProcesso["AGUARDANDO_CIDADAO"] = "aguardando_cidadao";
    StatusProcesso["VENCIDO"] = "vencido";
    StatusProcesso["APROVADO"] = "aprovado";
    StatusProcesso["REJEITADO"] = "rejeitado";
    StatusProcesso["FINALIZADO"] = "finalizado";
})(StatusProcesso || (StatusProcesso = {}));
// ---------------------------------------------------------------------------
// NivelAcesso
// ---------------------------------------------------------------------------
export var NivelAcesso;
(function (NivelAcesso) {
    NivelAcesso[NivelAcesso["ADMINISTRADOR"] = 1] = "ADMINISTRADOR";
    NivelAcesso[NivelAcesso["GESTOR_GERAL"] = 2] = "GESTOR_GERAL";
    NivelAcesso[NivelAcesso["GESTOR_CATEGORIA"] = 3] = "GESTOR_CATEGORIA";
    NivelAcesso[NivelAcesso["GESTOR_UNIDADE"] = 4] = "GESTOR_UNIDADE";
    NivelAcesso[NivelAcesso["ANALISTA"] = 5] = "ANALISTA";
    NivelAcesso[NivelAcesso["INSPETOR"] = 6] = "INSPETOR";
    NivelAcesso[NivelAcesso["VISUALIZADOR"] = 7] = "VISUALIZADOR";
})(NivelAcesso || (NivelAcesso = {}));
// ---------------------------------------------------------------------------
// Permissao
// ---------------------------------------------------------------------------
export var Permissao;
(function (Permissao) {
    Permissao["VISUALIZAR"] = "visualizar";
    Permissao["EDITAR"] = "editar";
    Permissao["MOVER_ETAPA"] = "mover_etapa";
    Permissao["REJEITAR"] = "rejeitar";
    Permissao["SOLICITAR_DOCUMENTOS"] = "solicitar_documentos";
    Permissao["OBSERVACAO_PUBLICA"] = "observacao_publica";
    Permissao["OBSERVACAO_INTERNA"] = "observacao_interna";
    Permissao["ACESSAR_RELATORIOS"] = "acessar_relatorios";
    Permissao["GERENCIAR_USUARIOS"] = "gerenciar_usuarios";
    Permissao["CONFIGURAR_FLUXOS"] = "configurar_fluxos";
    Permissao["ACESSAR_AUDITORIA"] = "acessar_auditoria";
    Permissao["ATRIBUIR"] = "atribuir";
    Permissao["APROVAR"] = "aprovar";
    Permissao["GERENCIAR_TAREFAS"] = "gerenciar_tarefas";
})(Permissao || (Permissao = {}));
// ---------------------------------------------------------------------------
// StatusTarefa — status de acompanhamento de Tarefa/Atribuição (Req. 27)
// ---------------------------------------------------------------------------
export var StatusTarefa;
(function (StatusTarefa) {
    StatusTarefa["PENDENTE"] = "pendente";
    StatusTarefa["EM_ANDAMENTO"] = "em_andamento";
    StatusTarefa["CONCLUIDA"] = "concluida";
})(StatusTarefa || (StatusTarefa = {}));
// ---------------------------------------------------------------------------
// TipoCampo — form field types
// ---------------------------------------------------------------------------
export var TipoCampo;
(function (TipoCampo) {
    TipoCampo["TEXTO_CURTO"] = "texto_curto";
    TipoCampo["TEXTO_LONGO"] = "texto_longo";
    TipoCampo["NUMERO"] = "numero";
    TipoCampo["DATA"] = "data";
    TipoCampo["SELECAO_UNICA"] = "selecao_unica";
    TipoCampo["SELECAO_MULTIPLA"] = "selecao_multipla";
    TipoCampo["UPLOAD"] = "upload";
    TipoCampo["CPF"] = "cpf";
})(TipoCampo || (TipoCampo = {}));
// ---------------------------------------------------------------------------
// TipoEvento — notification event types
// ---------------------------------------------------------------------------
export var TipoEvento;
(function (TipoEvento) {
    TipoEvento["CRIACAO_PROCESSO"] = "criacao_processo";
    TipoEvento["MOVIMENTACAO_ETAPA"] = "movimentacao_etapa";
    TipoEvento["SOLICITACAO_DOCUMENTOS"] = "solicitacao_documentos";
    TipoEvento["APROVACAO"] = "aprovacao";
    TipoEvento["REJEICAO"] = "rejeicao";
    TipoEvento["NOVA_MENSAGEM"] = "nova_mensagem";
    TipoEvento["VENCIMENTO_PRAZO"] = "vencimento_prazo";
    TipoEvento["ATRIBUICAO"] = "atribuicao";
    // Tarefa (Req. 27 — NOVOS eventos)
    TipoEvento["TAREFA_ATRIBUIDA"] = "tarefa_atribuida";
    TipoEvento["TAREFA_PROXIMA_VENCIMENTO"] = "tarefa_proxima_vencimento";
    TipoEvento["TAREFA_VENCIDA"] = "tarefa_vencida";
})(TipoEvento || (TipoEvento = {}));
// ---------------------------------------------------------------------------
// CanalNotificacao
// ---------------------------------------------------------------------------
export var CanalNotificacao;
(function (CanalNotificacao) {
    CanalNotificacao["EMAIL"] = "email";
    CanalNotificacao["SMS"] = "sms";
    CanalNotificacao["PAINEL"] = "painel";
    CanalNotificacao["PUSH"] = "push";
})(CanalNotificacao || (CanalNotificacao = {}));
// ---------------------------------------------------------------------------
// ModoAtribuicao
// ---------------------------------------------------------------------------
export var ModoAtribuicao;
(function (ModoAtribuicao) {
    ModoAtribuicao["AUTOMATICO"] = "automatico";
    ModoAtribuicao["MANUAL"] = "manual";
    ModoAtribuicao["FILA_GERAL"] = "fila_geral";
})(ModoAtribuicao || (ModoAtribuicao = {}));
// ---------------------------------------------------------------------------
// ErrorCodes
// ---------------------------------------------------------------------------
export const ErrorCodes = {
    // Auth
    INVALID_CREDENTIALS: 'AUTH_001',
    ACCOUNT_LOCKED: 'AUTH_002',
    ACCOUNT_NOT_ACTIVATED: 'AUTH_003',
    TOKEN_EXPIRED: 'AUTH_004',
    INSUFFICIENT_PERMISSIONS: 'AUTH_005',
    // Validação
    VALIDATION_ERROR: 'VAL_001',
    CPF_DUPLICADO: 'VAL_002',
    CPF_INVALIDO: 'VAL_003',
    CAMPO_OBRIGATORIO: 'VAL_004',
    FORMATO_INVALIDO: 'VAL_005',
    // Processo
    PROCESSO_NAO_ENCONTRADO: 'PROC_001',
    PROCESSO_ACESSO_NEGADO: 'PROC_002',
    DOCUMENTOS_PENDENTES: 'PROC_003',
    PROCESSO_ENCERRADO: 'PROC_004',
    // Arquivo
    ARQUIVO_FORMATO_INVALIDO: 'ARQ_001',
    ARQUIVO_MUITO_GRANDE: 'ARQ_002',
    LIMITE_ARQUIVOS: 'ARQ_003',
    // Tarefa (Req. 27 — Organizador de Tarefas da Equipe)
    TAREFA_NAO_ENCONTRADA: 'TAR_001',
    TAREFA_PRAZO_PASSADO: 'TAR_002',
    TAREFA_SEM_DESTINATARIO: 'TAR_003',
    // PDF (Req. 26 — Geração de PDF Consolidado do Processo)
    PDF_GERACAO_FALHA: 'PDF_001',
    // Sistema
    AUDITORIA_FALHA: 'SYS_001',
    SERVICO_INDISPONIVEL: 'SYS_002',
};
//# sourceMappingURL=index.js.map