# Implementation Plan: Auditar — Sistema de Gestão de Processos Administrativos Municipais

## Overview

Este plano converte o design técnico do sistema **Auditar** em tarefas de implementação incrementais. A ordem segue uma progressão natural de dependências: infraestrutura → fundações de backend → autenticação → domínios principais → funcionalidades avançadas → frontend portal → frontend painel. Cada tarefa referencia os requisitos correspondentes e as propriedades de corretude quando aplicável.

**Stack:** React 18 + TypeScript + Vite + TailwindCSS + React Query + Zustand + Socket.io-client | Node.js + Express + TypeScript + Prisma + PostgreSQL + Redis + BullMQ + Socket.io | MinIO | Docker Compose

---

## Tasks

---

### 1. Configuração de Infraestrutura e Monorepo

- [x] 1.1 Inicializar estrutura do monorepo com npm workspaces
  - Criar `package.json` raiz com workspaces: `apps/web`, `apps/api`, `packages/shared`
  - Configurar `tsconfig.json` base e por pacote com paths de referência cruzada
  - Criar scripts raiz: `dev`, `build`, `test`, `lint`
  - _Requirements: Arquitetura geral_

- [x] 1.2 Configurar Docker Compose com todos os serviços de infraestrutura
  - Definir serviços: `postgres` (15-alpine), `redis` (7-alpine), `minio` (latest)
  - Configurar volumes persistentes, variáveis de ambiente e healthchecks
  - Criar `docker-compose.yml` e `.env.example` documentando todas as variáveis
  - _Requirements: Req. 22 (disponibilidade e desempenho)_

- [x] 1.3 Criar pacote `packages/shared` com tipos, schemas e constantes
  - Configurar build com `tsup` para CommonJS e ESM
  - Criar `src/types/`: interfaces `Cidadao`, `Servidor`, `Processo`, `Unidade`, `Categoria`, `TipoProcesso`, `Fluxo`, `Etapa`, `Formulario`, `CampoFormulario`, `Mensagem`, `Notificacao`, `AuditoriaLog`
  - Criar `src/constants/`: `StatusProcesso` enum, `NivelAcesso` enum, `Permissao` enum, `TipoCampo` enum, `ErrorCodes`
  - Criar `src/schemas/`: schemas Zod para cada entidade principal (validação isomórfica)
  - Criar `src/utils/`: `cpfValidator`, `protocoloFormat`, `diasUteis`
  - _Requirements: Req. 1.2, 4.8, 8.2, 16.1_

- [x]* 1.4 Escrever property test para validação de CPF (Property 1)
  - Instalar `fast-check` no `packages/shared`
  - Implementar `validarCPF(cpf: string): boolean` conforme algoritmo da Receita Federal
  - **Property 1: Validação de CPF** — *For any* string de 11 dígitos, o validador deve aceitar exatamente aquelas com dígitos verificadores corretos e rejeitar todas as demais
  - **Validates: Requirements 1.2, 21.1**

- [x] 1.5 Configurar aplicação Express base (`apps/api`)
  - Instalar dependências: `express`, `helmet`, `cors`, `express-rate-limit`, `zod`, `prisma`, `@prisma/client`, `jsonwebtoken`, `bcryptjs`, `ioredis`, `bullmq`, `socket.io`, `multer`, `minio`, `nodemailer`
  - Instalar devDependencies: `typescript`, `vitest`, `@vitest/coverage-v8`, `fast-check`, `tsx`, `tsup`
  - Criar `src/app.ts` com middleware stack completo: `helmet()`, `cors()`, `rateLimiter`, `express.json({ limit: '1mb' })`, `sanitizeMiddleware`, `csrfMiddleware`
  - Criar `src/config/`: `env.ts` (validação com Zod), `database.ts` (Prisma client singleton), `redis.ts` (ioredis singleton), `minio.ts`, `bullmq.ts`
  - _Requirements: Req. 20.1, 20.3, 20.4, 20.5_

- [x] 1.6 Definir schema Prisma completo e gerar migrations iniciais
  - Criar `apps/api/prisma/schema.prisma` com todos os modelos: `Cidadao`, `Servidor`, `PermissaoServidor`, `Unidade`, `Categoria`, `TipoProcesso`, `TipoProcessoUnidade`, `Fluxo`, `Etapa`, `Automacao`, `FormularioDinamico`, `CampoFormulario`, `Processo`, `RespostaFormulario`, `MovimentacaoProcesso`, `Documento`, `Mensagem`, `Notificacao`, `PreferenciaNotificacao`, `AuditoriaLog`, `AcessoHistorico`
  - Adicionar todos os índices definidos no design (auditoria, processos, notificações)
  - Executar `prisma migrate dev --name init` para gerar migration inicial
  - _Requirements: Req. 1, 4, 5, 8, 10, 12, 13, 17, 21_

- [x] 1.7 Configurar aplicação React base (`apps/web`)
  - Criar projeto Vite + React 18 + TypeScript
  - Instalar dependências: `react-router-dom`, `@tanstack/react-query`, `zustand`, `axios`, `socket.io-client`, `react-dropzone`, `react-dnd`, `react-dnd-html5-backend`, `react-hook-form`, `zod`, `@hookform/resolvers`
  - Instalar devDependencies: `tailwindcss`, `postcss`, `autoprefixer`, `vitest`, `@vitest/coverage-v8`, `@testing-library/react`, `@testing-library/user-event`, `@axe-core/react`, `playwright`
  - Configurar `tailwind.config.ts` com design tokens: cores primárias, `headerHeight`, `sidebarWidth`, `btnMinHeight/Width`, fontes Poppins e Inter
  - Configurar `vite.config.ts` com aliases de path
  - _Requirements: Req. 19.1, 19.2, 19.3_

- [x] 1.8 Configurar framework de testes (Vitest + fast-check)
  - Criar `vitest.config.ts` em `apps/api` e `apps/web` com thresholds de cobertura (lines: 80%, functions: 80%, branches: 75%)
  - Criar `vitest.config.ts` em `packages/shared`
  - Configurar script `test:run` com flag `--run` para execução única
  - Criar helpers de teste: mock do Prisma, mock do Redis, factories de entidades
  - _Requirements: Estratégia de testes do design_

- [x] 1.9 Checkpoint — Infraestrutura base verificada
  - Garantir que `docker-compose up` sobe todos os serviços sem erros
  - Garantir que `prisma migrate dev` aplica schema sem erros
  - Garantir que `packages/shared` compila e testes passam
  - Garantir que `apps/api` e `apps/web` iniciam em modo dev

---

### 2. Middleware de Segurança e Utilitários de Backend

- [x] 2.1 Implementar middleware de autenticação JWT
  - Criar `src/middleware/auth.ts`: verificar `Authorization: Bearer <JWT>`, validar assinatura, checar blacklist no Redis (`blacklist:{jti}`)
  - Criar `src/middleware/rbac.ts`: extrair `req.user.nivel` e `req.user.permissions`, comparar com matrix de permissões do design
  - Criar `src/lib/jwt.ts`: `signToken()`, `verifyToken()`, `blacklistToken()` com TTL residual
  - Estrutura do payload JWT: `sub`, `role`, `nivel`, `permissions[]`, `jti`, `iat`, `exp`
  - _Requirements: Req. 8.3, 8.4, 8.7_

- [x] 2.2 Implementar middleware de sanitização e rate limiting
  - Criar `src/middleware/sanitize.ts`: rejeitar entradas com padrões SQL injection, XSS e caracteres de controle (lista de padrões proibidos)
  - Criar `src/middleware/rateLimiter.ts`: janela deslizante de 60s via Redis `INCR` + `EXPIRE`, limite 100 req/min por IP, resposta com `Retry-After`
  - Criar `src/middleware/csrf.ts`: validar header `X-CSRF-Token` em métodos POST/PUT/PATCH/DELETE
  - _Requirements: Req. 20.3, 20.4, 20.5, 20.9_

- [x]* 2.3 Escrever property test para rejeição de entradas com padrões de injeção (Property 8)
  - **Property 8: Rejeição de Entradas com Padrões de Injeção** — *For any* entrada contendo padrões de SQL injection, scripts XSS ou caracteres de controle, o middleware deve rejeitar a requisição e não persistir nenhum dado parcial
  - **Validates: Requirements 20.3, 20.9**

- [x] 2.4 Implementar utilitários de backend críticos
  - Criar `src/utils/cpf.ts`: `validarCPF()` (algoritmo Receita Federal), `formatarCPF()`, `desformatarCPF()`
  - Criar `src/utils/protocolo.ts`: `gerarProtocolo(redis)` usando `INCR` atômico com chave `protocolo:seq:{ano}` e TTL de 2 anos
  - Criar `src/utils/diasUteis.ts`: `calcularPrazoFinal()`, `calcularDiasRestantes()`, `isDiaUtil()`
  - Criar `src/utils/paginacao.ts`: `paginar<T>(query, page, pageSize): PaginatedResult<T>`
  - _Requirements: Req. 1.2, 4.8, 15.5_

- [x]* 2.5 Escrever property test para formato e unicidade do protocolo (Property 4)
  - **Property 4: Formato e Unicidade do Protocolo** — *For any* conjunto de processos criados, todo protocolo gerado deve obedecer ao formato `AAAA-NNNNN` e nenhum par de processos distintos deve compartilhar o mesmo protocolo
  - Usar mock do Redis para testar a função `gerarProtocolo` em paralelo
  - **Validates: Requirements 4.8**

