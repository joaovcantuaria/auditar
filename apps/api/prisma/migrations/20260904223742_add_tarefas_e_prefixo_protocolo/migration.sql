-- AlterTable
ALTER TABLE "Categoria" ADD COLUMN     "prefixoProtocolo" VARCHAR(5);

-- AlterTable
ALTER TABLE "Unidade" ADD COLUMN     "prefixoProtocolo" VARCHAR(5);

-- CreateTable
CREATE TABLE "Tarefa" (
    "id" TEXT NOT NULL,
    "titulo" VARCHAR(150) NOT NULL,
    "descricao" VARCHAR(2000),
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "prioridade" INTEGER,
    "criadoPorId" TEXT NOT NULL,
    "processoId" TEXT,
    "prazo" TIMESTAMP(3) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tarefa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TarefaAtribuicao" (
    "id" TEXT NOT NULL,
    "tarefaId" TEXT NOT NULL,
    "servidorId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "notificadoProximidade" BOOLEAN NOT NULL DEFAULT false,
    "notificadoVencida" BOOLEAN NOT NULL DEFAULT false,
    "concluidaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TarefaAtribuicao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Tarefa_criadoPorId_idx" ON "Tarefa"("criadoPorId");

-- CreateIndex
CREATE INDEX "Tarefa_processoId_idx" ON "Tarefa"("processoId");

-- CreateIndex
CREATE INDEX "Tarefa_prazo_idx" ON "Tarefa"("prazo");

-- CreateIndex
CREATE INDEX "TarefaAtribuicao_servidorId_idx" ON "TarefaAtribuicao"("servidorId");

-- CreateIndex
CREATE INDEX "TarefaAtribuicao_status_idx" ON "TarefaAtribuicao"("status");

-- CreateIndex
CREATE INDEX "TarefaAtribuicao_tarefaId_idx" ON "TarefaAtribuicao"("tarefaId");

-- CreateIndex
CREATE UNIQUE INDEX "TarefaAtribuicao_tarefaId_servidorId_key" ON "TarefaAtribuicao"("tarefaId", "servidorId");

-- AddForeignKey
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Servidor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TarefaAtribuicao" ADD CONSTRAINT "TarefaAtribuicao_tarefaId_fkey" FOREIGN KEY ("tarefaId") REFERENCES "Tarefa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TarefaAtribuicao" ADD CONSTRAINT "TarefaAtribuicao_servidorId_fkey" FOREIGN KEY ("servidorId") REFERENCES "Servidor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
