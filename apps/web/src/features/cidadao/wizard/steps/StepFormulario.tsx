import { useEffect, useMemo } from 'react';
import { Alert, Button, Spinner } from '@/components/ui';
import {
  DynamicFormRenderer,
  useFormularioDinamico,
  valoresIniciais,
  type FormValues,
  type FormFieldValue,
} from '@/features/formularios';
import type { CampoFormulario } from '@auditar/shared';

/**
 * Step 4 do wizard — preenchimento do Formulário Dinâmico do par
 * Tipo + Unidade (Req. 4.4, 16.5, 16.6, 16.7).
 *
 * - Carrega o formulário via `useFormularioDinamico` (endpoint público
 *   `GET /formularios?tipoId=&unidadeId=`).
 * - Se o formulário não puder ser carregado (404/rede), exibe erro e bloqueia o
 *   avanço (Req. 16.6) — o gate de validade é reportado como `false`.
 * - Renderiza os campos com `DynamicFormRenderer` (validação ao sair do foco).
 * - O estado (`FormValues`) é mantido pelo wizard (persistido no wizardStore),
 *   permitindo voltar/avançar sem perder dados (Req. 4.9).
 * - `onValidityChange` habilita/desabilita o botão "Avançar" no container.
 */

interface StepFormularioProps {
  tipoProcessoId: string;
  unidadeId: string;
  /** Estado atual do formulário (mantido pelo wizard). */
  values: FormValues;
  /** Atualiza um campo. */
  onChange: (campoId: string, valor: FormFieldValue) => void;
  /** Substitui todos os valores (usado para semear os valores iniciais). */
  onReplaceValues: (values: FormValues) => void;
  /** Reporta a validade do formulário + os campos carregados ao container. */
  onValidityChange: (isValid: boolean, campos: CampoFormulario[]) => void;
}

export function StepFormulario({
  tipoProcessoId,
  unidadeId,
  values,
  onChange,
  onReplaceValues,
  onValidityChange,
}: StepFormularioProps) {
  const { campos, isLoading, isError, refetch } = useFormularioDinamico({
    tipoProcessoId,
    unidadeId,
  });

  // Semeia os valores iniciais (valorPadrao) apenas quando o formulário chega e
  // ainda não há respostas para nenhum de seus campos — sem sobrescrever o que
  // o Cidadão já preencheu ao voltar de um step posterior.
  const jaSemeado = useMemo(
    () => campos.length > 0 && campos.some((c) => values[c.id] !== undefined),
    [campos, values],
  );
  useEffect(() => {
    if (campos.length > 0 && !jaSemeado) {
      onReplaceValues(valoresIniciais(campos));
    }
  }, [campos, jaSemeado, onReplaceValues]);

  // Enquanto carrega ou em erro, o step não é válido (bloqueia avanço — Req. 16.6).
  // Formulário carregado sem campos: nada a preencher, logo é válido.
  useEffect(() => {
    if (isLoading || isError) {
      onValidityChange(false, campos);
    } else if (campos.length === 0) {
      onValidityChange(true, campos);
    }
  }, [isLoading, isError, campos, onValidityChange]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" label="Carregando formulário..." />
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="danger" title="Formulário indisponível">
        Não foi possível carregar o formulário deste tipo de processo. Verifique a seleção de
        tipo e unidade ou tente novamente.
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={refetch}>
            Tentar novamente
          </Button>
        </div>
      </Alert>
    );
  }

  if (campos.length === 0) {
    // Formulário sem campos: nada a preencher; step considerado válido.
    return (
      <Alert variant="info">
        Este tipo de processo não requer o preenchimento de campos adicionais.
      </Alert>
    );
  }

  return (
    <DynamicFormRenderer
      campos={campos}
      value={values}
      onChange={onChange}
      onValidityChange={(valido) => onValidityChange(valido, campos)}
    />
  );
}

export default StepFormulario;