- [x] 2.6 Implementar serviço de auditoria
  - Criar `src/modules/auditoria/auditoria.service.ts`: `registrar(dto: RegistrarAuditoriaDto): Promise<void>`
  - O serviço deve enfileirar o registro na `auditoria-queue` (BullMQ) para processamento assíncrono
  - Se o enfileiramento falhar: registrar evento de falha internamente mas NÃO interromper a operação original
  - Criar `src/modules/auditoria/auditoria.worker.ts`: persistir no `AuditoriaLog` com todos os campos obrigatórios (UTC com ms, ator, IP, tipo, objetoId, valorAnterior, valorPosterior)
  - _Requirements: Req. 17.1, 17.3, 17.8_

- [x]* 2.7 Escrever property test para completude do registro de auditoria (Property 6)
  - **Property 6: Completude do Registro de Auditoria** — *For any* ação realizada por qualquer ator, o registro de auditoria correspondente deve conter todos os campos obrigatórios: data/hora UTC com ms, identificação do ator, IP, tipo de ação, objetoId e valores anterior/posterior quando aplicável
  - Gerar ações aleatórias e verificar estrutura do registro persistido
  - **Validates: Requirements 17.3**

- [x] 2.8 Configurar BullMQ — definição das filas e workers base
  - Criar `src/jobs/index.ts`: instanciar filas `notificacao-queue`, `relatorio-queue`, `auditoria-queue`, `prazo-check-queue`, `limpeza-queue` com configurações do design
  - Criar `src/jobs/notificacao.worker.ts`: estrutura base com roteamento por tipo (`email`, `sms`, `painel`, `push`), retry 3x com delay 30s, fallback para painel após 3 falhas
  - Criar `src/jobs/prazo.worker.ts`: estrutura cron (a cada 1h), buscar processos com prazo ≤3 dias úteis, etapas vencidas, fila geral há >24h
  - Criar `src/jobs/limpeza.worker.ts`: invalidar tokens expirados, anonimizar contas solicitadas há >30 dias
  - _Requirements: Req. 6.4, 6.5, 6.6, 20.6_

- [x] 2.9 Checkpoint — Middleware e utilitários verificados
  - Garantir que todos os testes de property e unitários dos utilitários passam
  - Garantir que middleware stack responde corretamente a requisições maliciosas (injeção, CSRF, rate limit)

---

### 3. Autenticação e Sessões

- [x] 3.1 Implementar cadastro e ativação de conta do Cidadão
  - Criar `src/modules/auth/auth.cidadao.router.ts`, `auth.cidadao.controller.ts`, `auth.cidadao.service.ts`
  - `POST /api/v1/auth/cidadao/registrar`: validar todos os campos (Zod schema), validar CPF (dígitos verificadores), verificar duplicidade de CPF, criar conta com `ativo: false`, gerar token de ativação único (UUID v4), enviar email de confirmação em até 60s via BullMQ, retornar 201
  - `POST /api/v1/auth/cidadao/ativar`: validar token, verificar expiração (48h), ativar conta, redirecionar para login
  - `POST /api/v1/auth/cidadao/reenviar-ativacao`: invalidar token anterior, gerar novo, enviar, controlar limite 3 reenvios/24h via Redis (`ativacao:resend:{cidadaoId}`)
  - _Requirements: Req. 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9_

- [x]* 3.2 Escrever property test para unicidade de CPF no cadastro (Property 2)
  - **Property 2: Unicidade de CPF no Cadastro** — *For any* CPF já associado a uma conta existente (ativa ou inativa), uma tentativa de cadastro com esse CPF deve ser rejeitada e o total de contas deve permanecer inalterado
  - **Validates: Requirements 1.3**

- [x] 3.3 Implementar autenticação (login/logout) do Cidadão
  - `POST /api/v1/auth/cidadao/login`: validar CPF (11 dígitos) e senha (8-128 chars), checar conta ativa, comparar `bcrypt` (cost-12), controlar tentativas no Redis (`login:attempts:{cpf}`, TTL 15min), bloquear após 5 tentativas por 15 min (`login:blocked:{cpf}`), notificar por email no bloqueio, registrar acesso em `AcessoHistorico`
  - `POST /api/v1/auth/cidadao/logout`: adicionar `jti` à blacklist Redis com TTL residual
  - Lógica de "manter conectado": exp = 7 dias se marcado, 30min de inatividade (validar no middleware)
  - _Requirements: Req. 2.1, 2.2, 2.3, 2.4, 2.7, 2.8, 2.9_

- [x]* 3.4 Escrever property test para bloqueio por tentativas consecutivas (Property 3)
  - **Property 3: Bloqueio por Tentativas Consecutivas de Login** — *For any* conta de cidadão ou servidor, após exatamente 5 tentativas consecutivas incorretas, a conta deve ser bloqueada e qualquer tentativa adicional deve ser rejeitada com indicação de bloqueio
  - Testar tanto para cidadãos quanto para servidores
  - **Validates: Requirements 2.3, 20.8**

- [x] 3.5 Implementar autenticação de dois fatores (2FA)
  - `POST /api/v1/auth/cidadao/2fa/verificar`: validar código de 6 dígitos (Redis `2fa:code:{cidadaoId}`, TTL 10min), aceitar somente se conta tiver `doisFatoresAtivo: true`
  - Falha de 2FA NÃO incrementa contador de bloqueio por senha
  - Endpoints de ativação/desativação de 2FA em `PATCH /api/v1/cidadao/conta/2fa`
  - _Requirements: Req. 2.5, 2.6_

- [x] 3.6 Implementar recuperação de senha do Cidadão
  - `POST /api/v1/auth/cidadao/recuperar-senha`: gerar token reset (UUID v4, TTL 1h), enviar por email
  - `POST /api/v1/auth/cidadao/nova-senha`: validar token, aceitar nova senha (8-64 chars), atualizar hash bcrypt, invalidar token
  - _Requirements: Req. 7.3, 7.4_

- [x] 3.7 Implementar autenticação do Servidor
  - Criar `src/modules/auth/auth.servidor.router.ts`, `auth.servidor.controller.ts`, `auth.servidor.service.ts`
  - `POST /api/v1/auth/servidor/login`: validar CPF e senha, verificar nível de acesso, carregar permissões granulares no JWT, controlar bloqueio após 5 tentativas por 30min, notificar Administrador no bloqueio, exigir troca de senha temporária no primeiro login
  - `POST /api/v1/auth/servidor/logout`: blacklist do token JWT
  - `POST /api/v1/auth/servidor/trocar-senha`: exigir senha atual + nova senha, bloquear se `senhaTemporaria: true` até troca
  - Timeout de sessão: 60min de inatividade (`WHILE` estado)
  - _Requirements: Req. 8.1, 8.3, 8.5, 8.7, 8.8, 21.3_

- [x] 3.8 Checkpoint — Autenticação verificada
  - Testes de integração: fluxo completo cadastro → ativação → login → 2FA → logout
  - Testes de integração: fluxo login servidor com senha temporária
  - Todos os property tests de auth passando

---

### 4. Gestão de Conta do Cidadão (API)

- [x] 4.1 Implementar endpoints de perfil e dados pessoais do Cidadão
  - Criar `src/modules/cidadaos/cidadaos.router.ts`, `cidadaos.controller.ts`, `cidadaos.service.ts`
  - `GET /api/v1/cidadao/conta`: retornar dados do perfil do cidadão autenticado
  - `PATCH /api/v1/cidadao/conta`: editar nome, telefone, endereço (validar campos conforme Req. 7.1); CPF é imutável
  - `POST /api/v1/cidadao/conta/alterar-email`: gerar token confirmação (UUID, TTL 24h), enviar para novo email, manter email anterior ativo
  - `POST /api/v1/cidadao/conta/confirmar-email`: validar token, atualizar email
  - `POST /api/v1/cidadao/conta/alterar-senha`: exigir senha atual (bcrypt compare), aceitar nova senha (8-64 chars)
  - `GET /api/v1/cidadao/conta/acessos`: retornar últimos 10 registros de `AcessoHistorico` em ordem decrescente
  - _Requirements: Req. 7.1, 7.2, 7.3, 7.4, 7.5, 7.8_

- [x] 4.2 Implementar exclusão de conta (LGPD)
  - `DELETE /api/v1/cidadao/conta`: verificar processos em andamento, exibir lista, exigir confirmação, registrar solicitação com data (processamento em até 15 dias úteis)
  - `LimpezaWorker`: anonimizar após 30 dias — `nome = ANONIMIZADO_{id[:8]}`, `cpf = 00000000000`, `email = anonimizado_{id}@deletado.local`, `telefone = 00000000000`
  - Preservar campos de auditoria conforme LGPD
  - _Requirements: Req. 7.6, 7.7, 20.6_

- [x] 4.3 Implementar preferências de notificação
  - `GET /api/v1/cidadao/conta/notificacoes/preferencias`: retornar preferências por tipo de evento
  - `PUT /api/v1/cidadao/conta/notificacoes/preferencias`: salvar canais por evento + horário de silêncio (início/fim), persistir em até 5s
  - _Requirements: Req. 6.3, 6.4_

---

### 5. Configurações Administrativas (Categorias, Tipos, Unidades)

- [x] 5.1 Implementar CRUD de Categorias
  - Criar `src/modules/categorias/categorias.router.ts`, `categorias.controller.ts`, `categorias.service.ts`
  - `GET /api/v1/admin/config/categorias`: listar com cache Redis `cache:categorias` TTL 10min
  - `POST /api/v1/admin/config/categorias`: criar (Administrador only), validar nome único (case-insensitive), campos obrigatórios: nome ≤100 chars
  - `PATCH /api/v1/admin/config/categorias/:id`: editar, revalidar nome único excluindo o próprio registro
  - `DELETE /api/v1/admin/config/categorias/:id`: desativar (soft delete), checar processos em andamento, exigir confirmação se houver impactados, registrar no `Módulo_de_Auditoria`
  - Invalidar cache `cache:categorias` em qualquer write
  - _Requirements: Req. 14.1, 14.2, 14.6, 14.7_

