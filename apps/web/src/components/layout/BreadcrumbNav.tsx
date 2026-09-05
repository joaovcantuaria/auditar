import { Fragment, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { ChevronRightIcon } from './icons';

/** Rótulos legíveis para segmentos de rota conhecidos. */
const SEGMENT_LABELS: Record<string, string> = {
  '': 'Início',
  admin: 'Painel',
  processos: 'Processos',
  novo: 'Novo',
  perfil: 'Perfil',
  configuracoes: 'Configurações',
  config: 'Configurações',
  servidores: 'Servidores',
  relatorios: 'Relatórios',
  auditoria: 'Auditoria',
  categorias: 'Categorias',
  tipos: 'Tipos',
  unidades: 'Unidades',
  fluxos: 'Fluxos',
  formularios: 'Formulários',
  login: 'Login',
  registrar: 'Cadastro',
  ativar: 'Ativação',
};

interface Crumb {
  label: string;
  to: string;
  isLast: boolean;
}

/** Transforma um segmento cru em rótulo legível (fallback capitaliza). */
function labelFor(segment: string): string {
  if (segment in SEGMENT_LABELS) return SEGMENT_LABELS[segment];
  // Ids/params: encurta um UUID/valor longo para não poluir a trilha.
  if (segment.length > 12) return `${segment.slice(0, 8)}…`;
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

/**
 * Trilha de navegação derivada do `pathname` atual. Cada segmento é um link
 * acumulativo, exceto o último (página atual), marcado com `aria-current`.
 */
export function BreadcrumbNav({ className }: { className?: string }) {
  const { pathname } = useLocation();

  const crumbs = useMemo<Crumb[]>(() => {
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length === 0) return [];

    let acc = '';
    return segments.map((segment, index) => {
      acc += `/${segment}`;
      return {
        label: labelFor(segment),
        to: acc,
        isLast: index === segments.length - 1,
      };
    });
  }, [pathname]);

  if (crumbs.length === 0) return null;

  return (
    <nav aria-label="Trilha de navegação" className={cn('min-w-0', className)}>
      <ol className="flex items-center gap-1 text-sm text-text-secondary">
        {crumbs.map((crumb) => (
          <Fragment key={crumb.to}>
            <li className="min-w-0">
              {crumb.isLast ? (
                <span aria-current="page" className="truncate font-medium text-text-primary">
                  {crumb.label}
                </span>
              ) : (
                <Link
                  to={crumb.to}
                  className="truncate rounded hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {crumb.label}
                </Link>
              )}
            </li>
            {!crumb.isLast && (
              <li aria-hidden="true" className="flex items-center">
                <ChevronRightIcon className="h-4 w-4" />
              </li>
            )}
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}

export default BreadcrumbNav;
