import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NivelAcesso } from '@auditar/shared';
import { cn } from '@/lib/cn';
import { disconnectSocket } from '@/lib/socketClient';
import { useAuthStore, type AuthUser } from '@/store/authStore';
import { ChevronDownIcon, LogoutIcon } from './icons';

/** Rótulos legíveis por nível de acesso do servidor. */
const NIVEL_LABEL: Record<NivelAcesso, string> = {
  [NivelAcesso.ADMINISTRADOR]: 'Administrador',
  [NivelAcesso.GESTOR_GERAL]: 'Gestor Geral',
  [NivelAcesso.GESTOR_CATEGORIA]: 'Gestor de Categoria',
  [NivelAcesso.GESTOR_UNIDADE]: 'Gestor de Unidade',
  [NivelAcesso.ANALISTA]: 'Analista',
  [NivelAcesso.INSPETOR]: 'Inspetor',
  [NivelAcesso.VISUALIZADOR]: 'Visualizador',
};

/** Texto do papel exibido sob o nome do usuário. */
function roleLabel(user: AuthUser): string {
  if (user.role === 'cidadao') return 'Cidadão';
  if (user.nivel != null && user.nivel in NIVEL_LABEL) {
    return NIVEL_LABEL[user.nivel as NivelAcesso];
  }
  return 'Servidor';
}

/** Nome de exibição com fallback para o papel. */
function displayName(user: AuthUser): string {
  return user.nome?.trim() || roleLabel(user);
}

/** Iniciais para o avatar. */
function initials(user: AuthUser): string {
  const source = displayName(user);
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Menu do usuário no Header: mostra nome/papel e um dropdown com a ação de
 * logout. O logout limpa o authStore e redireciona ao login apropriado.
 */
export function UserMenu() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  const handleLogout = () => {
    const target = user.role === 'servidor' ? '/admin/login' : '/login';
    // Encerra a conexão em tempo real antes de limpar a sessão.
    disconnectSocket();
    logout();
    setOpen(false);
    navigate(target, { replace: true });
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={cn(
          'flex min-h-touch items-center gap-2 rounded-btn px-2 py-1',
          'text-text-primary hover:bg-bg-alt',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        )}
      >
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white"
        >
          {initials(user)}
        </span>
        <span className="hidden flex-col items-start leading-tight sm:flex">
          <span className="max-w-[10rem] truncate text-sm font-medium">
            {displayName(user)}
          </span>
          <span className="text-xs text-text-secondary">{roleLabel(user)}</span>
        </span>
        <ChevronDownIcon className="h-4 w-4 text-text-secondary" />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Menu do usuário"
          className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-card border border-neutral/20 bg-white shadow-lg"
        >
          <div className="flex items-center gap-3 border-b border-neutral/15 px-4 py-3">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white"
            >
              {initials(user)}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium text-text-primary">
                {displayName(user)}
              </span>
              <span className="text-xs text-text-secondary">{roleLabel(user)}</span>
            </span>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            className={cn(
              'flex w-full min-h-touch items-center gap-2 px-4 py-2 text-left text-sm text-danger',
              'hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-danger',
            )}
          >
            <LogoutIcon className="h-4 w-4" aria-hidden="true" />
            Sair
          </button>
        </div>
      )}
    </div>
  );
}

export default UserMenu;