- [x] 5.2 Implementar CRUD de Tipos de Processo
  - `GET/POST /api/v1/admin/config/tipos-processo`: listar por categoria / criar com campos obrigatórios: nome ≤100 chars, prazo 1-365 dias úteis, unidades atendentes
  - `PATCH/DELETE /api/v1/admin/config/tipos-processo/:id`: editar / desativar com verificação de processos em andamento
  - Validar unicidade de nome dentro da mesma Categoria
  - _Requirements: Req. 14.3, 14.4, 14.6, 14.7_

- [x] 5.3 Implementar CRUD de Unidades
  - `GET/POST /api/v1/admin/config/unidades`: listar / criar com campos obrigatórios: nome ≤100 chars, secretaria, gestor responsável
  - `PATCH/DELETE /api/v1/admin/config/unidades/:id`: editar / desativar com verificação de processos em andamento e modo de atribuição configurável
  - _Requirements: Req. 14.5, 14.6, 14.7_

- [x] 5.4 Implementar CRUD de Fluxos e Etapas
  - Criar `src/modules/fluxos/fluxos.router.ts`, `fluxos.controller.ts`, `fluxos.service.ts`
  - `GET/POST /api/v1/admin/config/fluxos`: listar / criar fluxo (versionamento automático)
  - `GET/PUT /api/v1/admin/config/fluxos/:id`: detalhe / salvar fluxo com todas as etapas (1-50 etapas)
  - Cada etapa: nome ≤100 chars, prazo 1-365 dias úteis, servidor padrão, documentos obrigatórios (≤20), automações (≤10 por etapa)
  - Validar: fluxo com 0 etapas rejeitado; etapa com nome vazio ou prazo fora do intervalo rejeitada
  - Novo fluxo salvo aplica apenas a processos futuros (versionamento por `fluxoVersaoId`)
  - Registrar no Módulo_de_Auditoria: data, hora, identidade do Administrador
  - _Requirements: Req. 15.1, 15.2, 15.3, 15.4, 15.6, 15.7, 15.8_

- [x] 5.5 Implementar cálculo e exibição do prazo total do fluxo
  - Criar função pura `calcularPrazoTotalFluxo(etapas: Etapa[]): number` em `packages/shared`
  - Expor o valor calculado na resposta do endpoint de fluxo
  - Atualizar em tempo real no frontend em ≤1s após qualquer alteração de prazo de etapa
  - _Requirements: Req. 15.5_

- [x]* 5.6 Escrever property test para prazo total do fluxo (Property 9)
  - **Property 9: Prazo Total do Fluxo é Soma das Etapas** — *For any* configuração de fluxo com N etapas, o prazo total deve ser igual à soma aritmética dos prazos de todas as etapas, recalculando corretamente após qualquer adição, remoção ou alteração
  - **Validates: Requirements 15.5**

- [x] 5.7 Implementar CRUD de Formulários Dinâmicos
  - Criar `src/modules/formularios/formularios.router.ts`, `formularios.controller.ts`, `formularios.service.ts`
  - `GET/POST /api/v1/admin/config/formularios`: listar / criar formulário associado a TipoProcesso + Unidade
  - `GET/PUT /api/v1/admin/config/formularios/:id`: detalhe / salvar com campos (≤50 campos)
  - Cada campo: tipo (8 tipos válidos), rótulo ≤100 chars, descrição ≤300 chars, obrigatoriedade, validação regex, valor padrão compatível com tipo
  - Validar: rótulo ausente rejeitado; valor padrão incompatível com tipo rejeitado
  - Suportar reordenação de campos (persistir `ordem` imediatamente)
  - Expor `GET /api/v1/formularios?tipoId=X&unidadeId=Y` (público, com cache Redis TTL 10min) para o Portal
  - _Requirements: Req. 16.1, 16.2, 16.3, 16.4_

- [x] 5.8 Checkpoint — Configurações administrativas verificadas
  - Testes de integração para CRUD de cada entidade com verificação de unicidade, desativação e auditoria
  - Testes unitários para `calcularPrazoTotalFluxo` e property test Property 9 passando

---

### 6. Gestão de Servidores (API)

- [x] 6.1 Implementar CRUD de Servidores
  - Criar `src/modules/servidores/servidores.router.ts`, `servidores.controller.ts`, `servidores.service.ts`
  - `GET /api/v1/admin/servidores`: listar com paginação + filtros (nível, unidade, status)
  - `POST /api/v1/admin/servidores`: cadastrar — validar CPF (dígitos verificadores), unicidade de CPF, gerar senha temporária ≥8 chars, enviar por email, `senhaTemporaria: true`; validar limite de 3 Administradores ativos simultâneos; registrar na Auditoria
  - `GET /api/v1/admin/servidores/:id`: detalhe com permissões granulares
  - `PATCH /api/v1/admin/servidores/:id`: editar campos editáveis (CPF imutável após cadastro)
  - _Requirements: Req. 21.1, 21.2, 21.3, 21.4, 21.5, 21.9_

- [x] 6.2 Implementar desativação de servidor e gestão de permissões granulares
  - `POST /api/v1/admin/servidores/:id/desativar`: checar processos atribuídos, exigir reatribuição de cada um antes de confirmar, encerrar sessões ativas em ≤5s (invalidar todos os tokens via Redis)
  - `PUT /api/v1/admin/servidores/:id/permissoes`: atualizar permissões granulares, registrar no Módulo_de_Auditoria (quem alterou, servidor afetado, permissões com valores anterior/posterior, data/hora)
  - _Requirements: Req. 8.6, 8.9, 21.6, 21.7, 21.8_

---

### 7. Processos — Backend (Core)

- [x] 7.1 Implementar criação de processo pelo Cidadão
  - Criar `src/modules/processos/processos.router.ts`, `processos.controller.ts`, `processos.service.ts`
  - `POST /api/v1/processos`: validar TipoProcesso + Unidade disponíveis, carregar FormularioDinamico, validar campos obrigatórios do formulário, validar documentos (formato: PDF/JPG/PNG/DOC/DOCX; tamanho: ≤10MB/arquivo, ≤50MB total, ≤20 arquivos), gerar protocolo via `gerarProtocolo(redis)`, criar `Processo` + `RespostaFormulario[]` em transação Prisma, enfileirar notificação de criação + job de atribuição, retornar protocolo em ≤5s
  - `GET /api/v1/processos`: listar processos do cidadão autenticado com filtros (status, período, categoria)
  - _Requirements: Req. 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.13_

- [x] 7.2 Implementar upload de documentos via MinIO
  - Criar `src/modules/processos/documentos.service.ts`: gerar presigned URL de upload (expiração 5min), validar tipo e tamanho antes de gerar URL, salvar `Documento` no banco após upload confirmado
  - `POST /api/v1/processos/:id/documentos`: gerar presigned URL para upload direto ao MinIO
  - `GET /api/v1/processos/:id/documentos/:docId/download`: verificar autorização, gerar presigned URL de leitura (expiração 5min)
  - Bucket path: `processos/{unidadeId}/{processoId}/{filename}`
  - _Requirements: Req. 4.5, 4.7, 5.4_

- [x] 7.3 Implementar consulta e acompanhamento de processo pelo Cidadão
  - `GET /api/v1/processos/:id`: detalhe completo (verificar ownership: cidadão só acessa seus próprios processos — erro 404 para acesso negado, não 403)
  - `GET /api/v1/processos/:id/historico`: movimentações em ordem cronológica crescente (data, hora, responsável)
  - `GET /api/v1/processos/:id/documentos`: lista de arquivos com nome e data
  - `GET /api/v1/processos/:id/mensagens`: canal público em ordem cronológica crescente
  - _Requirements: Req. 5.1, 5.2, 5.3, 5.4, 5.5, 5.10_

- [x] 7.4 Implementar listagem e busca de processos no Painel Administrativo
  - `GET /api/v1/admin/processos`: listagem paginada (20/página), filtros combinados (categoria, tipo, status, datas, prazo, servidor, cidadão, unidade, prioridade), ordenação por qualquer coluna, campos: protocolo, cidadão, categoria, tipo, status+cor, prazo, servidor, última movimentação
  - Busca rápida: ≥3 chars, correspondência parcial case-insensitive em protocolo/nome/CPF, resultado em ≤1s; <3 chars exibe mensagem orientativa
  - Exibir filtros ativos com opção de limpar todos simultaneamente
  - _Requirements: Req. 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_

- [x]* 7.5 Escrever property test para correção da busca rápida (Property 5)
  - **Property 5: Correção da Busca Rápida** — *For any* conjunto de processos armazenados e qualquer termo ≥3 caracteres, todos os resultados devem conter o termo (parcial, case-insensitive) em protocolo, nome ou CPF do cidadão, e nenhum resultado fora desse critério deve aparecer
  - **Validates: Requirements 10.5**

- [x] 7.6 Implementar tramitação de processo pelo Servidor
  - `GET /api/v1/admin/processos/:id`: detalhe completo com etapa atual, etapas anteriores concluídas, próxima etapa
  - `POST /api/v1/admin/processos/:id/avancar-etapa`: verificar RBAC (`MOVER_ETAPA`), verificar documentos obrigatórios da etapa, iniciar transação Prisma: UPDATE Processo (nova etapa + status), CREATE MovimentacaoProcesso, registrar Auditoria — se auditoria falhar: ROLLBACK + erro 500; se OK: COMMIT + enfileirar notificação + emit Socket.io
  - `POST /api/v1/admin/processos/:id/rejeitar`: verificar permissão `REJEITAR`, registrar Auditoria, notificar cidadão
  - `POST /api/v1/admin/processos/:id/solicitar-documentos`: alterar status para `aguardando_docs`, registrar com data/hora/servidor, notificar cidadão com lista de documentos
  - `POST /api/v1/admin/processos/:id/observacoes`: registrar observação interna (≤2000 chars, visível apenas a servidores) ou pública (≤2000 chars, visível ao cidadão) com data, hora e identidade do servidor
  - _Requirements: Req. 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9_

