import { useQuery } from '@tanstack/react-query';
import type { Categoria, Unidade } from '@auditar/shared';
import { Button, DatePicker, Select } from '@/components/ui';
import type { SelectOption } from '@/components/ui/Select';
import { axiosInstance } from '@/lib/axiosInstance';
import type { FiltrosDashboardEstado } from '../dashboardEstendida.types';

/**
 * Filtros combináveis do Dashboard estendido (Task 27.1, Req 9.11):
 * unidade, categoria e período (de/até). O estado é controlado pelo componente
 * pai (`DashboardPage`), que propaga os filtros aos fetches de resumo e
 * desempenho.
 *
 * As opções de unidade/categoria vêm de `GET /admin/config/unidades` e
 * `GET /admin/config/categorias` (ambos respondem `{ data: [...] }`). Apenas as
 * unidades/categorias ativas são oferecidas.
 *
 * O escopo RBAC é resolvido no backend; aqui só enviamos filtros opcionais — um
 * Gestor_de_Unidade que selecione outra unidade não vaza dados, pois o backend
 * ignora filtros divergentes do seu escopo.
 */

export interface FiltrosDashboardProps {
  /** Estado atual dos filtros (controlado pelo pai). */
  filtros: FiltrosDashboardEstado;
  /** Notifica o pai com o novo estado completo dos filtros. */
  onChange: (filtros: FiltrosDashboardEstado) => void;
}

async function listarUnidades(): Promise<Unidade[]> {
  const { data } = await axiosInstance.get<{ data: Unidade[] }>('/admin/config/unidades', {
    params: { ativa: true },
  });
  return data.data;
}

async function listarCategorias(): Promise<Categoria[]> {
  const { data } = await axiosInstance.get<{ data: Categoria[] }>('/admin/config/categorias');
  return data.data;
}

export function FiltrosDashboard({ filtros, onChange }: FiltrosDashboardProps) {
  const { data: unidades } = useQuery({
    queryKey: ['dashboard', 'filtros', 'unidades'],
    queryFn: listarUnidades,
    staleTime: 5 * 60 * 1000,
  });

  const { data: categorias } = useQuery({
    queryKey: ['dashboard', 'filtros', 'categorias'],
    queryFn: listarCategorias,
    staleTime: 5 * 60 * 1000,
  });

  const unidadeOptions: SelectOption[] = (unidades ?? [])
    .filter((u) => u.ativa)
    .map((u) => ({ label: u.nome, value: u.id }));

  const categoriaOptions: SelectOption[] = (categorias ?? [])
    .filter((c) => c.ativa)
    .map((c) => ({ label: c.nome, value: c.id }));

  /** Atualiza uma chave do estado, tratando string vazia como "sem filtro". */
  function atualizar<K extends keyof FiltrosDashboardEstado>(
    chave: K,
    valor: string,
  ): void {
    onChange({ ...filtros, [chave]: valor === '' ? undefined : valor });
  }

  const temFiltros = Boolean(
    filtros.unidadeId || filtros.categoriaId || filtros.de || filtros.ate,
  );

  return (
    <section
      className="flex flex-col gap-4 rounded-card border border-neutral/30 bg-white p-4 shadow-sm"
      aria-label="Filtros do dashboard"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          label="Unidade"
          placeholder="Todas as unidades"
          options={unidadeOptions}
          value={filtros.unidadeId ?? ''}
          onChange={(e) => atualizar('unidadeId', e.target.value)}
        />
        <Select
          label="Categoria"
          placeholder="Todas as categorias"
          options={categoriaOptions}
          value={filtros.categoriaId ?? ''}
          onChange={(e) => atualizar('categoriaId', e.target.value)}
        />
        <DatePicker
          label="De"
          value={filtros.de ?? ''}
          max={filtros.ate || undefined}
          onChange={(e) => atualizar('de', e.target.value)}
        />
        <DatePicker
          label="Até"
          value={filtros.ate ?? ''}
          min={filtros.de || undefined}
          onChange={(e) => atualizar('ate', e.target.value)}
        />
      </div>

      {temFiltros && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => onChange({})}>
            Limpar filtros
          </Button>
        </div>
      )}
    </section>
  );
}

export default FiltrosDashboard;
