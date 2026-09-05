import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ChangeEvent } from 'react';
import { TipoCampo } from '@auditar/shared';
import type { CampoFormulario } from '@auditar/shared';
import { Input, Select, Checkbox, DatePicker } from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  MAX_LENGTH_TEXTO_CURTO,
  MAX_LENGTH_TEXTO_LONGO,
  normalizarOpcoes,
  type FormFieldValue,
  type FormErrors,
  type FormValues,
} from './formulario.types';
import { formularioValido, validarCampo } from './formularioValidation';

/**
 * DynamicFormRenderer — renderizador reutilizável de Formulários Dinâmicos.
 *
 * Componente CONTROLADO: o dono do estado (o wizard de novo processo — task
 * 13.2, ou o Portal do Cidadão) mantém `value` e recebe cada alteração via
 * `onChange(campoId, valor)`. Optamos por um componente controlado (em vez de
 * acoplar a `react-hook-form`) porque:
 *   - o wizard já centraliza o estado dos 6 steps no `wizardStore`;
 *   - o mesmo estado alimenta a serialização de `respostas` e o upload;
 *   - a validação vive em `formularioValidation.ts`, compartilhada com o gate
 *     de avanço do wizard — sem duplicar regras dentro de um resolver.
 *
 * Comportamento:
 *   - renderiza os campos por `tipo`, na ordem recebida (Req. 16.5);
 *   - valida ao sair do foco (on blur), exibindo o erro adjacente ao campo SEM
 *     limpar o valor preenchido (Req. 16.7);
 *   - erros também podem vir de fora via `errors` (ex.: validação completa ao
 *     tentar avançar); o mapa externo tem precedência sobre o interno;
 *   - `onValidityChange(isValid)` informa o consumidor sempre que a validade do
 *     conjunto muda, permitindo ao wizard habilitar/desabilitar o botão avançar.
 *
 * Upload é renderizado como um input de arquivo simples: o binário e o envio ao
 * MinIO são responsabilidade do caller/wizard (step 5). Aqui só coletamos os
 * `File[]` no estado.
 *
 * _Requirements: 16.1, 16.2, 16.5, 16.6, 16.7_
 */

export interface DynamicFormRendererProps {
  /** Campos a renderizar; devem vir na ordem de exibição desejada (`ordem`). */
  campos: CampoFormulario[];
  /** Estado atual do formulário (`campoId -> valor`). */
  value: FormValues;
  /** Chamado a cada alteração de um campo. O consumidor atualiza `value`. */
  onChange: (campoId: string, valor: FormFieldValue) => void;
  /**
   * Erros controlados externamente (`campoId -> mensagem`). Sobrepõem os erros
   * calculados internamente no blur. Útil para exibir todos os pendentes ao
   * tentar avançar de etapa.
   */
  errors?: FormErrors;
  /** Callback com o erro calculado no blur, para o consumidor persistir se quiser. */
  onFieldBlur?: (campoId: string, erro: string | undefined) => void;
  /** Notifica mudanças na validade global do formulário. */
  onValidityChange?: (isValid: boolean) => void;
  /** Desabilita todos os campos (ex.: durante submissão). */
  disabled?: boolean;
  /** Classe extra para o container. */
  className?: string;
}

/**
 * Renderiza um conjunto de campos dinâmicos controlados. Todo o estado vive no
 * consumidor; este componente é uma função pura da (config + valores + erros).
 */