- [x] 7.7 Implementar atribuição e reatribuição de processos
  - `POST /api/v1/admin/processos/:id/atribuir`: exibir carga de cada servidor antes de confirmar; suportar modos automático (menor carga, desempate por última atribuição), fila geral e manual; registrar Auditoria (processoId, servidorId, modo, data/hora); notificar servidor em ≤60s
  - `POST /api/v1/admin/processos/:id/reatribuir`: exigir justificativa 20-500 chars; validar tamanho antes de confirmar; registrar Auditoria (origem, destino, justificativa, data/hora)
  - Job de atribuição automática (BullMQ): executar algoritmo de menor carga ao receber novo processo; se nenhum servidor disponível → mover para Fila_Geral + registrar Auditoria
  - _Requirements: Req. 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10_

- [x]* 7.8 Escrever property test para algoritmo de atribuição automática (Property 7)
  - **Property 7: Algoritmo de Atribuição Automática por Menor Carga** — *For any* conjunto de servidores ativos com contagens distintas de processos, a atribuição deve selecionar o servidor com menor número de processos ativos; em caso de empate, o servidor com menor tempo desde a última atribuição
  - Gerar aleatoriamente conjuntos de servidores com cargas variadas (incluindo empates) e verificar a seleção
  - **Validates: Requirements 12.2**

- [x] 7.9 Checkpoint — Backend de processos verificado
  - Testes de integração: criação de processo end-to-end (wizard → protocolo → atribuição automática)
  - Testes de integração: avanço de etapa com rollback em falha de auditoria
  - Property tests 4, 5, 7 passando

---

### 8. Mensagens e Comunicação (API)

- [x] 8.1 Implementar canal de mensagens público (Cidadão ↔ Servidor)
  - `GET /api/v1/processos/:id/mensagens`: mensagens em ordem cronológica crescente, com remetente, data, hora
  - `POST /api/v1/processos/:id/mensagens` (cidadão): registrar com data/hora/cidadão, notificar servidor responsável em ≤60s, preservar texto em caso de falha
  - `GET /api/v1/admin/processos/:id/mensagens`: mesmo canal para o servidor
  - `POST /api/v1/admin/processos/:id/mensagens` (servidor): registrar no histórico do processo, notificar cidadão em ≤60s; se cidadão sem conta ativa: registrar mensagem + indicar que notificação não pôde ser entregue
  - Bloquear envio de mensagens em processos com status encerrado
  - _Requirements: Req. 5.5, 5.6, 5.7, 13.1, 13.3, 13.7, 13.8_

- [x] 8.2 Implementar canal de mensagens internas (Servidor ↔ Servidor)
  - `GET /api/v1/admin/processos/:id/mensagens/internas`: mensagens internas (invisíveis ao cidadão)
  - `POST /api/v1/admin/processos/:id/mensagens/internas`: registrar com data/hora/servidor remetente; se mensagem direcionada a servidor específico: notificar destinatário em ≤60s; registrar no Módulo_de_Auditoria
  - Suporte a anexos: PDF/JPG/PNG/DOC/DOCX, ≤10MB por arquivo, rejeitar com mensagem descritiva antes do envio
  - Bloquear envio em processos com status encerrado
  - _Requirements: Req. 13.2, 13.4, 13.5, 13.6, 13.8_

---

### 9. Sistema de Notificações (Pipeline Completo)

- [x] 9.1 Implementar NotificacaoWorker completo
  - `src/jobs/notificacao.worker.ts`: processar jobs da `notificacao-queue`
  - Fluxo: verificar preferências do cidadão → verificar horário de silêncio (delay se necessário) → rotear para canal (email via Nodemailer, SMS via gateway, painel via PostgreSQL + Socket.io emit, push via serviço)
  - Retry: 3 tentativas com delay fixo de 30s para email/SMS
  - Fallback: após 3 falhas em email/SMS → registrar falha (canal, tipoEvento, timestamp) + entregar no painel em ≤60s
  - Horário de silêncio: calcular `delay` em ms até fim do silêncio configurado, reagendar job com `jobOptions.delay`
  - _Requirements: Req. 6.1, 6.2, 6.4, 6.5_

- [x] 9.2 Implementar notificações de sistema (alertas de prazo e fila)
  - `PrazoWorker` (cron a cada 1h): buscar processos com prazo ≤3 dias úteis (Req. 6.6), etapas vencidas (Req. 11.8), processos na Fila_Geral há >24h (Req. 12.6); enfileirar jobs de notificação para cada caso
  - Alerta de etapa vencida: alterar status da etapa para "Vencido", notificar Gestor_de_Unidade responsável
  - _Requirements: Req. 6.6, 11.8, 12.6_

- [x] 9.3 Implementar notificação no painel via Socket.io
  - Criar `src/socket/socket.server.ts`: montar Socket.io no processo Express, configurar `@socket.io/redis-adapter` para multi-instância
  - Autenticação de handshake: verificar JWT no header da conexão, checar blacklist no Redis
  - Criar rooms automaticamente ao conectar: `cidadao:{id}`, `servidor:{id}`, `processo:{ids}`, `unidade:{unidadeId}`
  - Criar handlers para todos os eventos do design: `processo:status_atualizado`, `processo:nova_mensagem`, `processo:atribuido`, `processo:etapa_avancada`, `notificacao:nova`, `fila:novo_processo`, `dashboard:atualizar`
  - _Requirements: Req. 5.9, 6.1, 12.7, 13.3_

---

### 10. Dashboard e Relatórios (API)

- [x] 10.1 Implementar endpoints de dashboard por perfil
  - Criar `src/modules/dashboard/dashboard.router.ts`, `dashboard.controller.ts`, `dashboard.service.ts`
  - `GET /api/v1/admin/dashboard/analista`: processos por status, vencendo em ≤24h, tempo médio de resolução (30 dias), produtividade diária (30 dias)
  - `GET /api/v1/admin/dashboard/gestor-unidade`: totais por status na unidade, carga por servidor, taxas aprovação/rejeição (30 dias), volume diário (30 dias)
  - `GET /api/v1/admin/dashboard/gestor-categoria`: totais por status agrupados por unidade, tempo médio por tipo (30 dias), comparação entre unidades
  - `GET /api/v1/admin/dashboard/gestor-geral`: totais por status por categoria, volume semanal (90 dias), comparação de períodos de 30 dias
  - Cache Redis `cache:dashboard:{role}:{id}` TTL 5min; invalidar em writes relevantes; emitir `dashboard:atualizar` via Socket.io a cada 5min para refresh do frontend sem reload
  - _Requirements: Req. 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

- [x] 10.2 Implementar módulo de relatórios
  - Criar `src/modules/relatorios/relatorios.router.ts`, `relatorios.controller.ts`, `relatorios.service.ts`
  - `GET /api/v1/admin/relatorios`: gerar relatório com filtros (período padrão: 30 dias; filtros: período, categoria, tipo, unidade, servidor); período máximo 366 dias; retornar em ≤5s para sets ≤10.000 registros
  - Relatórios: volume por período, tempo médio por tipo, taxa aprovação/rejeição por unidade, processos vencidos por servidor, volume por categoria
  - Validar intervalo de datas: data final ≥ data inicial, intervalo ≤366 dias
  - `POST /api/v1/admin/relatorios/exportar`: enfileirar job na `relatorio-queue` para >10.000 registros, retornar jobId
  - `GET /api/v1/admin/relatorios/exportar/:jobId`: verificar status (Redis `relatorio:job:{jobId}` TTL 1h) + download
  - RelatorioWorker: gerar CSV ou PDF em background, notificar servidor quando disponível, salvar no MinIO
  - _Requirements: Req. 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7_

- [x] 10.3 Implementar endpoints de auditoria
  - `GET /api/v1/admin/auditoria`: log paginado (≤100 registros/página), filtros: data/hora, tipo de ação, servidor/cidadão, protocolo, módulo; retornar em ≤5s
  - `POST /api/v1/admin/auditoria/exportar`: enfileirar exportação CSV/PDF (≤30s para ≤10.000 registros, background para maiores)
  - `GET /api/v1/admin/auditoria/exportar/:jobId`: status + download
  - Garantir somente leitura para todos os níveis (incluindo Administrador): bloquear CREATE/UPDATE/DELETE na rota
  - _Requirements: Req. 17.2, 17.4, 17.5, 17.6, 17.7_

---

### 11. Frontend — Design System e Shell

- [x] 11.1 Implementar Design System (componentes UI primitivos)
  - Criar `apps/web/src/components/ui/`: `Button` (altura/largura mínima 44px, variantes primary/secondary/danger/ghost), `Input` (label, error state, helper text), `Badge`/`StatusBadge` (mapeamento de cores por `StatusProcesso`), `Modal`, `Tooltip`, `Spinner`, `Alert`, `Pagination`, `Select`, `Checkbox`, `DatePicker`
  - Todos com `aria-*` adequados, suporte a navegação por teclado, indicador de foco visível
  - Contraste mínimo 4,5:1 para texto normal e 3:1 para texto grande (WCAG 2.1 AA)
  - Responsivos para 320px, 768px, 1024px e 1440px
  - _Requirements: Req. 19.1, 19.2, 19.3, 19.4_

