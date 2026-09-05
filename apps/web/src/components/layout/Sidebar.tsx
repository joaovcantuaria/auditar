import { cn } from '@/lib/cn';
import { useAuthStore } from '@/store/authStore';
import { useUiStore } from '@/store/uiStore';
import { CollapseButton } from './CollapseButton';
import { NavMenu } from './NavMenu';
import { getNavItems } from './navConfig';
import { CloseIcon } from './icons';

/**
 * Menu lateral (280px). No desktop (lg+) é fixo e pode ser recolhido para uma
 * faixa estreita de ícones. Em telas estreitas vira um overlay controlado por
 * `mobileSidebarOpen`, com backdrop clicável.
 *
 * Os itens do menu dependem do papel/permissões do usuário (RBAC), resolvidos
 * por `getNavItems`.
 */
export function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const mobileOpen = useUiStore((s) => s.mobileSidebarOpen);
  const closeMobileSidebar = useUiStore((s) => s.closeMobileSidebar);

  const items = getNavItems(user);

  return (
    <>
      {/* Backdrop do overlay mobile. */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          aria-hidden="true"
          onClick={closeMobileSidebar}
        />
      )}

      <aside
        aria-label="Menu lateral"
        className={cn(
          'fixed left-0 top-header z-30 flex h-[calc(100vh-theme(spacing.header))] flex-col border-r border-neutral/15 bg-white transition-[width,transform] duration-200',
          // Largura desktop conforme colapso.
          collapsed ? 'lg:w-16' : 'lg:w-sidebar',
          // Mobile: largura fixa + desliza para dentro/fora da tela.
          'w-sidebar max-w-[85vw]',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        {/* Cabeçalho do overlay mobile: botão de fechar. */}
        <div className="flex items-center justify-end px-2 py-2 lg:hidden">
          <button
            type="button"
            onClick={closeMobileSidebar}
            aria-label="Fechar menu lateral"
            className={cn(
              'inline-flex min-h-touch min-w-touch items-center justify-center rounded-btn',
              'text-text-secondary hover:bg-bg-alt hover:text-text-primary',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
            )}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <NavMenu items={items} collapsed={collapsed} onNavigate={closeMobileSidebar} />
        </div>

        {/* Botão de colapso — apenas no desktop. */}
        <div
          className={cn(
            'hidden border-t border-neutral/15 p-2 lg:flex',
            collapsed ? 'justify-center' : 'justify-end',
          )}
        >
          <CollapseButton collapsed={collapsed} onToggle={toggleSidebar} />
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
