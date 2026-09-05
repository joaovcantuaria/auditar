// Módulo de Formulários Dinâmicos (Portal do Cidadão) — barrel público.
//
// Bloco reutilizável consumido pelo wizard de novo processo (task 13.2) e pelo
// Portal do Cidadão. Exporta o renderer controlado, o hook de carregamento e os
// helpers de validação/serialização.
//
// _Requirements: 16.1, 16.2, 16.5, 16.6, 16.7_

export { DynamicFormRenderer, default as DynamicFormRendererDefault } from './DynamicFormRenderer';
export type { DynamicFormRendererProps } from './DynamicFormRenderer';

export {
  useFormularioDinamico,
  formularioQueryKeys,
} from './useFormularioDinamico';
export type {
  UseFormularioDinamicoParams,
  UseFormularioDinamicoResult,
} from './useFormularioDinamico';

export {
  construirSchema,
  validarCampo,
  validarTodos,
  formularioValido,
  valoresIniciais,
  toRespostas,
  isVazio,
  mensagens,
} from './formularioValidation';

export {
  isTipoCampo,
  normalizarOpcoes,
  valorPadraoComoString,
  MAX_LENGTH_TEXTO_CURTO,
  MAX_LENGTH_TEXTO_LONGO,
} from './formulario.types';
export type {
  FormularioComCampos,
  FormularioApiResponse,
  FormFieldValue,
  FormValues,
  FormErrors,
  RespostaFormularioInput,
} from './formulario.types';
