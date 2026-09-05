// Constants and enums for the Auditar system

// ---------------------------------------------------------------------------
// StatusProcesso
// ---------------------------------------------------------------------------

export enum StatusProcesso {
  ABERTO              = 'aberto',
  EM_ANDAMENTO        = 'em_andamento',
  AGUARDANDO_DOCS     = 'aguardando_docs',
  AGUARDANDO_CIDADAO  = 'aguardando_cidadao',
  VENCIDO             = 'vencido',
  APROVADO            = 'aprovado',
  REJEITADO           = 'rejeitado',
  FINALIZADO          = 'finalizado',
}

// ---------------------------------------------------------------------------
// NivelAcesso
// ---------------------------------------------------------------------------

export enum NivelAcesso {
  ADMINISTRADOR    = 1,
  GESTOR_GERAL     = 2,
  GESTOR_CATEGORIA = 3,
  GESTOR_UNIDADE   = 4,
  ANALISTA         = 5,
  INSPETOR         = 6,
  VISUALIZADOR     = 7,
}

// ---------------------------------------------------------------------------
// Permissao
// ---------------------------------------------------------------------------

export enum Permissao {
  VISUALIZAR           = 'visualizar',
  EDITAR               = 'editar',
  MOVER_ETAPA          = 'mover_etapa',
  REJEITAR             = 'rejeitar',
  SOLICITAR_DOCUMENTOS = 'solicitar_documentos',
  OBSERVACAO_PUBLICA   = 'observacao_publica',
  OBSERVACAO_INTERNA   = 'observacao_interna',
  ACESSAR_RELATORIOS   = 'acessar_relatorios',
  GERENCIAR_USUARIOS   = 'gerenciar_usuarios',
  CONFIGURAR_FLUXOS    = 'configurar_fluxos',
  ACESSAR_AUDITORIA    = 'acessar_auditoria',
  ATRIBUIR             = 'atribuir',
  APROVAR              = 'aprovar',
  GERENCIAR_TAREFAS    = 'gerenciar_tarefas', // NOVO (decisão G) — coordenação do Organizador de Tarefas
}

// ---------------------------------------------------------------------------
// StatusTarefa — status de acompanhamento de Tarefa/Atribuição (Req. 27)
// ---------------------------------------------------------------------------

export enum StatusTarefa {
  PENDENTE     = 'pendente',
  EM_ANDAMENTO = 'em_andamento',
  CONCLUIDA    = 'concluida',
}

// ---------------------------------------------------------------------------
// TipoCampo — form field types
// ---------------------------------------------------------------------------

export enum TipoCampo {
  TEXTO_CURTO       = 'texto_curto',
  TEXTO_LONGO       = 'texto_longo',
  NUMERO            = 'numero',
  DATA              = 'data',
  SELECAO_UNICA     = 'selecao_unica',
  SELECAO_MULTIPLA  = 'selecao_multipla',
  UPLOAD            = 'upload',
  CPF               = 'cpf',
}

// ---------------------------------------------------------------------------
// TipoEvento — notification event types
// ---------------------------------------------------------------------------

export enum TipoEvento {
  CRIACAO_PROCESSO      = 'criacao_processo',
  MOVIMENTACAO_ETAPA    = 'movimentacao_etapa',
  SOLICITACAO_DOCUMENTOS = 'solicitacao_documentos',
  APROVACAO             = 'aprovacao',
  REJEICAO              = 'rejeicao',
  NOVA_MENSAGEM         = 'nova_mensagem',
  VENCIMENTO_PRAZO      = 'vencimento_prazo',
  ATRIBUICAO            = 'atribuicao',
  // Tarefa (Req. 27 — NOVOS eventos)
  TAREFA_ATRIBUIDA          = 'tarefa_atribuida',
  TAREFA_PROXIMA_VENCIMENTO = 'tarefa_proxima_vencimento',
  TAREFA_VENCIDA            = 'tarefa_vencida',
}

// ---------------------------------------------------------------------------
// CanalNotificacao
// ---------------------------------------------------------------------------

export enum CanalNotificacao {
  EMAIL  = 'email',
  SMS    = 'sms',
  PAINEL = 'painel',
  PUSH   = 'push',
}

// ---------------------------------------------------------------------------
// ModoAtribuicao
// ---------------------------------------------------------------------------

export enum ModoAtribuicao {
  AUTOMATICO  = 'automatico',
  MANUAL      = 'manual',
  FILA_GERAL  = 'fila_geral',
}

// ---------------------------------------------------------------------------
// ErrorCodes
// ---------------------------------------------------------------------------

export const ErrorCodes = {
  // Auth
  INVALID_CREDENTIALS:      'AUTH_001',
  ACCOUNT_LOCKED:           'AUTH_002',
  ACCOUNT_NOT_ACTIVATED:    'AUTH_003',
  TOKEN_EXPIRED:            'AUTH_004',
  INSUFFICIENT_PERMISSIONS: 'AUTH_005',

  // Validação
  VALIDATION_ERROR:         'VAL_001',
  CPF_DUPLICADO:            'VAL_002',
  CPF_INVALIDO:             'VAL_003',
  CAMPO_OBRIGATORIO:        'VAL_004',
  FORMATO_INVALIDO:         'VAL_005',

  // Processo
  PROCESSO_NAO_ENCONTRADO:  'PROC_001',
  PROCESSO_ACESSO_NEGADO:   'PROC_002',
  DOCUMENTOS_PENDENTES:     'PROC_003',
  PROCESSO_ENCERRADO:       'PROC_004',

  // Arquivo
  ARQUIVO_FORMATO_INVALIDO: 'ARQ_001',
  ARQUIVO_MUITO_GRANDE:     'ARQ_002',
  LIMITE_ARQUIVOS:          'ARQ_003',

  // Tarefa (Req. 27 — Organizador de Tarefas da Equipe)
  TAREFA_NAO_ENCONTRADA:    'TAR_001',
  TAREFA_PRAZO_PASSADO:     'TAR_002',
  TAREFA_SEM_DESTINATARIO:  'TAR_003',

  // PDF (Req. 26 — Geração de PDF Consolidado do Processo)
  PDF_GERACAO_FALHA:        'PDF_001',

  // Sistema
  AUDITORIA_FALHA:          'SYS_001',
  SERVICO_INDISPONIVEL:     'SYS_002',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
