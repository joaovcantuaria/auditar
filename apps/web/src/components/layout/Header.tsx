import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { BreadcrumbNav } from './BreadcrumbNav';
import { NotificationBell } from './NotificationBell';
import { UserMenu } from './UserMenu';
import { MenuIcon } from './icons';

export interface HeaderProps {
  /** Rota de destino do logo (Portal ou Painel). */
  homeTo?: string;
  /** Abre a sidebar como overlay em telas estreitas. */
  onOpenMobileSidebar?: () => void;
}

/**
 * Barra superior fixa (64px). Contém o botão de menu mobile, o logo/nome do
 * app, a trilha de navegação, o sino de notificações e o menu do usuário.
 * Todos os controles interativos respeitam o alvo de toque de 44px e possuem
 * rótulos acessíveis.
 */
export function Header({ homeTo = '/', onOpenMobileSidebar }: HeaderProps) {
  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-30 flex h-header items-center gap-3 border-b border-neutral/15 bg-white px-3 sm:px-4',
      )}
    >
      {/* Botão de menu — visível apenas em telas estreitas (< lg). */}
      {onOpenMobileSidebar && (
        <button
          type="button"
          onClick={onOpenMobileSidebar}
          aria-label="Abrir menu lateral"
          className={cn(
            'inline-flex min-h-touch min-w-touch items-center justify-center rounded-btn lg:hidden',
            'text-text-secondary hover:bg-bg-alt hover:text-text-primary',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
          )}
        >
          <MenuIcon />
        </button>
      )}

      <Link
        to={homeTo}
        className="flex items-center gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span
          aria-hidden="true"
          className="flex h-8 w-8 items-center justify-center rounded-btn bg-primary font-heading text-sm font-bold text-white"
        >
          A
        </span>
        <span className="font-heading text-lg font-bold text-primary">Auditar</span>
      </Link>

      {/* Trilha de navegação — ocultada em telas muito estreitas. */}
      <div className="hidden min-w-0 flex-1 md:block">
        <BreadcrumbNav />
      </div>

      {/* Espaçador para empurrar as ações à direita quando a trilha está oculta. */}
      <div className="flex-1 md:hidden" />

      <div className="flex items-center gap-1 sm:gap-2">
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );
}

export default Header;
