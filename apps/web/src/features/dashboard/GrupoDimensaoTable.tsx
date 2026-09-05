import { StatusProcesso } from '@auditar/shared';
import { STATUS_LABEL_MAP } from '@/components/ui';
import type { GrupoDimensao } from './dashboard.types';
import { STATUS_KEYS } from './dashboard.types';

export interface GrupoDimensaoTableProps {
  grupos: GrupoDimensao[];
  /** Rótulo da primeira coluna (ex.: "Unidade" ou "Categoria"). */
  dimensao: string;
}

/**
 * Tabela de totais por status agrupados por dimensão (unidade/categoria) — usada
 * nos dashboards de Gestor de Categoria (Req 9.3) e Gestor Geral (Req 9.4).
 * Cada linha é um grupo; cada coluna é um status conhecido, com o total (0
 * quando ausente) e uma coluna final de total geral do grupo.
 */
export function GrupoDimensaoTable({ grupos, dimensao }: GrupoDimensaoTableProps) {
  if (grupos.length === 0) {
    return <p className="text-sm text-text-secondary">Sem dados no período.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">
          Totais de processos por status agrupados por {dimensao.toLowerCase()}
        </caption>
        <thead>
          <tr className="border-b border-neutral/30 text-left">
            <th scope="col" className="py-2 pr-3 font-semibold text-text-secondary">
              {dimensao}
            </th>
            {STATUS_KEYS.map((status) => (
              <th
                key={status as string}
                scope="col"
                className="px-2 py-2 text-right font-medium text-text-secondary"
              >
                {STATUS_LABEL_MAP[status as StatusProcesso]}
              </th>
            ))}
            <th scope="col" className="px-2 py-2 text-right font-semibold text-text-secondary">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {grupos.map((grupo) => {
            const total = STATUS_KEYS.reduce(
              (acc, status) => acc + (grupo.porStatus[status] ?? 0),
              0,
            );
            return (
              <tr key={grupo.id} className="border-b border-neutral/15">
                <th scope="row" className="py-2 pr-3 text-left font-medium text-text-primary">
                  {grupo.nome}
                </th>
                {STATUS_KEYS.map((status) => (
                  <td key={status as string} className="px-2 py-2 text-right text-text-primary">
                    {grupo.porStatus[status] ?? 0}
                  </td>
                ))}
                <td className="px-2 py-2 text-right font-semibold text-text-primary">{total}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default GrupoDimensaoTable;
