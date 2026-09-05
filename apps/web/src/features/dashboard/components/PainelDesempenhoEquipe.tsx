import { Alert } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { Indicador } from '../dashboard.types';
import type {
  DesempenhoServidor,
  OrdenarDesempenhoPor,
} from '../dashboardEstendida.types';

/**
 * Painel de Desempenho da equipe (Task 27.2, Req 9.9/9.10): tabela por Servidor
 * com colunas nome, atribuídos, em andamento, concluídos, atrasados, tempo médio
 * (h) e tarefas pendentes. Qualquer coluna é ordenável: clicar no cabeçalho
 * define `ordenarPor` e o pai refaz o fetch com o novo parâmetro.
 *
 * A ordenação efetiva é feita pelo backend (`?ordenarPor=`), então este
 * componente é "controlado": recebe `ordenarPor` atual e propaga a troca via
 * `onOrdenarPorChange`.
 *
 * Recebe o indicador de `GET /admin/dashboard/desempenho-equipe`
 * (`Indicador<DesempenhoServidor[]>`); em falha isolada exibe Alert (Req 9.6).
 */

export interface PainelDesempenhoEquipeProps {
  indicador: Indicador<DesempenhoServidor[]> | undefined;
  ordenarPor: OrdenarDesempenhoPor;
  onOrdenarPorChange: (ordenarPor: OrdenarDesempenhoPor) => void;
}

/** Definição de coluna: chave ordenável + rótulo pt-BR + alinhamento. */
interface ColunaDef {
  key: OrdenarDesempenhoPor;
  label: string;
  numeric: boolean;
}

const COLUNAS: ColunaDef[] = [
  { key: 'nome', label: 'Servidor', numeric: false },
  { key: 'atribuidos', label: 'Atribuídos', numeric: true },
  { key: 'emAndamento', label: 'Em andamento', numeric: true },
  { key: 'concluidos', label: 'Concluídos', numeric: true },
  { key: 'atrasados', label: 'Atrasados', numeric: true },
  { key: 'tempoMedioConclusaoHoras', label: 'Tempo médio (h)', numeric: true },
  { key: 'tarefasPendentes', label: 'Tarefas pendentes', numeric: true },
];

export function PainelDesempenhoEquipe({
  indicador,
  ordenarPor,
  onOrdenarPorChange,
}: PainelDesempenhoEquipeProps) {
  const indisponivel = !indicador || indicador.erro || indicador.value == null;

  return (
    <section
      className="flex flex-col gap-4 rounded-card border border-neutral/30 bg-white p-4 shadow-sm"
      aria-label="Painel de desempenho da equipe"
    >
      <h3 className="font-heading text-sm font-semibold text-text-secondary">
        Desempenho da equipe
      </h3>

      {indisponivel ? (
        <Alert variant="warning" title="Desempenho indisponível">
          Não foi possível carregar o painel de desempenho da equipe. Os demais indicadores
          continuam disponíveis.
        </Alert>
      ) : (indicador.value as DesempenhoServidor[]).length === 0 ? (
        <p className="text-sm text-text-secondary">
          Nenhum servidor no escopo para os filtros selecionados.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral/30">
                {COLUNAS.map((col) => {
                  const ativo = col.key === ordenarPor;
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      aria-sort={ativo ? 'descending' : 'none'}
                      className={cn(
                        'px-3 py-2 font-heading text-xs font-semibold text-text-secondary',
                        col.numeric ? 'text-right' : 'text-left',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onOrdenarPorChange(col.key)}
                        className={cn(
                          'inline-flex items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                          col.numeric && 'flex-row-reverse',
                          ativo ? 'text-primary' : 'hover:text-text-primary',
                        )}
                        aria-label={`Ordenar por ${col.label}`}
                      >
                        <span>{col.label}</span>
                        {ativo && <span aria-hidden="true">▾</span>}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {(indicador.value as DesempenhoServidor[]).map((linha) => (
                <tr
                  key={linha.servidorId}
                  className="border-b border-neutral/15 last:border-0 hover:bg-neutral/5"
                >
                  <td className="px-3 py-2 text-left font-medium text-text-primary">
                    {linha.nome}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{linha.atribuidos}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{linha.emAndamento}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{linha.concluidos}</td>
                  <td
                    className={cn(
                      'px-3 py-2 text-right tabular-nums',
                      linha.atrasados > 0 && 'font-semibold text-danger',
                    )}
                  >
                    {linha.atrasados}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {linha.tempoMedioConclusaoHoras}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{linha.tarefasPendentes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default PainelDesempenhoEquipe;
