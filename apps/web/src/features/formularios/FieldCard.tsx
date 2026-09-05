import { useRef } from 'react';
import type { ChangeEvent } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import { TipoCampo } from '@auditar/shared';
import { Input, Select, Checkbox, Button } from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  TIPO_CAMPO_LABEL,
  MAX_ROTULO,
  MAX_DESCRICAO,
  MAX_VALIDACAO,
  exigeOpcoes,
  type CampoDraft,
  type CampoDraftErros,
} from './editorModel';

/**
 * Cartão de edição de um campo do Formulário Dinâmico (task 16.3).
 *
 * Cada cartão:
 *  - é arrastável (react-dnd) para reordenar a lista (Req. 16.4);
 *  - edita `tipo`, `rotulo` (≤100, obrigatório — Req. 16.3), `descricaoAuxiliar`
 *    (≤300), `obrigatorio`, `validacao` (regex) e `valorPadrao` (validado
 *    contra o tipo — Req. 16.3);
 *  - para `selecao_unica`/`selecao_multipla`, exibe o editor de opções.
 *
 * O estado vive no `FormularioEditor` (pai); este componente é controlado via
 * `onChange` e reporta os erros recebidos por `errors`.
 *
 * _Requirements: 16.1, 16.2, 16.3, 16.4_
 */

/** Identificador do tipo de item arrastável. */
export const CAMPO_DND_TYPE = 'campo-formulario';

interface DragItem {
  key: string;
  index: number;
}

export interface FieldCardProps {
  campo: CampoDraft;
  index: number;
  total: number;
  errors: CampoDraftErros | undefined;
  disabled?: boolean;
  onChange: (patch: Partial<CampoDraft>) => void;
  onRemove: () => void;
  onMove: (from: number, to: number) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

const TIPO_OPTIONS = (Object.values(TipoCampo) as TipoCampo[]).map((tipo) => ({
  value: tipo,
  label: TIPO_CAMPO_LABEL[tipo],
}));

export function FieldCard({
  campo,
  index,
  total,
  errors,
  disabled = false,
  onChange,
  onRemove,
  onMove,
  onMoveUp,
  onMoveDown,
}: FieldCardProps) {
  const ref = useRef<HTMLLIElement>(null);

  const [{ isDragging }, drag] = useDrag<DragItem, void, { isDragging: boolean }>({
    type: CAMPO_DND_TYPE,
    item: { key: campo.key, index },
    canDrag: !disabled,
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
  });

  const [, drop] = useDrop<DragItem, void, unknown>({
    accept: CAMPO_DND_TYPE,
    hover: (item) => {
      if (item.index === index) return;
      onMove(item.index, index);
      // Atualiza o índice do item arrastado para evitar oscilação.
      item.index = index;
    },
  });

  drag(drop(ref));

  const handleTipoChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const novoTipo = e.target.value as TipoCampo;
    const patch: Partial<CampoDraft> = { tipo: novoTipo };
    // Ao passar a exigir opções e não haver nenhuma, inicia com uma vazia.
    if (exigeOpcoes(novoTipo) && campo.opcoes.length === 0) {
      patch.opcoes = [''];
    }
    onChange(patch);
  };

  const setOpcao = (i: number, valor: string) => {
    const opcoes = [...campo.opcoes];
    opcoes[i] = valor;
    onChange({ opcoes });
  };

  const addOpcao = () => onChange({ opcoes: [...campo.opcoes, ''] });

  const removeOpcao = (i: number) => {
    const opcoes = campo.opcoes.filter((_, idx) => idx !== i);
    onChange({ opcoes: opcoes.length > 0 ? opcoes : [''] });
  };

  return (
    <li
      ref={ref}
      data-testid={`campo-card-${index}`}
      className={cn(
        'rounded-card border border-neutral bg-white p-4',
        isDragging && 'opacity-50',
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="cursor-move select-none text-text-secondary"
            title="Arraste para reordenar"
          >
            ⠿
          </span>
          <span className="text-sm font-medium text-text-secondary">Campo {index + 1}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled || index === 0}
            onClick={onMoveUp}
            aria-label={`Mover campo ${index + 1} para cima`}
          >
            ↑
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled || index === total - 1}
            onClick={onMoveDown}
            aria-label={`Mover campo ${index + 1} para baixo`}
          >
            ↓
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={disabled}
            onClick={onRemove}
            aria-label={`Remover campo ${index + 1}`}
          >
            Remover
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Select
          label="Tipo do campo"
          value={campo.tipo}
          options={TIPO_OPTIONS}
          disabled={disabled}
          onChange={handleTipoChange}
        />
        <Input
          label="Rótulo"
          required
          maxLength={MAX_ROTULO}
          value={campo.rotulo}
          error={errors?.rotulo}
          disabled={disabled}
          onChange={(e) => onChange({ rotulo: e.target.value })}
        />
        <Input
          label="Descrição auxiliar"
          maxLength={MAX_DESCRICAO}
          helperText="Texto de apoio exibido abaixo do campo (opcional)."
          value={campo.descricaoAuxiliar}
          error={errors?.descricaoAuxiliar}
          disabled={disabled}
          onChange={(e) => onChange({ descricaoAuxiliar: e.target.value })}
        />
        <Input
          label="Valor padrão"
          value={campo.valorPadrao}
          error={errors?.valorPadrao}
          disabled={disabled}
          helperText="Valor pré-preenchido (deve ser compatível com o tipo)."
          onChange={(e) => onChange({ valorPadrao: e.target.value })}
        />
        <Input
          label="Validação (regex)"
          maxLength={MAX_VALIDACAO}
          placeholder="Ex.: ^[0-9]{5}$"
          value={campo.validacao}
          error={errors?.validacao}
          disabled={disabled}
          helperText="Expressão regular aplicada ao valor (opcional)."
          onChange={(e) => onChange({ validacao: e.target.value })}
        />
        <div className="flex items-end">
          <Checkbox
            label="Campo obrigatório"
            checked={campo.obrigatorio}
            disabled={disabled}
            onChange={(e) => onChange({ obrigatorio: e.target.checked })}
          />
        </div>
      </div>

      {exigeOpcoes(campo.tipo) && (
        <fieldset className="mt-4 rounded-btn border border-bg-alt p-3">
          <legend className="px-1 text-sm font-medium text-text-primary">Opções</legend>
          {errors?.opcoes && (
            <p role="alert" className="mb-2 text-sm text-danger">
              {errors.opcoes}
            </p>
          )}
          <div className="flex flex-col gap-2">
            {campo.opcoes.map((opcao, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="flex-1">
                  <Input
                    label={`Opção ${i + 1}`}
                    value={opcao}
                    disabled={disabled}
                    onChange={(e) => setOpcao(i, e.target.value)}
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled || campo.opcoes.length <= 1}
                  onClick={() => removeOpcao(i)}
                  aria-label={`Remover opção ${i + 1}`}
                >
                  Remover
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-2">
            <Button variant="secondary" size="sm" disabled={disabled} onClick={addOpcao}>
              Adicionar opção
            </Button>
          </div>
        </fieldset>
      )}
    </li>
  );
}

export default FieldCard;