- [x] 11.2 Implementar AppShell, layout e navegação
  - Criar `apps/web/src/components/layout/`: `AppShell` (Header 64px fixo + Sidebar 280px colapsável + MainContent), `Header` (logo, BreadcrumbNav, NotificationBell com contador, UserMenu), `Sidebar` (NavMenu por perfil RBAC, CollapseButton)
  - Criar `apps/web/src/router/`: configurar React Router v6 com rotas do Portal do Cidadão e do Painel Administrativo; guards de rota (`PrivateRoute`, `RoleRoute`) que verificam `authStore`
  - Criar `apps/web/src/lib/axiosInstance.ts`: interceptor de request (adicionar JWT Bearer), interceptor de response (401 → logout automático, refresh se necessário)
  - Criar `apps/web/src/store/authStore.ts`, `notificacaoStore.ts`, `wizardStore.ts` (Zustand)
  - _Requirements: Req. 8.3, 8.4_

- [x] 11.3 Implementar cliente Socket.io e hook de notificações em tempo real
  - Criar `apps/web/src/lib/socketClient.ts`: conectar com JWT no handshake, reconectar automaticamente, expor `socket` singleton
  - Criar `apps/web/src/hooks/useSocket.ts`: assinar eventos, atualizar `notificacaoStore` e invalidar queries React Query relevantes ao receber eventos
  - Criar `apps/web/src/hooks/useNotificacoes.ts`: exibir notificações no `NotificationBell`, marcar como lida
  - _Requirements: Req. 5.9, 6.1_

---

### 12. Frontend — Portal do Cidadão (Autenticação e Conta)

- [x] 12.1 Implementar páginas de cadastro e ativação do Cidadão
  - Criar `apps/web/src/features/auth/RegisterPage.tsx`: formulário com todos os campos obrigatórios (Req. 1.1), validação em tempo real campo a campo com Zod + react-hook-form, exibição de erro individual por campo, mensagem de sucesso com instrução de ativação por email
  - Criar `apps/web/src/features/auth/ActivatePage.tsx`: extrair token da URL, chamar endpoint de ativação, redirecionar para login em caso de sucesso, exibir opção de reenvio em caso de expiração
  - _Requirements: Req. 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9_

- [x] 12.2 Implementar página de login do Cidadão
  - Criar `apps/web/src/features/auth/LoginPage.tsx`: campos CPF e senha, checkbox "Manter conectado", feedback de erro genérico sem indicar campo incorreto, manter CPF preenchido após erro, exibir tempo restante de bloqueio em minutos inteiros
  - Criar `apps/web/src/features/auth/TwoFactorPage.tsx`: campo de 6 dígitos, expiração de 10min, mensagem de erro sem contabilizar no bloqueio
  - Criar `apps/web/src/features/auth/RecoverPasswordPage.tsx` + `NewPasswordPage.tsx`
  - _Requirements: Req. 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9_

- [x] 12.3 Implementar páginas de perfil e configurações do Cidadão
  - Criar `apps/web/src/features/cidadao/PerfilPage.tsx`: edição de dados pessoais com validação inline
  - Criar `apps/web/src/features/cidadao/ConfiguracoesPage.tsx`: troca de email (com confirmação), troca de senha, histórico dos 10 últimos acessos (data/hora/IP), preferências de notificação por evento e canal + horário de silêncio, ativação de 2FA, exclusão de conta com listagem de processos em andamento e confirmação
  - _Requirements: Req. 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

---

### 13. Frontend — Portal do Cidadão (Painel e Processos)

- [x] 13.1 Implementar painel pessoal do Cidadão
  - Criar `apps/web/src/features/cidadao/CidadaoPainelPage.tsx`: contadores (abertos/em andamento/finalizados), lista dos 5 processos mais recentes (protocolo, categoria, tipo, data, status+cor, dias restantes), alertas de prazo (≤3 dias úteis) e documentos pendentes, botão "Novo Processo" visível sem scroll, mensagem para ausência de processos
  - Atualização em tempo real via `useSocket` (invalidar query ao receber `processo:status_atualizado`)
  - Histório completo com filtros (status, período, categoria)
  - _Requirements: Req. 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

- [x] 13.2 Implementar wizard de criação de processo (6 etapas)
  - Criar `apps/web/src/features/processos/NovoProcessoWizard.tsx` com `StepIndicator`, 6 steps gerenciados pelo `wizardStore`:
    - Step 1: seleção de Categoria (mostrar apenas categorias ativas; mensagem se nenhuma disponível)
    - Step 2: seleção de TipoProcesso filtrado pela categoria escolhida
    - Step 3: seleção de Unidade com nome, endereço, telefone, horário (mensagem se nenhuma disponível)
    - Step 4: renderização dinâmica do `FormularioDinamicoRenderer` com validação por campo ao sair do foco
    - Step 5: upload de documentos via `react-dropzone` (PDF/JPG/PNG/DOC/DOCX, ≤10MB/arquivo, ≤50MB total, ≤20 arquivos; rejeitar com erro descritivo; preservar arquivos válidos)
    - Step 6: revisão, confirmação e exibição do Protocolo gerado
  - Navegação entre etapas sem perda de dados; preservar todos os dados em caso de falha na submissão
  - _Requirements: Req. 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.13_

- [x] 13.3 Implementar página de detalhe do processo (Portal do Cidadão)
  - Criar `apps/web/src/features/processos/ProcessoDetailPage.tsx` com 5 abas:
    - **Informações**: protocolo, categoria, tipo, unidade, data, status, dados do formulário com rótulos
    - **Histórico**: cronologia de movimentações (data, hora, responsável)
    - **Documentos**: lista com nome, data, botão de download individual
    - **Comunicação**: mensagens em ordem cronológica (remetente, data, hora), campo de envio com preservação de texto em falha, atualização em tempo real via Socket.io
    - **Prazos**: calendário visual com codificação por cor (verde/amarelo/vermelho) para cada etapa
  - Atualizar status em ≤5s sem reload (via Socket.io `processo:status_atualizado`)
  - Erro 404 para processo não pertencente ao cidadão autenticado
  - _Requirements: Req. 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10_

---

### 14. Frontend — Painel Administrativo (Autenticação e Dashboard)

- [x] 14.1 Implementar página de login do Servidor
  - Criar `apps/web/src/features/auth/AdminLoginPage.tsx`: campos CPF e senha, feedback de erro genérico (sem indicar CPF inexistente), exibir tempo restante de bloqueio, redirecionar para troca de senha se `senhaTemporaria: true`
  - Encerramento de sessão por inatividade de 60min (modal de aviso antes de redirecionar)
  - _Requirements: Req. 8.1, 8.3, 8.5, 8.7, 8.8_

- [x] 14.2 Implementar dashboards por perfil
  - Criar `apps/web/src/features/dashboard/DashboardPage.tsx`: renderizar indicadores conforme perfil do servidor autenticado (analista, gestor-unidade, gestor-categoria, gestor-geral)
  - Atualização automática a cada 5min sem reload, preservando posição de scroll e filtros ativos (via `dashboard:atualizar` Socket.io)
  - Erro por indicador: exibir mensagem de indisponibilidade apenas no widget afetado, mantendo os demais visíveis com últimos dados
  - Gráficos com Chart.js ou Recharts (barras, linhas, pizza conforme indicador)
  - _Requirements: Req. 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

---

### 15. Frontend — Painel Administrativo (Gestão de Processos)

- [x] 15.1 Implementar listagem e busca de processos no Painel
  - Criar `apps/web/src/features/processos/ProcessoListPage.tsx`: tabela paginada (20/página) com `DataTable` componentizado, colunas: protocolo, cidadão, categoria, tipo, status+cor, prazo, servidor, última movimentação
  - Filtros combinados: dropdowns, range de datas, campo de texto para servidor/cidadão; exibir filtros ativos com valores; botão limpar todos
  - Busca rápida: input com debounce, mínimo 3 chars (exibir aviso abaixo de 3), resultados em ≤1s, sem resultados → mensagem com filtros visíveis
  - Ordenação por qualquer coluna (crescente/decrescente)
  - _Requirements: Req. 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_

- [x] 15.2 Implementar página de detalhe do processo no Painel Administrativo
  - Criar `apps/web/src/features/processos/ProcessoDetailAdminPage.tsx`: exibir etapa atual, etapas concluídas, próxima etapa prevista
  - Ações disponíveis por permissão RBAC: botão "Avançar Etapa" (verificar documentos obrigatórios antes), "Rejeitar" (verificar permissão), "Solicitar Documentos", "Registrar Observação Interna/Pública" (≤2000 chars), "Atribuir/Reatribuir"
  - Canal de mensagens público (cidadão ↔ servidor) e canal interno (servidor ↔ servidor) com suporte a anexo ≤10MB
  - Bloquear ações de envio de mensagem se processo encerrado
  - Atualização em tempo real via Socket.io
  - _Requirements: Req. 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.9, 13.1, 13.2, 13.5, 13.8_

- [x] 15.3 Implementar modal e fluxo de atribuição/reatribuição
  - Modal de atribuição manual: exibir lista de servidores disponíveis na unidade com carga atual (nº de processos ativos)
  - Modal de reatribuição: campo de justificativa (20-500 chars), validação inline, bloquear confirmação se inválido
  - Notificação em tempo real ao servidor atribuído via Socket.io
  - _Requirements: Req. 12.4, 12.8, 12.9_

---

### 16. Frontend — Configurações Administrativas

- [x] 16.1 Implementar páginas de configuração de Categorias, Tipos e Unidades
  - Criar `apps/web/src/features/admin/CategoriasPage.tsx`: tabela de categorias com ações criar/editar/desativar; modal de formulário com validação; confirmação de desativação com contagem de processos impactados
  - Criar seção de Tipos de Processo (aninhado em Categoria): formulário com todos os campos obrigatórios e opcionais
  - Criar `apps/web/src/features/admin/UnidadesPage.tsx`: tabela + modal de formulário; seleção de modo de atribuição por unidade
  - _Requirements: Req. 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7_

