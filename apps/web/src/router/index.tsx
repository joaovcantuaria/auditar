import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '@/components/layout';
import { PagePlaceholder } from './PagePlaceholder';
import { PrivateRoute, RoleRoute } from './guards';
import { LoginPage } from '@/features/auth/LoginPage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { ActivatePage } from '@/features/auth/ActivatePage';
import { MeusProcessosPage } from '@/features/cidadao/MeusProcessosPage';
import { PerfilPage } from '@/features/cidadao/PerfilPage';
import { ConfiguracoesPage } from '@/features/cidadao/ConfiguracoesPage';
import { AdminLoginPage } from '@/features/auth/AdminLoginPage';
import { AdminShell } from '@/components/layout/AdminShell';
import { ProcessoDetalhePage } from '@/features/cidadao/ProcessoDetalhePage';
import { NovoProcessoWizard } from '@/features/cidadao/wizard';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { AuditoriaPage } from '@/features/auditoria/AuditoriaPage';
import { RelatoriosPage } from '@/features/relatorios/RelatoriosPage';
import { ServidoresPage } from '@/features/admin/ServidoresPage';
import { ProcessosPage } from '@/features/processos-admin/ProcessosPage';
import { NovoProcessoAdminPage } from '@/features/processos-admin/NovoProcessoAdminPage';
import { TarefasPage } from '@/features/tarefas/TarefasPage';
import { ProcessoDetalheAdminPage } from '@/features/processos-admin/ProcessoDetalheAdminPage';
import {
  ConfigLayout,
  CategoriasPage,
  TiposProcessoPage,
  UnidadesPage,
  FluxosPage,
  FormulariosPage,
} from '@/features/config';

/**
 * Configuração de rotas (React Router v6, `createBrowserRouter`).
 *
 * Estrutura:
 * - Rotas públicas de autenticação (Portal do Cidadão e Painel do Servidor).
 * - Rotas protegidas do Portal do Cidadão, agrupadas sob o `AppShell` e
 *   restritas ao papel `cidadao`.
 * - Rotas protegidas do Painel Administrativo (`/admin/*`), sob o `AppShell` e
 *   restritas ao papel `servidor`.
 *
 * As páginas de funcionalidade são implementadas nas tarefas 12–17; aqui elas
 * são representadas por `PagePlaceholder` para validar a estrutura e os guards.
 *
 * _Requirements: 8.3, 8.4_
 */
export const router = createBrowserRouter([
  // --- Portal do Cidadão — rotas públicas ---------------------------------
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/registrar',
    element: <RegisterPage />,
  },
  {
    // O link do e-mail aponta para `/ativar/:token` (ver backend
    // `auth.cidadao.email.ts`). Mantemos também `/ativar` para o fallback via
    // query string (`?token=`).
    path: '/ativar/:token',
    element: <ActivatePage />,
  },
  {
    path: '/ativar',
    element: <ActivatePage />,
  },
  {
    path: '/recuperar-senha',
    element: <PagePlaceholder title="Recuperar senha" />,
  },
  {
    path: '/nova-senha',
    element: <PagePlaceholder title="Definir nova senha" />,
  },

  // --- Painel Administrativo — login público ------------------------------
  {
    path: '/admin/login',
    element: <AdminLoginPage />,
  },

  // --- Portal do Cidadão — rotas protegidas -------------------------------
  {
    element: <PrivateRoute loginPath="/login" />,
    children: [
      {
        element: <RoleRoute role="cidadao" redirectTo="/admin" />,
        children: [
          {
            element: <AppShell />,
            children: [
              {
                index: true,
                element: <MeusProcessosPage />,
              },
              {
                path: 'processos',
                element: <MeusProcessosPage />,
              },
              {
                path: 'processos/novo',
                element: <NovoProcessoWizard />,
              },
              {
                path: 'processos/:id',
                element: <ProcessoDetalhePage />,
              },
              {
                path: 'perfil',
                element: <PerfilPage />,
              },
              {
                path: 'configuracoes',
                element: <ConfiguracoesPage />,
              },
            ],
          },
        ],
      },
    ],
  },

  // --- Painel Administrativo — rotas protegidas ---------------------------
  {
    path: '/admin',
    element: <PrivateRoute loginPath="/admin/login" />,
    children: [
      {
        element: <RoleRoute role="servidor" redirectTo="/" />,
        children: [
          {
            element: <AdminShell />,
            children: [
              {
                index: true,
                element: <DashboardPage />,
              },
              {
                path: 'processos',
                element: <ProcessosPage />,
              },
              {
                // Rota mais específica ANTES de `processos/:id` para não colidir:
                // do contrário `novo` seria capturado como `:id`.
                path: 'processos/novo',
                element: <NovoProcessoAdminPage />,
              },
              {
                path: 'processos/:id',
                element: <ProcessoDetalheAdminPage />,
              },
              {
                path: 'config',
                element: <ConfigLayout />,
                children: [
                  {
                    index: true,
                    element: <Navigate to="categorias" replace />,
                  },
                  {
                    path: 'categorias',
                    element: <CategoriasPage />,
                  },
                  {
                    path: 'tipos',
                    element: <TiposProcessoPage />,
                  },
                  {
                    path: 'unidades',
                    element: <UnidadesPage />,
                  },
                  {
                    path: 'fluxos',
                    element: <FluxosPage />,
                  },
                  {
                    path: 'formularios',
                    element: <FormulariosPage />,
                  },
                ],
              },
              {
                path: 'servidores',
                element: <ServidoresPage />,
              },
              {
                path: 'tarefas',
                element: <TarefasPage />,
              },
              {
                path: 'relatorios',
                element: <RelatoriosPage />,
              },
              {
                path: 'auditoria',
                element: <AuditoriaPage />,
              },
            ],
          },
        ],
      },
    ],
  },

  // --- Fallback -----------------------------------------------------------
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
]);

export default router;
