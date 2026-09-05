import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/cn';
import type { NavItem } from './navConfig';

export interface NavMenuProps {
  /** Itens já filtrados por RBAC (ver `getNavItems`). */
  items: NavItem[];
  /** Quando true, exibe apenas ícones (sidebar recolhida no desktop). */
  collapsed?: boolean;
  /** Callback disparado ao navegar (usado para fechar o overlay mobile). */
  onNavigate?: () => void;
}

/**
 * Menu de navegação vertical. Usa `NavLink` para aplicar estilo de item ativo
 * automaticamente e mantém cada item com alvo de toque de 44px.
 */
export function NavMenu({ items, collapsed = false, onNavigate }: NavMenuProps) {
  return (
    <nav aria-label="Navegação principal" className="flex flex-col gap-1 p-2">
      {items.map(({ label, to, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          title={collapsed ? label : undefined}
          className={({ isActive }) =>
            cn(
              'flex min-h-touch items-center gap-3 rounded-btn px-3 py-2 font-body text-sm font-medium',
              'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
              collapsed && 'justify-center',
              isActive
                ? 'bg-primary-light text-primary'
                : 'text-text-secondary hover:bg-bg-alt hover:text-text-primary',
            )
          }
        >
          {({ isActive }) => (
            <>
              <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
              {!collapsed && <span className="truncate">{label}</span>}
              {/* Marcador acessível do item ativo para leitores de tela. */}
              {isActive && <span className="sr-only">(página atual)</span>}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export default NavMenu;