- [x] 16.2 Implementar editor visual de Fluxos
  - Criar `apps/web/src/features/admin/FluxoEditorPage.tsx` com `react-dnd`:
    - `StageList` (sortable via drag-and-drop): arrastar para reordenar etapas
    - `StageCard` por etapa: nome, prazo, servidor padrão, automações, documentos obrigatórios
    - `TotalPrazoDisplay`: atualizar soma em ≤1s após qualquer alteração de prazo
    - Validação: impedir salvamento sem etapas, nome vazio, prazo fora de 1-365
    - Confirmação de salvamento com data/hora
  - _Requirements: Req. 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8_

- [x] 16.3 Implementar editor de Formulários Dinâmicos
  - Criar `apps/web/src/features/admin/FormulariosPage.tsx`:
    - Lista de formulários com associação tipo/unidade
    - Editor de campos: adicionar/remover/reordenar (drag-and-drop), configurar tipo, rótulo, obrigatoriedade, validação regex, valor padrão
    - Validação: rótulo obrigatório, valor padrão compatível com tipo
    - Preview do formulário renderizado
  - _Requirements: Req. 16.1, 16.2, 16.3, 16.4_

- [x] 16.4 Implementar renderizador de Formulários Dinâmicos (Portal do Cidadão)
  - Criar `apps/web/src/components/forms/FormularioDinamicoRenderer.tsx`: renderizar campos dinamicamente conforme `CampoFormulario[]` em ordem configurada, suportar todos os 8 tipos de campo, validação ao sair do foco com mensagem adjacente ao campo sem remover valor preenchido
  - _Requirements: Req. 16.5, 16.6, 16.7_

---

### 17. Frontend — Servidores, Relatórios e Auditoria

- [x] 17.1 Implementar página de gestão de servidores
  - Criar `apps/web/src/features/admin/ServidoresPage.tsx`: tabela paginada com filtros, ações: cadastrar (modal com todos os campos), editar, desativar (checar processos atribuídos, exigir reatribuição), atualizar permissões granulares (lista de checkboxes por permissão)
  - Feedback de limite de 3 Administradores simultâneos
  - Reativação de servidor com verificação de limite de Administradores
  - _Requirements: Req. 21.1, 21.2, 21.3, 21.4, 21.5, 21.6, 21.7, 21.8, 21.9_

- [x] 17.2 Implementar página de relatórios
  - Criar `apps/web/src/features/relatorios/RelatoriosPage.tsx`: filtros (período padrão 30 dias, categoria, tipo, unidade, servidor), validação de intervalo de datas, alternância gráfico/tabela sem reload, exportação CSV/PDF com tracking de status para jobs em background
  - _Requirements: Req. 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7_

- [x] 17.3 Implementar página de auditoria
  - Criar `apps/web/src/features/auditoria/AuditoriaPage.tsx`: log paginado (100/página), filtros (data/hora, tipo, servidor/cidadão, protocolo, módulo), resultados em ≤5s, exportação CSV/PDF com tracking de status
  - Somente leitura: sem botões de edição ou exclusão em nenhum nível
  - _Requirements: Req. 17.2, 17.4, 17.5, 17.6, 17.7_

---

### 18. Testes de Integração e E2E

- [ ]* 18.1 Escrever testes de integração para fluxos críticos de backend
  - Fluxo completo de cadastro + ativação + login + 2FA (com Testcontainers PostgreSQL + Redis)
  - Criação de processo end-to-end: wizard → protocolo → atribuição automática → notificação
  - Avanço de etapa com rollback em falha de auditoria
  - Pipeline de notificações: envio + fallback + horário de silêncio
  - Atribuição automática com empate (menor tempo desde última atribuição)
  - Exportação de relatório em background
  - _Requirements: Req. 2, 4, 11, 12, 6, 18_

- [ ]* 18.2 Escrever testes E2E com Playwright
  - Fluxo Cidadão: cadastro → ativação por email → login → abertura de processo via wizard → acompanhamento de status em tempo real
  - Fluxo Analista: login → busca de processo → tramitação (avanço de etapa) → comunicação com cidadão
  - Fluxo Administrador: configuração de categoria → criação de fluxo → cadastro de servidor → verificação de auditoria
  - _Requirements: Req. 1, 2, 4, 5, 11, 14, 15, 21_

- [ ] 18.3 Checkpoint Final — Todos os testes verificados
  - Executar `vitest --run` em todos os pacotes; cobertura ≥ 80% lines/functions, 75% branches
  - Executar testes Playwright; todos os fluxos E2E passando
  - Garantir que todos os 9 property tests passam com ≥100 iterações
  - Revisar que todos os requisitos (1–22) têm pelo menos uma tarefa de implementação e um teste correspondente

---

## Melhorias do Painel Administrativo (Requisitos 23–27 + expansões dos Req. 4, 9, 21)

> As tarefas a seguir estendem o sistema já implementado. Todas dependem do `packages/shared`, do padrão Controller → Service → Repository (Prisma), do middleware RBAC e do pipeline BullMQ/Socket.io já existentes. Nenhuma tarefa existente (1–18) deve ser renumerada ou reaberta.

### 19. Backend — Protocolo com Prefixo e Fundações Compartilhadas

- [ ] 19.1 Adicionar Prefixo_de_Protocolo aos modelos e schemas compartilhados
  - Adicionar campo opcional `prefixoProtocolo String? @db.VarChar(5)` aos modelos `Unidade` e `Categoria` no `schema.prisma` e gerar migration (`prisma migrate dev --name add_prefixo_protocolo`)
  - Adicionar enum `StatusTarefa` (`pendente`, `em_andamento`, `concluida`) e enum `TipoEvento` (incluindo `TAREFA_ATRIBUIDA`, `TAREFA_PROXIMA_VENCIMENTO`, `TAREFA_VENCIDA`) em `packages/shared/src/constants/`
  - Adicionar valor `GERENCIAR_TAREFAS = 'gerenciar_tarefas'` ao enum `Permissao` e refletir no conjunto default de permissões por nível
  - Criar tipos `Tarefa`, `TarefaAtribuicao` em `packages/shared/src/types/` e schemas Zod correspondentes
  - _Requisitos: 4.8a, 4.8c, 27.1, 27.2_

- [ ] 19.2 Estender `gerarProtocolo` para suportar prefixo retrocompatível
  - Atualizar `apps/api/src/utils/protocolo.ts`: aceitar `prefixo?` e usar chave `protocolo:seq:{prefixo}:{ano}` (ou `{ano}` sem prefixo), preservando `INCR` atômico e TTL de 2 anos
  - Implementar `resolverPrefixo(unidade, categoria)` com precedência Unidade → Categoria → sem prefixo
  - Formatar `[PREFIXO-]AAAA-NNNNN`; manter `AAAA-NNNNN` quando sem prefixo
  - _Requisitos: 4.8, 4.8a, 4.8b, 4.8c_

- [ ]* 19.3 Atualizar/estender property test do protocolo (Property 4)
  - **Property 4: Formato e Unicidade do Protocolo (com Prefixo)** — *For any* conjunto de protocolos com e sem prefixo (2–5 letras maiúsculas), todos obedecem a `[PREFIXO-]AAAA-NNNNN`, a sequência é independente por prefixo+ano, e não há duplicatas mesmo em geração paralela
  - Estender o teste existente com gerador de prefixos aleatórios (incluindo `undefined`)
  - **Validates: Requirements 4.8, 4.8a, 4.8b, 4.8c, 23.5**

### 20. Backend — Abertura de Processo pelo Servidor (Admin)

- [ ] 20.1 Implementar busca de cidadão por CPF para abertura admin
  - `GET /api/v1/admin/cidadaos?cpf={cpf}` em `src/modules/cidadaos/`: validar CPF, retornar dados de identificação do Cidadão ou 404 sinalizando opção de cadastro de novo Cidadão
  - Proteger com RBAC (`editar` ou Administrador)
  - _Requisitos: 23.2, 23.3_

- [ ] 20.2 Implementar endpoint de abertura de processo pelo servidor
  - `POST /api/v1/admin/processos`: verificar RBAC (`editar`/Administrador), validar Categoria/Tipo/Unidade e Formulário_Dinâmico (mesmas validações do Req. 4), reutilizar o motor de criação de processo do `processo.service` (geração de protocolo com prefixo + cálculo de prazo)
  - Registrar Auditoria (servidor autor, cidadão vinculado, data/hora), enfileirar Notificação ao Cidadão com o protocolo
  - Preservar dados e permitir nova tentativa em caso de falha
  - _Requisitos: 23.1, 23.4, 23.5, 23.6, 23.7_

### 21. Backend — Detalhe, Edição Corretiva e Anexação de Documentos

- [ ] 21.1 Implementar detalhe completo com trilha de auditoria e ações pendentes
  - `GET /api/v1/admin/processos/:id` (estender): incluir respostas do formulário, etapa atual, responsável, prazos, e a seção de ações pendentes (próxima etapa, documentos solicitados não enviados)
  - `GET /api/v1/admin/processos/:id/auditoria`: retornar a trilha de auditoria do processo (autor, ação, valor anterior/posterior, data/hora) em ordem cronológica, combinando `MovimentacaoProcesso` + `AuditoriaLog`
  - _Requisitos: 24.1, 24.2, 24.3_

- [ ] 21.2 Implementar edição corretiva de processo com rastreabilidade
  - `PATCH /api/v1/admin/processos/:id`: verificar RBAC (`editar`), aplicar alteração dentro de transação Prisma, registrar Auditoria com valor anterior e posterior por campo; se a auditoria falhar → ROLLBACK + erro `SYS_001`
  - Bloquear com acesso negado se sem permissão `editar`
  - _Requisitos: 24.4, 24.5, 24.7_

- [ ]* 21.3 Escrever property test para edição corretiva (Property 13)
  - **Property 13: Edição Corretiva Registra Valores Anterior e Posterior** — *For any* edição corretiva de um campo, o registro de auditoria contém o valor anterior (estado imediatamente anterior) e o valor posterior (novo valor)
  - **Validates: Requirements 24.5**

