-- CreateTable
CREATE TABLE "Cidadao" (
    "id" TEXT NOT NULL,
    "nome" VARCHAR(150) NOT NULL,
    "cpf" CHAR(11) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "telefone" VARCHAR(11) NOT NULL,
    "logradouro" VARCHAR(200) NOT NULL,
    "numero" VARCHAR(20) NOT NULL,
    "cep" CHAR(8) NOT NULL,
    "cidade" VARCHAR(100) NOT NULL,
    "estado" CHAR(2) NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "emailConfirmado" BOOLEAN NOT NULL DEFAULT false,
    "tokenAtivacao" TEXT,
    "tokenAtivacaoExpira" TIMESTAMP(3),
    "tentativasLogin" INTEGER NOT NULL DEFAULT 0,
    "bloqueadoAte" TIMESTAMP(3),
    "doisFatoresAtivo" BOOLEAN NOT NULL DEFAULT false,
    "doisFatoresCanal" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cidadao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Servidor" (
    "id" TEXT NOT NULL,
    "nome" VARCHAR(150) NOT NULL,
    "cpf" CHAR(11) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "telefone" VARCHAR(11),
    "senhaHash" TEXT NOT NULL,
    "nivelAcesso" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "senhaTemporaria" BOOLEAN NOT NULL DEFAULT true,
    "tentativasLogin" INTEGER NOT NULL DEFAULT 0,
    "bloqueadoAte" TIMESTAMP(3),
    "unidadeId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Servidor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermissaoServidor" (
    "id" TEXT NOT NULL,
    "servidorId" TEXT NOT NULL,
    "permissao" TEXT NOT NULL,
    "concedida" BOOLEAN NOT NULL,

    CONSTRAINT "PermissaoServidor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unidade" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "secretaria" TEXT NOT NULL,
    "endereco" TEXT,
    "telefone" TEXT,
    "horarioFuncionamento" TEXT,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "modoAtribuicao" TEXT NOT NULL DEFAULT 'manual',
    "gestorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Unidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Categoria" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "icone" TEXT,
    "cor" TEXT,
    "secretaria" TEXT,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "gestorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Categoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipoProcesso" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "prazoTotalDiasUteis" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "categoriaId" TEXT NOT NULL,
    "fluxoId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TipoProcesso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipoProcessoUnidade" (
    "tipoProcessoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,

    CONSTRAINT "TipoProcessoUnidade_pkey" PRIMARY KEY ("tipoProcessoId","unidadeId")
);

-- CreateTable
CREATE TABLE "Fluxo" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoPorId" TEXT NOT NULL,

    CONSTRAINT "Fluxo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Etapa" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "prazosDiasUteis" INTEGER NOT NULL,
    "ordem" INTEGER NOT NULL,
    "fluxoId" TEXT NOT NULL,
    "servidorPadraoId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Etapa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Automacao" (
    "id" TEXT NOT NULL,
    "etapaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "payload" TEXT NOT NULL,

    CONSTRAINT "Automacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormularioDinamico" (
    "id" TEXT NOT NULL,
    "tipoProcessoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoPorId" TEXT NOT NULL,

    CONSTRAINT "FormularioDinamico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampoFormulario" (
    "id" TEXT NOT NULL,
    "formularioId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "rotulo" TEXT NOT NULL,
    "descricaoAuxiliar" TEXT,
    "obrigatorio" BOOLEAN NOT NULL,
    "validacao" TEXT,
    "valorPadrao" TEXT,
    "ordem" INTEGER NOT NULL,
    "opcoes" JSONB,

    CONSTRAINT "CampoFormulario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Processo" (
    "id" TEXT NOT NULL,
    "protocolo" VARCHAR(10) NOT NULL,
    "status" TEXT NOT NULL,
    "prioridade" INTEGER NOT NULL DEFAULT 0,
    "cidadaoId" TEXT NOT NULL,
    "tipoProcessoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "servidorResponsavelId" TEXT,
    "etapaAtualId" TEXT,
    "fluxoVersaoId" TEXT NOT NULL,
    "abertoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prazoFinal" TIMESTAMP(3) NOT NULL,
    "encerradoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Processo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RespostaFormulario" (
    "id" TEXT NOT NULL,
    "processoId" TEXT NOT NULL,
    "campoId" TEXT NOT NULL,
    "valor" TEXT NOT NULL,

    CONSTRAINT "RespostaFormulario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimentacaoProcesso" (
    "id" TEXT NOT NULL,
    "processoId" TEXT NOT NULL,
    "etapaOrigemId" TEXT,
    "etapaDestinoId" TEXT,
    "servidorId" TEXT NOT NULL,
    "observacao" TEXT,
    "tipoObservacao" TEXT,
    "realizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimentacaoProcesso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Documento" (
    "id" TEXT NOT NULL,
    "processoId" TEXT NOT NULL,
    "nomeOriginal" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "tamanhoBytes" INTEGER NOT NULL,
    "caminhoStorage" TEXT NOT NULL,
    "enviadoPorCidadao" BOOLEAN NOT NULL,
    "enviadoPorId" TEXT NOT NULL,
    "enviadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Documento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mensagem" (
    "id" TEXT NOT NULL,
    "processoId" TEXT NOT NULL,
    "canal" TEXT NOT NULL,
    "conteudo" TEXT NOT NULL,
    "remetenteCidadaoId" TEXT,
    "remetenteServidorId" TEXT,
    "destinatarioServidorId" TEXT,
    "caminhoAnexo" TEXT,
    "enviadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lida" TIMESTAMP(3),

    CONSTRAINT "Mensagem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notificacao" (
    "id" TEXT NOT NULL,
    "cidadaoId" TEXT,
    "servidorId" TEXT,
    "tipoEvento" TEXT NOT NULL,
    "canal" TEXT NOT NULL,
    "conteudo" TEXT NOT NULL,
    "entregue" BOOLEAN NOT NULL DEFAULT false,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "agendadaPara" TIMESTAMP(3),
    "entregueEm" TIMESTAMP(3),
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notificacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreferenciaNotificacao" (
    "id" TEXT NOT NULL,
    "cidadaoId" TEXT NOT NULL,
    "tipoEvento" TEXT NOT NULL,
    "canais" TEXT[],
    "inicioSilencio" TEXT,
    "fimSilencio" TEXT,

    CONSTRAINT "PreferenciaNotificacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditoriaLog" (
    "id" TEXT NOT NULL,
    "ator" TEXT NOT NULL,
    "atorCidadaoId" TEXT,
    "atorServidorId" TEXT,
    "enderecoIp" TEXT NOT NULL,
    "tipoAcao" TEXT NOT NULL,
    "modulo" TEXT NOT NULL,
    "objetoId" TEXT,
    "tipoObjeto" TEXT,
    "valorAnterior" VARCHAR(1000),
    "valorPosterior" VARCHAR(1000),
    "realizadaEmUtc" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditoriaLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcessoHistorico" (
    "id" TEXT NOT NULL,
    "cidadaoId" TEXT,
    "servidorId" TEXT,
    "enderecoIp" TEXT NOT NULL,
    "acessadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcessoHistorico_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Cidadao_cpf_key" ON "Cidadao"("cpf");

-- CreateIndex
CREATE UNIQUE INDEX "Cidadao_email_key" ON "Cidadao"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Servidor_cpf_key" ON "Servidor"("cpf");

-- CreateIndex
CREATE UNIQUE INDEX "Servidor_email_key" ON "Servidor"("email");

-- CreateIndex
CREATE INDEX "PermissaoServidor_servidorId_idx" ON "PermissaoServidor"("servidorId");

-- CreateIndex
CREATE INDEX "TipoProcesso_categoriaId_idx" ON "TipoProcesso"("categoriaId");

-- CreateIndex
CREATE INDEX "TipoProcessoUnidade_unidadeId_idx" ON "TipoProcessoUnidade"("unidadeId");

-- CreateIndex
CREATE INDEX "Etapa_fluxoId_idx" ON "Etapa"("fluxoId");

-- CreateIndex
CREATE INDEX "Automacao_etapaId_idx" ON "Automacao"("etapaId");

-- CreateIndex
CREATE INDEX "FormularioDinamico_tipoProcessoId_idx" ON "FormularioDinamico"("tipoProcessoId");

-- CreateIndex
CREATE INDEX "FormularioDinamico_unidadeId_idx" ON "FormularioDinamico"("unidadeId");

-- CreateIndex
CREATE INDEX "CampoFormulario_formularioId_idx" ON "CampoFormulario"("formularioId");

-- CreateIndex
CREATE UNIQUE INDEX "Processo_protocolo_key" ON "Processo"("protocolo");

-- CreateIndex
CREATE INDEX "Processo_status_idx" ON "Processo"("status");

-- CreateIndex
CREATE INDEX "Processo_unidadeId_idx" ON "Processo"("unidadeId");

-- CreateIndex
CREATE INDEX "Processo_servidorResponsavelId_idx" ON "Processo"("servidorResponsavelId");

-- CreateIndex
CREATE INDEX "Processo_cidadaoId_idx" ON "Processo"("cidadaoId");

-- CreateIndex
CREATE INDEX "Processo_protocolo_idx" ON "Processo"("protocolo");

-- CreateIndex
CREATE INDEX "RespostaFormulario_processoId_idx" ON "RespostaFormulario"("processoId");

-- CreateIndex
CREATE INDEX "MovimentacaoProcesso_processoId_idx" ON "MovimentacaoProcesso"("processoId");

-- CreateIndex
CREATE INDEX "MovimentacaoProcesso_servidorId_idx" ON "MovimentacaoProcesso"("servidorId");

-- CreateIndex
CREATE INDEX "Documento_processoId_idx" ON "Documento"("processoId");

-- CreateIndex
CREATE INDEX "Mensagem_processoId_idx" ON "Mensagem"("processoId");

-- CreateIndex
CREATE INDEX "Mensagem_canal_idx" ON "Mensagem"("canal");

-- CreateIndex
CREATE INDEX "Notificacao_cidadaoId_idx" ON "Notificacao"("cidadaoId");

-- CreateIndex
CREATE INDEX "Notificacao_servidorId_idx" ON "Notificacao"("servidorId");

-- CreateIndex
CREATE INDEX "Notificacao_entregue_idx" ON "Notificacao"("entregue");

-- CreateIndex
CREATE INDEX "PreferenciaNotificacao_cidadaoId_idx" ON "PreferenciaNotificacao"("cidadaoId");

-- CreateIndex
CREATE INDEX "AuditoriaLog_tipoAcao_idx" ON "AuditoriaLog"("tipoAcao");

-- CreateIndex
CREATE INDEX "AuditoriaLog_atorCidadaoId_idx" ON "AuditoriaLog"("atorCidadaoId");

-- CreateIndex
CREATE INDEX "AuditoriaLog_atorServidorId_idx" ON "AuditoriaLog"("atorServidorId");

-- CreateIndex
CREATE INDEX "AuditoriaLog_objetoId_idx" ON "AuditoriaLog"("objetoId");

-- CreateIndex
CREATE INDEX "AuditoriaLog_realizadaEmUtc_idx" ON "AuditoriaLog"("realizadaEmUtc");

-- CreateIndex
CREATE INDEX "AcessoHistorico_cidadaoId_idx" ON "AcessoHistorico"("cidadaoId");

-- CreateIndex
CREATE INDEX "AcessoHistorico_servidorId_idx" ON "AcessoHistorico"("servidorId");

-- AddForeignKey
ALTER TABLE "Servidor" ADD CONSTRAINT "Servidor_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "Unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissaoServidor" ADD CONSTRAINT "PermissaoServidor_servidorId_fkey" FOREIGN KEY ("servidorId") REFERENCES "Servidor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipoProcesso" ADD CONSTRAINT "TipoProcesso_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipoProcesso" ADD CONSTRAINT "TipoProcesso_fluxoId_fkey" FOREIGN KEY ("fluxoId") REFERENCES "Fluxo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipoProcessoUnidade" ADD CONSTRAINT "TipoProcessoUnidade_tipoProcessoId_fkey" FOREIGN KEY ("tipoProcessoId") REFERENCES "TipoProcesso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipoProcessoUnidade" ADD CONSTRAINT "TipoProcessoUnidade_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "Unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Etapa" ADD CONSTRAINT "Etapa_fluxoId_fkey" FOREIGN KEY ("fluxoId") REFERENCES "Fluxo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Automacao" ADD CONSTRAINT "Automacao_etapaId_fkey" FOREIGN KEY ("etapaId") REFERENCES "Etapa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormularioDinamico" ADD CONSTRAINT "FormularioDinamico_tipoProcessoId_fkey" FOREIGN KEY ("tipoProcessoId") REFERENCES "TipoProcesso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormularioDinamico" ADD CONSTRAINT "FormularioDinamico_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "Unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampoFormulario" ADD CONSTRAINT "CampoFormulario_formularioId_fkey" FOREIGN KEY ("formularioId") REFERENCES "FormularioDinamico"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Processo" ADD CONSTRAINT "Processo_cidadaoId_fkey" FOREIGN KEY ("cidadaoId") REFERENCES "Cidadao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Processo" ADD CONSTRAINT "Processo_tipoProcessoId_fkey" FOREIGN KEY ("tipoProcessoId") REFERENCES "TipoProcesso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Processo" ADD CONSTRAINT "Processo_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "Unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Processo" ADD CONSTRAINT "Processo_servidorResponsavelId_fkey" FOREIGN KEY ("servidorResponsavelId") REFERENCES "Servidor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Processo" ADD CONSTRAINT "Processo_etapaAtualId_fkey" FOREIGN KEY ("etapaAtualId") REFERENCES "Etapa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Processo" ADD CONSTRAINT "Processo_fluxoVersaoId_fkey" FOREIGN KEY ("fluxoVersaoId") REFERENCES "Fluxo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RespostaFormulario" ADD CONSTRAINT "RespostaFormulario_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentacaoProcesso" ADD CONSTRAINT "MovimentacaoProcesso_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentacaoProcesso" ADD CONSTRAINT "MovimentacaoProcesso_servidorId_fkey" FOREIGN KEY ("servidorId") REFERENCES "Servidor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mensagem" ADD CONSTRAINT "Mensagem_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mensagem" ADD CONSTRAINT "Mensagem_remetenteCidadaoId_fkey" FOREIGN KEY ("remetenteCidadaoId") REFERENCES "Cidadao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mensagem" ADD CONSTRAINT "Mensagem_remetenteServidorId_fkey" FOREIGN KEY ("remetenteServidorId") REFERENCES "Servidor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notificacao" ADD CONSTRAINT "Notificacao_cidadaoId_fkey" FOREIGN KEY ("cidadaoId") REFERENCES "Cidadao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreferenciaNotificacao" ADD CONSTRAINT "PreferenciaNotificacao_cidadaoId_fkey" FOREIGN KEY ("cidadaoId") REFERENCES "Cidadao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcessoHistorico" ADD CONSTRAINT "AcessoHistorico_cidadaoId_fkey" FOREIGN KEY ("cidadaoId") REFERENCES "Cidadao"("id") ON DELETE SET NULL ON UPDATE CASCADE;
