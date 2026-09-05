import 'dotenv/config';
import express, { Router } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';

// Routers dos módulos (importados sempre a partir do barrel de cada módulo,
// exceto unidades/servidores que não possuem barrel — ver nota abaixo).
import { authRouter } from './modules/auth/index.js';
import { cidadaosRouter, cidadaosAdminRouter } from './modules/cidadaos/index.js';
import { conta2faRouter } from './modules/cidadaos/conta2fa.router.js';
import {
  processosCidadaoRouter,
  processosDetalheRouter,
  documentosRouter,
  mensagensCidadaoRouter,
  mensagensServidorRouter,
  mensagensInternoRouter,
  processosAdminRouter,
  processosTramitacaoRouter,
  processosAtribuicaoRouter,
} from './modules/processos/index.js';
import { categoriasRouter } from './modules/categorias/index.js';
import { tiposProcessoRouter } from './modules/tipos-processo/index.js';
// unidades e servidores não expõem barrel (index.js); importa-se o router direto.
import { unidadesRouter } from './modules/unidades/unidades.router.js';
import { fluxosRouter } from './modules/fluxos/index.js';
import { formulariosRouter, formulariosPublicRouter } from './modules/formularios/index.js';
import { servidoresRouter } from './modules/servidores/servidores.router.js';
import { dashboardRouter } from './modules/dashboard/index.js';
import { relatoriosRouter } from './modules/relatorios/index.js';
import { auditoriaRouter } from './modules/auditoria/index.js';
import { tarefasRouter } from './modules/tarefas/index.js';

const app = express();

// Security headers
app.use(helmet());

// CORS
const allowedOrigins = env.CORS_ORIGINS.split(',').map((o) => o.trim());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    credentials: true,
  }),
);

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Rate limiting for public routes
app.use(
  '/api',
  rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests', retryAfter: Math.ceil(env.RATE_LIMIT_WINDOW_MS / 1000) },
  }),
);

// Health check (no auth required)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: '@auditar/api', timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// Agregador de rotas da API (v1)
// ---------------------------------------------------------------------------
// Todos os módulos são montados sob `/api/v1`. Sub-routers com `:id`
// (documentos, mensagens) usam `mergeParams` internamente para enxergar o
// parâmetro `:id` do prefixo.
const apiRouter = Router();

// Autenticação — authRouter já expõe /cidadao e /servidor internamente.
apiRouter.use('/auth', authRouter);

// Cidadão — gestão de conta (perfil, e-mail, senha, preferências) + 2FA.
apiRouter.use('/cidadao/conta', cidadaosRouter);
apiRouter.use('/cidadao/conta', conta2faRouter);

// Processos (Cidadão) — prefixo compartilhado `/processos`.
// processosCidadaoRouter (GET /, POST /) e processosDetalheRouter
// (GET /:id, /:id/historico, /:id/mensagens) não colidem. As mensagens
// públicas (POST) montam em subcaminho `:id` e são apenas método POST, então
// não colidem com o GET de listagem do detalhe. Detalhe antes de mensagens
// para previsibilidade.
apiRouter.use('/processos', processosCidadaoRouter);
apiRouter.use('/processos', processosDetalheRouter);
apiRouter.use('/processos/:id/documentos', documentosRouter);
apiRouter.use('/processos/:id/mensagens', mensagensCidadaoRouter);

// Formulários públicos — GET / (por tipoId + unidadeId).
apiRouter.use('/formularios', formulariosPublicRouter);

// Admin — processos: prefixo compartilhado `/admin/processos`.
// Admin (GET /) → tramitação (/:id, ações) → atribuição (/:id/atribuir*).
apiRouter.use('/admin/processos', processosAdminRouter);
apiRouter.use('/admin/processos', processosTramitacaoRouter);
apiRouter.use('/admin/processos', processosAtribuicaoRouter);
apiRouter.use('/admin/processos/:id/documentos', documentosRouter);
apiRouter.use('/admin/processos/:id/mensagens', mensagensServidorRouter);
apiRouter.use('/admin/processos/:id/mensagens/internas', mensagensInternoRouter);

// Admin — configuração.
apiRouter.use('/admin/config/categorias', categoriasRouter);
apiRouter.use('/admin/config/tipos-processo', tiposProcessoRouter);
apiRouter.use('/admin/config/unidades', unidadesRouter);
apiRouter.use('/admin/config/fluxos', fluxosRouter);
apiRouter.use('/admin/config/formularios', formulariosRouter);

// Admin — busca de Cidadão por CPF para abertura de Processo (Req. 23.2, 23.3).
apiRouter.use('/admin/cidadaos', cidadaosAdminRouter);

// Admin — outros.
apiRouter.use('/admin/servidores', servidoresRouter);
apiRouter.use('/admin/dashboard', dashboardRouter);
apiRouter.use('/admin/relatorios', relatoriosRouter);
apiRouter.use('/admin/auditoria', auditoriaRouter);
apiRouter.use('/admin/tarefas', tarefasRouter);

app.use('/api/v1', apiRouter);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found', code: 'SYS_002' });
});

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[express] unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error', code: 'SYS_002' });
});

export default app;