- [ ] 21.4 Implementar anexação de documentos ao processo no painel
  - `POST /api/v1/admin/processos/:id/documentos`: gerar presigned URL (MinIO), validar formato/tamanho/limites (PDF/JPG/PNG/DOC/DOCX; ≤10MB/arquivo, ≤50MB total, ≤20 arquivos) antes de gerar a URL, salvar `Documento` com autor/data
  - Atualizar a lista de documentos pendentes; quando todos os solicitados forem anexados, remover a pendência e liberar o avanço da etapa dependente
  - _Requisitos: 24.6, 25.1, 25.2, 25.3, 25.4, 25.5_

- [ ]* 21.5 Escrever property test para pendência de documentos (Property 14)
  - **Property 14: Pendência de Documentos é a Diferença de Conjuntos** — *For any* conjunto de documentos solicitados e subconjunto anexado, a lista de pendências é exatamente solicitados − anexados; vazia quando todos anexados
  - **Validates: Requirements 25.5**

### 22. Backend — Geração de PDF do Processo

- [ ] 22.1 Implementar montagem do conteúdo consolidado do processo
  - Criar `src/modules/processos/pdf/processoPdfContent.ts`: função pura que monta o modelo de conteúdo (cabeçalho com protocolo/tipo/unidade/status, dados do cidadão, respostas do formulário, histórico de movimentações com autor/data/hora/observações, mensagens públicas, lista de documentos)
  - Garantir exclusão total das mensagens do canal interno
  - _Requisitos: 26.1, 26.4_

- [ ]* 22.2 Escrever property test para conteúdo do PDF (Property 15)
  - **Property 15: Completude e Exclusão de Conteúdo do PDF do Processo** — *For any* processo, o conteúdo montado contém todas as seções obrigatórias e nenhuma mensagem interna
  - **Validates: Requirements 26.1, 26.4**

- [ ] 22.3 Implementar geração síncrona e download do PDF
  - `GET /api/v1/admin/processos/:id/pdf`: verificar RBAC (`visualizar`), renderizar o PDF reutilizando a stack `toPdf` do `RelatorioWorker`, transmitir o binário para download direto
  - Registrar Auditoria (servidor, processo, data/hora); em falha, retornar `PDF_001` e permitir nova tentativa
  - _Requisitos: 26.1, 26.2, 26.3, 26.5, 26.6_

### 23. Backend — Dashboard Estendida (cards, prazos, desempenho da equipe)

- [ ] 23.1 Implementar endpoint de resumo (cards de contagem + prazos)
  - `GET /api/v1/admin/dashboard/resumo`: contagens por status (total, abertos, em andamento, aguardando docs, atrasados, aprovados, finalizados, rejeitados), indicador de prazos (vencendo em ≤3 dias úteis + vencidos com identificação), filtros `unidadeId`/`categoriaId`/`de`/`ate`, escopo por RBAC (Gestor_de_Unidade → sua unidade; Administrador → todas)
  - Cache Redis análogo ao dashboard existente
  - _Requisitos: 9.7, 9.8, 9.11, 9.12_

- [ ] 23.2 Implementar endpoint de desempenho da equipe
  - `GET /api/v1/admin/dashboard/desempenho-equipe`: por Servidor no escopo — atribuídos, em andamento, concluídos no período, atrasados sob responsabilidade, tempo médio de conclusão (h), tarefas pendentes; ordenável por qualquer indicador; respeitar filtros e RBAC
  - _Requisitos: 9.9, 9.10, 9.11, 9.12_

- [ ]* 23.3 Escrever property tests para consistência e escopo do dashboard (Properties 10 e 11)
  - **Property 10: Consistência de Agregação do Dashboard** — soma dos cards de status disjuntos = total; soma de atribuídos por servidor = total atribuído no escopo
  - **Property 11: Escopo RBAC do Dashboard** — para qualquer Gestor_de_Unidade, todos os itens computados pertencem exclusivamente à sua unidade
  - **Validates: Requirements 9.7, 9.9, 9.11, 9.12**

### 24. Backend — Permissões Granulares (round-trip)

- [ ] 24.1 Consolidar aplicação exata das permissões granulares
  - Estender `PUT /api/v1/admin/servidores/:id/permissoes` (já existente): persistir exatamente o conjunto marcado (sem adições/remoções silenciosas), invalidar o cache de permissões do servidor afetado para aplicação na próxima requisição, registrar Auditoria com anterior/posterior
  - Expor conjunto default de permissões por nível em `packages/shared` para o frontend consumir
  - Bloquear com acesso negado se sem `gerenciar_usuarios`/Administrador
  - _Requisitos: 21.10, 21.11, 21.12, 21.13_

- [ ]* 24.2 Escrever property test para round-trip de permissões (Property 12)
  - **Property 12: Round-trip Exato das Permissões Granulares** — *For any* subconjunto das 14 permissões, salvar e recarregar produz exatamente o mesmo subconjunto
  - **Validates: Requirements 21.12, 21.13**

### 25. Backend — Organizador de Tarefas da Equipe

- [ ] 25.1 Implementar CRUD de Tarefas e distribuição de atribuições
  - Criar `src/modules/tarefas/tarefas.router.ts`, `tarefas.controller.ts`, `tarefas.service.ts`
  - `POST /api/v1/admin/tarefas`: verificar RBAC (`gerenciar_tarefas`/Administrador), validar título ≤150, prazo (data+hora) futuro (senão `TAR_002`), ao menos um destinatário (senão `TAR_003`); criar `Tarefa` + uma `TarefaAtribuicao` por destinatário; destinatário "todos" → uma atribuição por Servidor ativo no momento da criação
  - `GET /` (filtros status/período/processo), `GET /:id`, `PATCH /:id`, `DELETE /:id`
  - Enfileirar Notificação `TAREFA_ATRIBUIDA` a cada destinatário (≤60s) + emit `tarefa:atribuida`
  - _Requisitos: 27.1, 27.2, 27.3, 27.4, 27.5, 27.10, 27.11, 27.12_

- [ ]* 25.2 Escrever property test para atribuição "todos" (Property 16)
  - **Property 16: Atribuição para Todos Gera Uma Atribuição por Servidor Ativo** — *For any* conjunto de servidores ativo/inativo, tarefa para "todos" gera exatamente uma atribuição por servidor ativo e nenhuma para inativos
  - **Validates: Requirements 27.4**

- [ ] 25.3 Implementar visualização e mudança de status por destinatário
  - `GET /api/v1/admin/tarefas/minhas`: tarefas do servidor autenticado agrupadas por status
  - `PATCH /api/v1/admin/tarefas/:id/atribuicoes/minha`: alterar status apenas da própria `TarefaAtribuicao` (pendente/em_andamento/concluida); ao concluir, registrar `concluidaEm`; emitir `tarefa:status_atualizado`
  - Garantir isolamento: não alterar o status das demais atribuições da mesma tarefa
  - _Requisitos: 27.6, 27.7_

- [ ]* 25.4 Escrever property test para isolamento de status (Property 17)
  - **Property 17: Isolamento de Status por Atribuição de Tarefa** — *For any* tarefa com N atribuições, alterar o status de uma não altera as demais; concluir registra `concluidaEm`
  - **Validates: Requirements 27.7**

- [ ] 25.5 Implementar `tarefa-check-queue` e notificações de prazo de tarefa
  - Criar `src/jobs/tarefa.worker.ts` (cron a cada 15min, padrão do `prazo.worker`): varrer `TarefaAtribuicao` não concluídas; para prazo em ≤24h e `notificadoProximidade=false` → enfileirar `TAREFA_PROXIMA_VENCIMENTO`, marcar flag; para prazo atingido e `notificadoVencida=false` → enfileirar `TAREFA_VENCIDA`, marcar flag
  - Atualização de flag + enfileiramento na mesma transação para garantir disparo exatamente uma vez por destinatário (idempotência); emitir `tarefa:proxima_vencimento`/`tarefa:vencida`
  - Registrar a fila em `src/jobs/index.ts`
  - _Requisitos: 27.8, 27.9_

- [ ]* 25.6 Escrever property test para notificação de prazo de tarefa (Property 18)
  - **Property 18: Notificação de Prazo de Tarefa Exatamente Uma Vez por Destinatário** — *For any* atribuição não concluída, múltiplas execuções da varredura disparam a proximidade no máximo uma vez e a vencida exatamente uma vez enquanto não concluída
  - **Validates: Requirements 27.8, 27.9**

- [ ] 25.7 Checkpoint — Backend das melhorias verificado
  - Garantir que todos os testes de propriedade novos (Properties 4 atualizada, 10–18) passam com ≥100 iterações
  - Garantir que os fluxos de abertura admin, edição corretiva, PDF, dashboard estendida e tarefas passam nos testes de integração
  - Ensure all tests pass, ask the user if questions arise.

### 26. Frontend — Gestão de Servidores com Matriz de Permissões

- [ ] 26.1 Implementar componente MatrizPermissoes e integrar ao cadastro de servidor
  - Criar `apps/web/src/features/admin/components/MatrizPermissoes.tsx`: 14 toggles independentes (uma por permissão), aplicar conjunto default ao trocar o nível de acesso, preservar ajustes manuais subsequentes
  - Integrar em `ServidoresPage` (criar/editar): enviar exatamente as permissões marcadas para `PUT /:id/permissoes`; ocultar/desabilitar edição para quem não tem `gerenciar_usuarios`/Administrador
  - Exibir feedback de sucesso e refletir permissões atualizadas
  - _Requisitos: 21.10, 21.11, 21.12, 21.13_

### 27. Frontend — Dashboard Estendida

