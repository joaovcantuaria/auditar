import { Outlet } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/store/authStore';
import { useUiStore } from '@/store/uiStore';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

/**
 * Layout autenticado: Header fixo (64px) + Sidebar fixa/colapsável (280px) +
 * área de conteúdo principal que renderiza a rota filha via `<Outlet/>`.
 *
 * Responsividade:
 * - Desktop (lg+): a sidebar ocupa o fluxo; o `<main>` recebe padding-left
 *   correspondente à largura atual (recolhida ou não).
 * - Telas estreitas: a sidebar vira overlay e o `<main>` usa a largura total.
 */
export function AppShell() {
  const user = useAuthStore((s) => s.user);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const openMobileSidebar = useUiStore((s) => s.openMobileSidebar);

  const homeTo = user?.role === 'servidor' ? '/admin' : '/';

  return (
    <div className="min-h-screen bg-bg-alt font-body text-text-primary">
      <Header homeTo={homeTo} onOpenMobileSidebar={openMobileSidebar} />
      <Sidebar />

      <main
        className={cn(
          'min-h-[calc(100vh-theme(spacing.header))] pt-header transition-[padding] duration-200',
          // Compensa a largura da sidebar no desktop conforme o colapso.
          collapsed ? 'lg:pl-16' : 'lg:pl-sidebar',
        )}
      >
        <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export default AppShell;
