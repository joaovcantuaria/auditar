import { create } from 'zustand';

/**
 * Passos do wizard de criação de processo do Cidadão (task 13.2):
 *   1. Categoria      — seleção da categoria ativa
 *   2. Tipo           — seleção do TipoProcesso filtrado pela categoria
 *   3. Unidade        — seleção da unidade atendente
 *   4. Formulário     — respostas do FormularioDinamico
 *   5. Documentos     — upload de anexos (ids retornados pelo MinIO)
 *   6. Revisão        — confirmação e submissão (gera o protocolo)
 */
export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

/** Primeiro e último passo, para navegação/validação de limites. */
export const WIZARD_FIRST_STEP: WizardStep = 1;
export const WIZARD_LAST_STEP: WizardStep = 6;

/** Mapa de respostas do formulário dinâmico: campoId -> valor. */
export type FormAnswers = Record<string, unknown>;

export interface WizardState {
  /** Passo atual (1–6). */
  step: WizardStep;

  categoriaId: string | null;
  tipoProcessoId: string | null;
  unidadeId: string | null;

  /** Respostas do formulário dinâmico (Step 4). */
  answers: FormAnswers;
  /** Ids dos documentos já enviados ao MinIO (Step 5). */
  documentIds: string[];

  // Navegação -------------------------------------------------------------
  /** Define o passo diretamente (respeitando os limites 1–6). */
  setStep: (step: WizardStep) => void;
  /** Avança um passo (sem ultrapassar o último). */
  nextStep: () => void;
  /** Retrocede um passo (sem passar do primeiro). */
  prevStep: () => void;

  // Seleções --------------------------------------------------------------
  /** Define a categoria; limpa tipo e unidade dependentes. */
  setCategoria: (categoriaId: string | null) => void;
  /** Define o tipo de processo; limpa a unidade dependente. */
  setTipoProcesso: (tipoProcessoId: string | null) => void;
  setUnidade: (unidadeId: string | null) => void;

  // Formulário e documentos ----------------------------------------------
  /** Define/atualiza o valor de um campo do formulário. */
  setAnswer: (campoId: string, valor: unknown) => void;
  /** Substitui todas as respostas de uma vez. */
  setAnswers: (answers: FormAnswers) => void;
  /** Adiciona um id de documento enviado. */
  addDocument: (documentId: string) => void;
  /** Remove um id de documento. */
  removeDocument: (documentId: string) => void;

  /** Reseta o wizard ao estado inicial. */
  reset: () => void;
}

const initialState = {
  step: WIZARD_FIRST_STEP,
  categoriaId: null,
  tipoProcessoId: null,
  unidadeId: null,
  answers: {} as FormAnswers,
  documentIds: [] as string[],
};

function clampStep(step: number): WizardStep {
  const clamped = Math.min(WIZARD_LAST_STEP, Math.max(WIZARD_FIRST_STEP, step));
  return clamped as WizardStep;
}

/**
 * Store do wizard de novo processo (não persistido). Mantido genérico o
 * suficiente para a task 13.2 detalhar validações e integração de API.
 */
export const useWizardStore = create<WizardState>((set) => ({
  ...initialState,

  setStep: (step) => set({ step: clampStep(step) }),
  nextStep: () => set((s) => ({ step: clampStep(s.step + 1) })),
  prevStep: () => set((s) => ({ step: clampStep(s.step - 1) })),

  setCategoria: (categoriaId) =>
    set({ categoriaId, tipoProcessoId: null, unidadeId: null }),
  setTipoProcesso: (tipoProcessoId) => set({ tipoProcessoId, unidadeId: null }),
  setUnidade: (unidadeId) => set({ unidadeId }),

  setAnswer: (campoId, valor) =>
    set((s) => ({ answers: { ...s.answers, [campoId]: valor } })),
  setAnswers: (answers) => set({ answers }),

  addDocument: (documentId) =>
    set((s) =>
      s.documentIds.includes(documentId)
        ? s
        : { documentIds: [...s.documentIds, documentId] },
    ),
  removeDocument: (documentId) =>
    set((s) => ({ documentIds: s.documentIds.filter((id) => id !== documentId) })),

  reset: () => set({ ...initialState, answers: {}, documentIds: [] }),
}));