export function DynamicFormRenderer({
  campos,
  value,
  onChange,
  errors,
  onFieldBlur,
  onValidityChange,
  disabled = false,
  className,
}: DynamicFormRendererProps) {
  // Erros calculados internamente no blur (fallback quando não controlado).
  const internalErrorsRef = useRef<FormErrors>({});

  // Reporta a validade global sempre que campos/valores mudarem.
  const valido = useMemo(() => formularioValido(campos, value), [campos, value]);
  useEffect(() => {
    onValidityChange?.(valido);
  }, [valido, onValidityChange]);

  const handleBlur = useCallback(
    (campo: CampoFormulario) => {
      const erro = validarCampo(campo, value[campo.id]);
      internalErrorsRef.current[campo.id] = erro;
      onFieldBlur?.(campo.id, erro);
    },
    [value, onFieldBlur],
  );

  /** Erro efetivo do campo: externo (controlado) tem precedência sobre o interno. */
  const erroDoCampo = (campoId: string): string | undefined =>
    errors?.[campoId] ?? internalErrorsRef.current[campoId];

  return (
    <div className={cn('flex flex-col gap-5', className)}>
      {campos.map((campo) => (
        <CampoRenderer
          key={campo.id}
          campo={campo}
          value={value[campo.id]}
          error={erroDoCampo(campo.id)}
          disabled={disabled}
          onChange={(valor) => onChange(campo.id, valor)}
          onBlur={() => handleBlur(campo)}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Renderização de um campo individual
// ---------------------------------------------------------------------------

interface CampoRendererProps {
  campo: CampoFormulario;
  value: FormFieldValue;
  error: string | undefined;
  disabled: boolean;
  onChange: (valor: FormFieldValue) => void;
  onBlur: () => void;
}

/** Máscara progressiva de CPF: 000.000.000-00. */
function aplicarMascaraCpf(bruto: string): string {
  const d = bruto.replace(/\D/g, '').slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
}

function CampoRenderer({ campo, value, error, disabled, onChange, onBlur }: CampoRendererProps) {
  const rotulo = campo.rotulo;
  const helper = campo.descricaoAuxiliar ?? undefined;
  const obrigatorio = campo.obrigatorio;

  switch (campo.tipo as TipoCampo) {
    case TipoCampo.TEXTO_CURTO:
      return (
        <Input
          label={rotulo}
          helperText={helper}
          required={obrigatorio}
          error={error}
          disabled={disabled}
          maxLength={MAX_LENGTH_TEXTO_CURTO}
          value={typeof value === 'string' ? value : ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          onBlur={onBlur}
        />
      );

    case TipoCampo.TEXTO_LONGO:
      return (
        <TextArea
          label={rotulo}
          helperText={helper}
          required={obrigatorio}
          error={error}
          disabled={disabled}
          value={typeof value === 'string' ? value : ''}
          onChange={(v) => onChange(v)}
          onBlur={onBlur}
        />
      );

    case TipoCampo.NUMERO:
      return (
        <Input
          label={rotulo}
          helperText={helper}
          required={obrigatorio}
          error={error}
          disabled={disabled}
          type="number"
          inputMode="decimal"
          value={typeof value === 'string' ? value : ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          onBlur={onBlur}
        />
      );

    case TipoCampo.DATA:
      return (
        <DatePicker
          label={rotulo}
          helperText={helper}
          required={obrigatorio}
          error={error}
          disabled={disabled}
          value={typeof value === 'string' ? value : ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          onBlur={onBlur}
        />
      );

    case TipoCampo.CPF:
      return (
        <Input
          label={rotulo}
          helperText={helper}
          required={obrigatorio}
          error={error}
          disabled={disabled}
          inputMode="numeric"
          placeholder="000.000.000-00"
          value={typeof value === 'string' ? value : ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(aplicarMascaraCpf(e.target.value))}
          onBlur={onBlur}
        />
      );

    case TipoCampo.SELECAO_UNICA: {
      const opcoes = normalizarOpcoes(campo.opcoes);
      return (
        <Select
          label={rotulo}
          helperText={helper}
          required={obrigatorio}
          error={error}
          disabled={disabled}
          placeholder="Selecione uma opção"
          value={typeof value === 'string' ? value : ''}
          options={opcoes.map((o) => ({ label: o, value: o }))}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
          onBlur={onBlur}
        />
      );
    }

    case TipoCampo.SELECAO_MULTIPLA:
      return (
        <CheckboxGroup
          campo={campo}
          value={Array.isArray(value) ? (value as string[]) : []}
          error={error}
          helper={helper}
          disabled={disabled}
          onChange={(vals) => onChange(vals)}
          onBlur={onBlur}
        />
      );

    case TipoCampo.UPLOAD:
      return (
        <FileField
          campo={campo}
          value={Array.isArray(value) ? (value as File[]) : []}
          error={error}
          helper={helper}
          disabled={disabled}
          onChange={(files) => onChange(files)}
          onBlur={onBlur}
        />
      );

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Subcomponentes especializados
// ---------------------------------------------------------------------------

interface TextAreaProps {
  label: string;
  helperText?: string;
  required: boolean;
  error?: string;
  disabled: boolean;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
}

/**
 * Textarea acessível para `texto_longo`, seguindo o mesmo contrato visual do
 * `Input` do design system (label + error + helper). Reutilizamos as classes
 * do design system para consistência.
 */
function TextArea({
  label,
  helperText,
  required,
  error,
  disabled,
  value,
  onChange,
  onBlur,
}: TextAreaProps) {
  const fieldId = useUniqueId();
  const errorId = `${fieldId}-error`;
  const helperId = `${fieldId}-helper`;
  const describedBy = error ? errorId : helperText ? helperId : undefined;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="text-sm font-medium text-text-primary">
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        )}
      </label>
      <textarea
        id={fieldId}
        required={required}
        disabled={disabled}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        maxLength={MAX_LENGTH_TEXTO_LONGO}
        rows={4}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className={cn(
          'w-full rounded-btn border bg-white px-3 py-2 text-base text-text-primary',
          'placeholder:text-text-secondary',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          'disabled:cursor-not-allowed disabled:bg-bg-alt disabled:text-text-secondary',
          error ? 'border-danger' : 'border-neutral',
        )}
      />
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : helperText ? (
        <p id={helperId} className="text-sm text-text-secondary">
          {helperText}
        </p>
      ) : null}
    </div>
  );
}

interface CheckboxGroupProps {
  campo: CampoFormulario;
  value: string[];
  error?: string;
  helper?: string;
  disabled: boolean;
  onChange: (value: string[]) => void;
  onBlur: () => void;
}

/** Grupo de checkboxes para `selecao_multipla`, montado a partir de `opcoes`. */
function CheckboxGroup({ campo, value, error, helper, disabled, onChange, onBlur }: CheckboxGroupProps) {
  const opcoes = normalizarOpcoes(campo.opcoes);
  const groupErrorId = useUniqueId();

  const toggle = (opcao: string, checked: boolean) => {
    const next = checked ? [...value, opcao] : value.filter((v) => v !== opcao);
    onChange(next);
  };

  return (
    <fieldset
      className="flex flex-col gap-2"
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? groupErrorId : undefined}
    >
      <legend className="text-sm font-medium text-text-primary">
        {campo.rotulo}
        {campo.obrigatorio && (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        )}
      </legend>
      {helper && <p className="text-sm text-text-secondary">{helper}</p>}
      <div className="flex flex-col gap-1">
        {opcoes.map((opcao) => (
          <Checkbox
            key={opcao}
            label={opcao}
            disabled={disabled}
            checked={value.includes(opcao)}
            onChange={(e) => toggle(opcao, e.target.checked)}
            onBlur={onBlur}
          />
        ))}
      </div>
      {error && (
        <p id={groupErrorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}

interface FileFieldProps {
  campo: CampoFormulario;
  value: File[];
  error?: string;
  helper?: string;
  disabled: boolean;
  onChange: (files: File[]) => void;
  onBlur: () => void;
}

/**
 * Campo de upload (stub). Coleta `File[]` no estado; o upload real (presigned
 * URL do MinIO) é feito pelo caller/wizard no step de documentos. Mantemos o
 * campo simples aqui para não duplicar a lógica de dropzone do wizard.
 */
function FileField({ campo, value, error, helper, disabled, onChange, onBlur }: FileFieldProps) {
  const fieldId = useUniqueId();
  const errorId = `${fieldId}-error`;
  const helperId = `${fieldId}-helper`;
  const describedBy = error ? errorId : helper ? helperId : undefined;

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.files ? Array.from(e.target.files) : []);
  };

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="text-sm font-medium text-text-primary">
        {campo.rotulo}
        {campo.obrigatorio && (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        )}
      </label>
      <input
        id={fieldId}
        type="file"
        multiple
        disabled={disabled}
        aria-required={campo.obrigatorio || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={handleChange}
        onBlur={onBlur}
        className={cn(
          'w-full rounded-btn border bg-white px-3 py-2 text-base text-text-primary',
          'file:mr-3 file:rounded-btn file:border-0 file:bg-primary file:px-3 file:py-1 file:text-white',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          'disabled:cursor-not-allowed disabled:bg-bg-alt disabled:text-text-secondary',
          error ? 'border-danger' : 'border-neutral',
        )}
      />
      {value.length > 0 && (
        <ul className="text-sm text-text-secondary">
          {value.map((f) => (
            <li key={f.name}>{f.name}</li>
          ))}
        </ul>
      )}
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : helper ? (
        <p id={helperId} className="text-sm text-text-secondary">
          {helper}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Utilitário local
// ---------------------------------------------------------------------------

let uidCounter = 0;
/** Id estável por instância (sem depender do hook `useId` em subcomponentes puros). */
function useUniqueId(): string {
  const ref = useRef<string>();
  if (!ref.current) {
    uidCounter += 1;
    ref.current = `dyn-field-${uidCounter}`;
  }
  return ref.current;
}

export default DynamicFormRenderer;