- [ ] 27.1 Implementar cards de resumo e indicador de prazos
  - Criar `apps/web/src/features/dashboard/components/ResumoCards.tsx` e `IndicadorPrazos.tsx`: 8 cards de contagem + processos vencendo (≤3 dias úteis) e vencidos com identificação; consumir `GET /admin/dashboard/resumo`
  - Adicionar `FiltrosDashboard` (unidade, categoria, período) aplicando filtros combinados e respeitando o escopo RBAC
  - _Requisitos: 9.7, 9.8, 9.11, 9.12_

- [ ] 27.2 Implementar Painel de Desempenho da equipe
  - Criar `apps/web/src/features/dashboard/components/PainelDesempenhoEquipe.tsx`: tabela por servidor (atribuídos, em andamento, concluídos, atrasados, tempo médio, tarefas pendentes), ordenável por qualquer coluna e comparável entre servidores; consumir `GET /admin/dashboard/desempenho-equipe`
  - _Requisitos: 9.9, 9.10, 9.11, 9.12_

### 28. Frontend — Detalhe de Processo Admin (trilha, edição corretiva, upload, PDF) e Novo Processo Admin

- [ ] 28.1 Estender ProcessoDetailAdminPage com trilha de auditoria e ações pendentes
  - Adicionar `TrilhaAuditoria` (autor, ação, valor anterior/posterior, data/hora) e `AcoesPendentes` (próxima etapa, docs solicitados) ao detalhe do processo
  - Consumir `GET /admin/processos/:id` estendido e `GET /admin/processos/:id/auditoria`
  - _Requisitos: 24.1, 24.2, 24.3_

- [ ] 28.2 Implementar edição corretiva e upload de documentos no detalhe
  - `EdicaoCorretivaModal`: editável apenas com permissão `editar`; enviar `PATCH /admin/processos/:id`; exibir confirmação e refletir na trilha
  - `UploadDocumentos`: dropzone (MinIO presigned) para documentos solicitados, validação de formato/tamanho/limites com mensagens descritivas, atualização da lista de pendências
  - Botão "Gerar PDF" chamando `GET /admin/processos/:id/pdf` para download direto (visível conforme `visualizar`)
  - _Requisitos: 24.4, 24.6, 25.1, 25.2, 25.3, 25.4, 25.5, 26.1, 26.2, 26.6_

- [ ] 28.3 Implementar página de abertura de processo pelo servidor
  - Criar `apps/web/src/features/processos/NovoProcessoAdminPage.tsx`: busca de Cidadão por CPF (oferecer cadastro se não encontrado), seleção Categoria → Tipo → Unidade, `FormularioDinamicoRenderer` reutilizado, confirmação com exibição do Protocolo gerado
  - Guard de rota por permissão `editar`/Administrador; preservar dados e permitir nova tentativa em falha
  - _Requisitos: 23.1, 23.2, 23.3, 23.4, 23.5, 23.6, 23.7_

### 29. Frontend — Organizador de Tarefas

- [ ] 29.1 Implementar seção/página de tarefas com criação e destinatários
  - Criar `apps/web/src/features/tarefas/TarefasPage.tsx` + `CriarTarefaModal`: campos título, descrição, prazo (data+hora com validação de prazo futuro), prioridade, vínculo opcional a Processo, seletor de destinatários (um / vários / todos); criação exige `gerenciar_tarefas`
  - Lista com filtros por status, prazo e vínculo a processo; navegação ao processo vinculado
  - _Requisitos: 27.1, 27.2, 27.3, 27.5, 27.10, 27.11, 27.12_

- [ ] 29.2 Implementar "Minhas Tarefas" na dashboard com mudança de status
  - Criar `apps/web/src/features/tarefas/components/MinhasTarefas.tsx`: tarefas do servidor agrupadas por status (pendente/em andamento/concluída), ação para mover o status da própria atribuição, atualização em tempo real via `useSocket` (`tarefa:*`)
  - Integrar na `DashboardPage`
  - _Requisitos: 27.6, 27.7_

### 30. Testes de Integração das Melhorias e Checkpoint Final

- [ ]* 30.1 Escrever testes de integração para as melhorias do painel
  - Abertura de processo pelo servidor (busca de cidadão → protocolo com prefixo → notificação)
  - Edição corretiva com rollback em falha de auditoria (Req. 24.7)
  - Geração e download do PDF do processo (conteúdo + exclusão de mensagens internas)
  - Dashboard estendida com escopo RBAC de Gestor_de_Unidade
  - Ciclo de tarefas: criação para "todos" → mudança de status isolada → notificação de proximidade/vencida exatamente uma vez (com execuções repetidas do cron)
  - _Requisitos: 23, 24, 25, 26, 9, 27_

- [ ]* 30.2 Escrever testes E2E das melhorias com Playwright
  - Fluxo Admin: abrir processo em nome de cidadão → detalhe com trilha → edição corretiva → gerar PDF
  - Fluxo Coordenação: criar tarefa para toda a equipe → servidor conclui a própria tarefa → verificação de notificações de prazo
  - _Requisitos: 23, 24, 26, 27_

- [ ] 30.3 Checkpoint Final das Melhorias — Todos os testes verificados
  - Executar `vitest --run` em todos os pacotes; cobertura mantida nos thresholds definidos
  - Garantir que os property tests das Properties 4 (atualizada) e 10–18 passam com ≥100 iterações
  - Revisar que os requisitos 23–27 e as expansões dos Req. 4, 9 e 21 têm ao menos uma tarefa de implementação e um teste correspondente
  - Ensure all tests pass, ask the user if questions arise.

---

## Notes

- Tarefas marcadas com `*` são opcionais e podem ser puladas para MVP mais rápido, mas são altamente recomendadas para corretude
- Cada tarefa referencia requisitos específicos para rastreabilidade completa
- Checkpoints garantem validação incremental — não avançar sem passar no checkpoint anterior
- Os property tests validam as propriedades de corretude formais definidas no design.md usando `fast-check` com mínimo de 100 iterações cada (Properties 1–9 do núcleo + Property 4 atualizada e Properties 10–18 das melhorias do painel administrativo)
- As melhorias do painel administrativo (seções 19–30) introduzem três decisões de design que requerem confirmação do usuário: (F) formato de Protocolo com prefixo por Unidade/Categoria; (G) nova permissão `gerenciar_tarefas` vs. reutilizar `gerenciar_usuarios`; (E) geração de PDF síncrona para um único processo. Ver NOTAS DE DESIGN em design.md
- As tarefas 1–18 permanecem inalteradas; nenhuma foi renumerada ou reaberta
- O `packages/shared` deve ser o primeiro pacote compilado, pois `apps/api` e `apps/web` dependem dele
- Upload de arquivos usa presigned URLs do MinIO — a API nunca recebe o binário do arquivo diretamente
- Toda transação de avanço de etapa deve registrar auditoria dentro da mesma transação Prisma; falha na auditoria causa rollback
- O sistema de notificações é 100% assíncrono via BullMQ — nenhum endpoint bloqueia aguardando envio de email/SMS
- Feature flags por variável de ambiente para módulos opcionais (push notification, SMS gateway)

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3"] },
    { "id": 2, "tasks": ["1.4", "1.5"] },
    { "id": 3, "tasks": ["1.6", "1.7", "1.8"] },
    { "id": 4, "tasks": ["2.1", "2.4", "1.9"] },
    { "id": 5, "tasks": ["2.2", "2.6", "2.8"] },
    { "id": 6, "tasks": ["2.3", "2.5", "2.7"] },
    { "id": 7, "tasks": ["3.1", "5.1", "5.2", "5.3", "2.9"] },
    { "id": 8, "tasks": ["3.2", "3.3", "5.4", "5.7", "6.1"] },
    { "id": 9, "tasks": ["3.4", "3.5", "3.6", "5.5", "5.6", "5.8", "6.2"] },
    { "id": 10, "tasks": ["3.7", "7.1", "7.4"] },
    { "id": 11, "tasks": ["3.8", "7.2", "7.3", "7.5", "4.1", "4.3"] },
    { "id": 12, "tasks": ["7.6", "8.1", "10.1", "4.2"] },
    { "id": 13, "tasks": ["7.7", "7.8", "8.2", "10.2", "10.3"] },
    { "id": 14, "tasks": ["7.9", "9.1", "9.2"] },
    { "id": 15, "tasks": ["9.3", "11.1"] },
    { "id": 16, "tasks": ["11.2", "11.3"] },
    { "id": 17, "tasks": ["12.1", "12.2", "14.1"] },
    { "id": 18, "tasks": ["12.3", "13.1", "14.2"] },
    { "id": 19, "tasks": ["13.2", "15.1"] },
    { "id": 20, "tasks": ["13.3", "15.2", "16.1"] },
    { "id": 21, "tasks": ["15.3", "16.2", "16.3", "17.1"] },
    { "id": 22, "tasks": ["16.4", "17.2", "17.3"] },
    { "id": 23, "tasks": ["18.1", "18.2"] },
    { "id": 24, "tasks": ["18.3"] },
    { "id": 25, "tasks": ["19.1"] },
    { "id": 26, "tasks": ["19.2", "24.1"] },
    { "id": 27, "tasks": ["19.3", "20.1", "23.1", "23.2", "24.2"] },
    { "id": 28, "tasks": ["20.2", "21.1", "22.1", "25.1", "23.3"] },
    { "id": 29, "tasks": ["21.2", "21.4", "22.2", "22.3", "25.2", "25.3"] },
    { "id": 30, "tasks": ["21.3", "21.5", "25.4", "25.5"] },
    { "id": 31, "tasks": ["25.6", "26.1", "27.1", "27.2"] },
    { "id": 32, "tasks": ["28.1", "28.3", "29.1"] },
    { "id": 33, "tasks": ["28.2", "29.2"] },
    { "id": 34, "tasks": ["30.1", "30.2"] }
  ]
}
```
