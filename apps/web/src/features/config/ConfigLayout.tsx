import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/lib/cn';

/**
 * Layout das Configurações Administrativas.
 *
 * Hospeda as três páginas de configuração (Categorias, Tipos de processo e
 * Unidades) sob `/admin/config/*` por meio de uma subnavegação em abas. Cada
 * aba é uma rota filha renderizada no `<Outlet />`.
 *
 * As abas usam `NavLink` (navegação acessível por teclado, com estado `active`
 * refletido em `aria-current`), preservando o histórico do navegador.
 *
 * _Requirements: 14.1–14.7_
 */

interface AbaConfig {
  to: string;
  label: string;
  /** `end` garante que a rota índice não fique ativa junto das filhas. */
  end?: boolean;
}

const ABAS: AbaConfig[] = [
  { to: '/admin/config/categorias', label: 'Categorias' },
  { to: '/admin/config/tipos', label: 'Tipos de processo' },
  { to: '/admin/config/unidades', label: 'Unidades' },
  { to: '/admin/config/fluxos', label: 'Fluxos' },
  { to: '/admin/config/formularios', label: 'Formulários' },
];

export function ConfigLayout() {
  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="font-heading text-2xl font-semibold text-text-primary">Configurações</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Gerencie categorias, tipos de processo e unidades do sistema.
        </p>
      </header>

      <nav aria-label="Seções de configuração" className="border-b border-bg-alt">
        <ul className="flex flex-wrap gap-1">
          {ABAS.map((aba) => (
            <li key={aba.to}>
              <NavLink
                to={aba.to}
                end={aba.end}
                className={({ isActive }) =>
                  cn(
                    'inline-flex min-h-touch items-center border-b-2 px-4 py-2 text-sm font-medium',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    isActive
                      ? 'border-primary text-primary'
                      : 'border-transparent text-text-secondary hover:text-text-primary',
                  )
                }
              >
                {aba.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <Outlet />
    </section>
  );
}

export default ConfigLayout;
