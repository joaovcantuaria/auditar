// Barrel do módulo de Processos.
// Exporta os artefatos da listagem/busca administrativa (tarefa 7.4).
// Os artefatos de criação pelo Cidadão (tarefa 7.1) — quando existirem —
// devem ser reexportados aqui também, sem clobber deste arquivo.
export * from './processos.admin.service.js';
export * from './processos.admin.controller.js';
export * from './processos.abertura.controller.js';
export { processosAdminRouter } from './processos.admin.router.js';

// Upload/Download de Documentos via MinIO (tarefa 7.2).
export * from './documentos.service.js';
export * from './documentos.controller.js';
export { documentosRouter } from './documentos.router.js';

// Criação e listagem de Processos pelo Cidadão (tarefa 7.1).
export * from './processos.schema.js';
export * from './processos.service.js';
export * from './processos.controller.js';
export { processosCidadaoRouter } from './processos.router.js';

// Canal de mensagens público — envio (tarefa 8.1). A listagem (GET) deste
// canal é responsabilidade de `processos.detalhe.*` (tarefa 7.3).
export * from './mensagens.publico.service.js';
export * from './mensagens.publico.controller.js';
export { mensagensCidadaoRouter, mensagensServidorRouter } from './mensagens.publico.router.js';

// Consulta e acompanhamento de Processo pelo Cidadão (tarefa 7.3).
export * from './processos.detalhe.service.js';
export * from './processos.detalhe.controller.js';
export { processosDetalheRouter } from './processos.detalhe.router.js';

// Canal de mensagens internas — Servidor ↔ Servidor (tarefa 8.2).
export * from './mensagens.interno.schema.js';
export * from './mensagens.interno.service.js';
export * from './mensagens.interno.controller.js';
export { mensagensInternoRouter } from './mensagens.interno.router.js';

// Tramitação de Processo pelo Servidor (tarefa 7.6).
export * from './processos.tramitacao.schema.js';
export * from './processos.tramitacao.service.js';
export * from './processos.tramitacao.controller.js';
export { processosTramitacaoRouter } from './processos.tramitacao.router.js';

// Geração de PDF Consolidado do Processo (tarefa 22, Req. 26). A rota
// `GET /:id/pdf` vive no `processosTramitacaoRouter`; aqui expomos o serviço e
// os helpers de montagem/renderização de conteúdo.
export * from './processos.pdf.service.js';
export * from './pdf/processoPdfContent.js';
export * from './pdf/processoPdfRenderer.js';

// Atribuição e reatribuição de Processos (tarefa 7.7).
export * from './processos.atribuicao.schema.js';
export * from './processos.atribuicao.service.js';
export * from './processos.atribuicao.controller.js';
export { processosAtribuicaoRouter } from './processos.atribuicao.router.js';
