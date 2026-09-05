import { useLocation } from 'react-router-dom';

export interface PagePlaceholderProps {
  /** Título da página futura. */
  title: string;
  /** Descrição opcional do que será implementado aqui. */
  description?: string;
}

/**
 * Placeholder leve para rotas cujas páginas serão implementadas em tarefas
 * posteriores (grupos 12–17). Renderiza o título, uma descrição e o caminho
 * atual, para facilitar a verificação da estrutura de rotas.
 */
export function PagePlaceholder({ title, description }: PagePlaceholderProps) {
  const { pathname } = useLocation();
  return (
    <section className="rounded-card border border-dashed border-neutral/40 bg-white p-8">
      <h1 className="font-heading text-h2 text-text-primary">{title}</h1>
      {description && <p className="mt-2 text-text-secondary">{description}</p>}
      <p className="mt-4 text-sm text-text-secondary">
        Em construção — rota <code className="rounded bg-bg-alt px-1">{pathname}</code>.
      </p>
    </section>
  );
}

export default PagePlaceholder;
