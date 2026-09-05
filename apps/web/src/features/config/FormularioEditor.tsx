import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import type { Identifier, XYCoord } from 'react-dnd';
import { TipoCampo } from '@auditar/shared';
import type { CampoFormulario, TipoProcesso, Unidade } from '@auditar/shared';
import { Alert, Button, Checkbox, Input, Select, Spinner } from '@/components/ui';
import {
  DynamicFormRenderer,
  valoresIniciais,
  type FormValues,
  type FormFieldValue,
} from '@/features/formularios';
import {
  MAX_CAMPOS_FORMULARIO,
  type CampoPayload,
  type CriarFormularioPayload,
  type SalvarFormularioPayload,
} from '@/features/formularios/formulariosAdmin.api';
import type { FormularioComCampos } from '@/features/formularios/formulario.types';
import type { TipoProcessoComUnidades } from '@/features/formularios/formulariosAdmin.api';

/**
 * Editor de Formulários Dinâmicos (Painel Administrativo — Task 16.3 / Req. 16).
 *
 * Permite montar o Formulário de um par Tipo de Processo + Unidade com uma
 * lista ordenada de campos arrastáveis (react-dnd — mesma implementação do
 * `FluxoEditor`). Cada campo configura tipo, rótulo (≤100, obrigatório —
 * Req. 16.3), descrição auxiliar (≤300), obrigatoriedade, validação (regex),
 * valor padrão (validado quanto à compatibilidade com o tipo — Req. 16.3) e
 * opções (para campos de seleção). Um painel de PRÉ-VISUALIZAÇÃO renderiza o
 * `DynamicFormRenderer` com a configuração atual, mostrando a visão do Cidadão.
 *
 * A `ordem` de cada campo deriva da posição na lista; a reordenação por
 * drag-and-drop atualiza a `ordem` e é PERSISTIDA junto com o salvamento
 * (`PUT /admin/config/formularios/:id`), pois o backend NÃO expõe um endpoint
 * de reordenação dedicado (verificado em `formularios.router.ts`): o PUT recria
 * a lista de campos na nova ordem (Req. 16.4).
 *
 * Validações client-side espelham `formularios.schema.ts` do backend:
 *  - 16.1: no máximo 50 campos; rótulo ≤100; descrição auxiliar ≤300;
 *  - 16.3: rótulo obrigatório por campo; valorPadrao compatível com o tipo;
 *          campos de seleção exigem ao menos uma opção.
 *
 * _Requirements: 16.1, 16.2, 16.3, 16.4_
 */

// ---------------------------------------------------------------------------
// Limites (espelham formularios.schema.ts do backend)
// ---------------------------------------------------------------------------

const ROTULO_MAX = 100;
const DESCRICAO_MAX = 300;
const VALIDACAO_MAX = 500;
const CAMPOS_MAX = MAX_CAMPOS_FORMULARIO;

const DND_TIPO_CAMPO = 'formulario-campo';

const TIPOS_COM_OPCOES: readonly TipoCampo[] = [
  TipoCampo.SELECAO_UNICA,
  TipoCampo.SELECAO_MULTIPLA,
];

const TIPOS_CAMPO: ReadonlyArray<{ label: string; value: TipoCampo }> = [
  { label: 'Texto curto', value: TipoCampo.TEXTO_CURTO },
  { label: 'Texto longo', value: TipoCampo.TEXTO_LONGO },
  { label: 'Número', value: TipoCampo.NUMERO },
  { label: 'Data', value: TipoCampo.DATA },
  { label: 'Seleção única', value: TipoCampo.SELECAO_UNICA },
  { label: 'Seleção múltipla', value: TipoCampo.SELECAO_MULTIPLA },
  { label: 'Upload de arquivo', value: TipoCampo.UPLOAD },
  { label: 'CPF', value: TipoCampo.CPF },
];

function ehTipoComOpcoes(tipo: TipoCampo): boolean {
  return TIPOS_COM_OPCOES.includes(tipo);
}

// ---------------------------------------------------------------------------
// Modelo de estado local (uid estável para keys, DnD e pré-visualização)
// ---------------------------------------------------------------------------

interface CampoDraft {
  uid: string;
  tipo: TipoCampo;
  rotulo: string;
  descricaoAuxiliar: string;
  obrigatorio: boolean;
  validacao: string;
  valorPadrao: string;
  opcoes: string[];
}

let uidSeq = 0;
function novoUid(prefixo: string): string {
  uidSeq += 1;
  return `${prefixo}-${Date.now().toString(36)}-${uidSeq}`;
}

function campoVazio(): CampoDraft {
  return {
    uid: novoUid('campo'),
    tipo: TipoCampo.TEXTO_CURTO,
    rotulo: '',
    descricaoAuxiliar: '',
    obrigatorio: false,
    validacao: '',
    valorPadrao: '',
    opcoes: [],
  };
}

/** Converte o `valorPadrao` (unknown no backend) em string editável. */
function valorPadraoParaString(valorPadrao: CampoFormulario['valorPadrao']): string {
  return typeof valorPadrao === 'string' ? valorPadrao : '';
}

/** Converte um Formulário carregado do backend em rascunho editável. */
function formularioParaDrafts(formulario: FormularioComCampos | null): CampoDraft[] {
  if (!formulario || formulario.campos.length === 0) {
    return [campoVazio()];
  }
  return [...formulario.campos]
    .sort((a, b) => a.ordem - b.ordem)
    .map((campo) => ({
      uid: novoUid('campo'),
      tipo: (campo.tipo as TipoCampo) ?? TipoCampo.TEXTO_CURTO,
      rotulo: campo.rotulo,
      descricaoAuxiliar: campo.descricaoAuxiliar ?? '',
      obrigatorio: campo.obrigatorio,
      validacao: campo.validacao ?? '',
      valorPadrao: valorPadraoParaString(campo.valorPadrao),
      opcoes: Array.isArray(campo.opcoes)
        ? campo.opcoes.filter((o): o is string => typeof o === 'string')
        : [],
    }));
}

// ---------------------------------------------------------------------------
// Compatibilidade de valorPadrao × tipo (espelha validarValorPadrao do backend)
// ---------------------------------------------------------------------------

const NUMERO_REGEX = /^-?\d+(\.\d+)?$/;

/**
 * Verifica se `valorPadrao` é compatível com `tipo` (Req. 16.3). Valor vazio é
 * sempre compatível. Para seleção, o valor padrão deve estar entre as opções.
 */
function valorPadraoCompativel(campo: CampoDraft): boolean {
  const valor = campo.valorPadrao.trim();
  if (valor === '') return true;

  switch (campo.tipo) {
    case TipoCampo.NUMERO:
      return NUMERO_REGEX.test(valor);
    case TipoCampo.DATA:
      return !Number.isNaN(Date.parse(valor));
    case TipoCampo.CPF:
      return valor.replace(/\D/g, '').length === 11;
    case TipoCampo.SELECAO_UNICA:
      return campo.opcoes.some((o) => o.trim() === valor);
    case TipoCampo.SELECAO_MULTIPLA:
      // Valor padrão único deve pertencer às opções (múltipla escolha inicia
      // com um valor pré-selecionado, quando informado).
      return campo.opcoes.some((o) => o.trim() === valor);
    default:
      return true;
  }
}

// ---------------------------------------------------------------------------
// Validação client-side (Req. 16.1 / 16.3)
// ---------------------------------------------------------------------------

interface ErrosCampo {
  rotulo?: string;
  descricao?: string;
  valorPadrao?: string;
  opcoes?: string;
  validacao?: string;
}

interface ErrosFormulario {
  tipoProcessoId?: string;
  unidadeId?: string;
  campos?: string;
  porCampo: Record<string, ErrosCampo>;
}

interface DraftFormulario {
  tipoProcessoId: string;
  unidadeId: string;
  campos: CampoDraft[];
}

function validarDraft(draft: DraftFormulario, exigeParDestino: boolean): {
  erros: ErrosFormulario;
  valido: boolean;
} {
  const erros: ErrosFormulario = { porCampo: {} };
  let valido = true;

  if (exigeParDestino) {
    if (draft.tipoProcessoId.trim() === '') {
      erros.tipoProcessoId = 'Selecione o tipo de processo';
      valido = false;
    }
    if (draft.unidadeId.trim() === '') {
      erros.unidadeId = 'Selecione a unidade';
      valido = false;
    }
  }

  if (draft.campos.length === 0) {
    erros.campos = 'O formulário deve ter ao menos um campo';
    valido = false;
  } else if (draft.campos.length > CAMPOS_MAX) {
    erros.campos = `Um formulário pode ter no máximo ${CAMPOS_MAX} campos`;
    valido = false;
  }

  draft.campos.forEach((campo) => {
    const errosCampo: ErrosCampo = {};

    const rotulo = campo.rotulo.trim();
    if (rotulo.length === 0) {
      errosCampo.rotulo = 'O rótulo é obrigatório';
      valido = false;
    } else if (rotulo.length > ROTULO_MAX) {
      errosCampo.rotulo = `Máximo de ${ROTULO_MAX} caracteres`;
      valido = false;
    }

    if (campo.descricaoAuxiliar.trim().length > DESCRICAO_MAX) {
      errosCampo.descricao = `Máximo de ${DESCRICAO_MAX} caracteres`;
      valido = false;
    }

    if (campo.validacao.trim().length > VALIDACAO_MAX) {
      errosCampo.validacao = `Máximo de ${VALIDACAO_MAX} caracteres`;
      valido = false;
    }

    if (ehTipoComOpcoes(campo.tipo)) {
      const opcoesValidas = campo.opcoes.map((o) => o.trim()).filter((o) => o.length > 0);
      if (opcoesValidas.length === 0) {
        errosCampo.opcoes = 'Campos de seleção exigem ao menos uma opção';
        valido = false;
      }
    }

    if (!valorPadraoCompativel(campo)) {
      errosCampo.valorPadrao = 'Valor padrão incompatível com o tipo do campo';
      valido = false;
    }

    if (Object.keys(errosCampo).length > 0) {
      erros.porCampo[campo.uid] = errosCampo;
    }
  });

  return { erros, valido };
}

/** Monta os `CampoPayload[]` com `ordem` derivada da posição na lista. */
function draftsParaCampos(campos: CampoDraft[]): CampoPayload[] {
  return campos.map((campo, index): CampoPayload => {
    const descricao = campo.descricaoAuxiliar.trim();
    const validacao = campo.validacao.trim();
    const valorPadrao = campo.valorPadrao.trim();
    const opcoes = ehTipoComOpcoes(campo.tipo)
      ? campo.opcoes.map((o) => o.trim()).filter((o) => o.length > 0)
      : undefined;
    return {
      tipo: campo.tipo,
      rotulo: campo.rotulo.trim(),
      descricaoAuxiliar: descricao.length > 0 ? descricao : undefined,
      obrigatorio: campo.obrigatorio,
      validacao: validacao.length > 0 ? validacao : undefined,
      valorPadrao: valorPadrao.length > 0 ? valorPadrao : undefined,
      opcoes: opcoes && opcoes.length > 0 ? opcoes : undefined,
      ordem: index,
    };
  });
}

/**
 * Converte os rascunhos em `CampoFormulario[]` sintéticos para alimentar a
 * pré-visualização com o `DynamicFormRenderer` (a visão do Cidadão — Req. 16.5).
 */
function draftsParaPreview(campos: CampoDraft[]): CampoFormulario[] {
  return campos.map((campo, index) => ({
    id: campo.uid,
    formularioId: 'preview',
    tipo: campo.tipo,
    rotulo: campo.rotulo.trim() === '' ? `Campo ${index + 1}` : campo.rotulo,
    descricaoAuxiliar: campo.descricaoAuxiliar.trim() || null,
    obrigatorio: campo.obrigatorio,
    validacao: campo.validacao.trim() || null,
    valorPadrao: campo.valorPadrao.trim() || null,
    ordem: index,
    opcoes: ehTipoComOpcoes(campo.tipo)
      ? campo.opcoes.map((o) => o.trim()).filter((o) => o.length > 0)
      : null,
  }));
}

// ---------------------------------------------------------------------------
// Card de campo (arrastável)
// ---------------------------------------------------------------------------

interface DragItem {
  index: number;
  uid: string;
}

interface CampoCardProps {
  campo: CampoDraft;
  index: number;
  total: number;
  erros?: ErrosCampo;
  disabled: boolean;
  onMover: (from: number, to: number) => void;
  onAtualizar: (uid: string, patch: Partial<CampoDraft>) => void;
  onRemover: (uid: string) => void;
}

function CampoCard({
  campo,
  index,
  total,
  erros,
  disabled,
  onMover,
  onAtualizar,
  onRemover,
}: CampoCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  const [{ handlerId }, drop] = useDrop<DragItem, void, { handlerId: Identifier | null }>({
    accept: DND_TIPO_CAMPO,
    collect: (monitor) => ({ handlerId: monitor.getHandlerId() }),
    hover(item, monitor) {
      if (!ref.current) return;
      const dragIndex = item.index;
      const hoverIndex = index;
      if (dragIndex === hoverIndex) return;

      const hoverRect = ref.current.getBoundingClientRect();
      const hoverMiddleY = (hoverRect.bottom - hoverRect.top) / 2;
      const clientOffset = monitor.getClientOffset() as XYCoord | null;
      if (!clientOffset) return;
      const hoverClientY = clientOffset.y - hoverRect.top;

      if (dragIndex < hoverIndex && hoverClientY < hoverMiddleY) return;
      if (dragIndex > hoverIndex && hoverClientY > hoverMiddleY) return;

      onMover(dragIndex, hoverIndex);
      item.index = hoverIndex;
    },
  });

  const [{ isDragging }, drag, preview] = useDrag({
    type: DND_TIPO_CAMPO,
    item: (): DragItem => ({ index, uid: campo.uid }),
    canDrag: !disabled,
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
  });

  preview(drop(ref));

  const mostrarOpcoes = ehTipoComOpcoes(campo.tipo);

  // --- Handlers de opções (para campos de seleção) -----------------------
  function adicionarOpcao() {
    onAtualizar(campo.uid, { opcoes: [...campo.opcoes, ''] });
  }
  function atualizarOpcao(i: number, valor: string) {
    const opcoes = campo.opcoes.slice();
    opcoes[i] = valor;
    onAtualizar(campo.uid, { opcoes });
  }
  function removerOpcao(i: number) {
    onAtualizar(campo.uid, { opcoes: campo.opcoes.filter((_, idx) => idx !== i) });
  }

  function alterarTipo(novoTipo: TipoCampo) {
    // Ao mudar para/desde um tipo de seleção, limpamos o valor padrão para
    // evitar incompatibilidades silenciosas (Req. 16.3).
    onAtualizar(campo.uid, { tipo: novoTipo, valorPadrao: '' });
  }

  return (
    <div
      ref={ref}
      data-handler-id={handlerId}
      className="rounded-card border border-bg-alt bg-white p-4 shadow-sm"
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            ref={drag as unknown as React.Ref<HTMLButtonElement>}
            type="button"
            aria-label={`Arraste para reordenar o campo ${index + 1}`}
            disabled={disabled}
            className="min-h-touch min-w-touch cursor-grab rounded-btn px-2 text-text-secondary hover:bg-bg-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed"
          >
            <span aria-hidden="true">⠿</span>
          </button>
          <h4 className="font-heading text-sm font-semibold text-text-primary">
            Campo {index + 1}
          </h4>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled || index === 0}
            aria-label="Mover campo para cima"
            onClick={() => onMover(index, index - 1)}
          >
            ↑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled || index === total - 1}
            aria-label="Mover campo para baixo"
            onClick={() => onMover(index, index + 1)}
          >
            ↓
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={disabled || total <= 1}
            onClick={() => onRemover(campo.uid)}
          >
            Remover
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label="Tipo do campo"
          value={campo.tipo}
          disabled={disabled}
          options={TIPOS_CAMPO.map((t) => ({ label: t.label, value: t.value }))}
          onChange={(e) => alterarTipo(e.target.value as TipoCampo)}
        />
        <Input
          label="Rótulo"
          required
          maxLength={ROTULO_MAX}
          value={campo.rotulo}
          error={erros?.rotulo}
          disabled={disabled}
          onChange={(e) => onAtualizar(campo.uid, { rotulo: e.target.value })}
        />
      </div>

      <div className="mt-4">
        <Input
          label="Descrição auxiliar — opcional"
          maxLength={DESCRICAO_MAX}
          value={campo.descricaoAuxiliar}
          error={erros?.descricao}
          disabled={disabled}
          helperText="Texto de apoio exibido abaixo do campo"
          onChange={(e) => onAtualizar(campo.uid, { descricaoAuxiliar: e.target.value })}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Validação (regex) — opcional"
          maxLength={VALIDACAO_MAX}
          value={campo.validacao}
          error={erros?.validacao}
          disabled={disabled}
          helperText="Expressão regular aplicada a campos de texto"
          placeholder="^[A-Za-z]+$"
          onChange={(e) => onAtualizar(campo.uid, { validacao: e.target.value })}
        />
        <Input
          label="Valor padrão — opcional"
          value={campo.valorPadrao}
          error={erros?.valorPadrao}
          disabled={disabled}
          helperText="Deve ser compatível com o tipo do campo"
          onChange={(e) => onAtualizar(campo.uid, { valorPadrao: e.target.value })}
        />
      </div>

      <div className="mt-4">
        <Checkbox
          label="Preenchimento obrigatório"
          checked={campo.obrigatorio}
          disabled={disabled}
          onChange={(e) => onAtualizar(campo.uid, { obrigatorio: e.target.checked })}
        />
      </div>

      {mostrarOpcoes && (
        <fieldset className="mt-4 rounded-card border border-bg-alt p-3">
          <legend className="px-1 text-sm font-medium text-text-primary">
            Opções ({campo.opcoes.length})
          </legend>
          {erros?.opcoes && (
            <p role="alert" className="mb-2 text-sm text-danger">
              {erros.opcoes}
            </p>
          )}
          <div className="flex flex-col gap-2">
            {campo.opcoes.map((opcao, i) => (
              <div key={`${campo.uid}-opcao-${i}`} className="flex items-end gap-2">
                <div className="flex-1">
                  <Input
                    label={`Opção ${i + 1}`}
                    value={opcao}
                    disabled={disabled}
                    onChange={(e) => atualizarOpcao(i, e.target.value)}
                  />
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  aria-label={`Remover opção ${i + 1}`}
                  onClick={() => removerOpcao(i)}
                >
                  Remover
                </Button>
              </div>
            ))}
            <div>
              <Button
                size="sm"
                variant="secondary"
                disabled={disabled}
                onClick={adicionarOpcao}
              >
                Adicionar opção
              </Button>
            </div>
          </div>
        </fieldset>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor principal
// ---------------------------------------------------------------------------

export interface FormularioEditorProps {
  /** Formulário a editar; `null`/ausente inicia um novo formulário. */
  formulario?: FormularioComCampos | null;
  /** Tipos de processo para o seletor de destino (modo criação). */
  tiposProcesso: TipoProcessoComUnidades[];
  /** Unidades para o seletor de destino (modo criação). */
  unidades: Unidade[];
  /** Indica salvamento em andamento (desabilita os controles). */
  salvando?: boolean;
  /** Erro de salvamento (backend) a exibir no topo. */
  erroSalvar?: string;
  /** Recebe o payload de criação validado (POST). Usado no modo criação. */
  onCriar: (payload: CriarFormularioPayload) => void;
  /** Recebe o payload de salvamento validado (PUT). Usado no modo edição. */
  onSalvar: (payload: SalvarFormularioPayload) => void;
  /** Cancela e fecha o editor. */
  onCancelar: () => void;
}

function nomeTipo(tipos: TipoProcesso[], id: string): string {
  return tipos.find((t) => t.id === id)?.nome ?? id;
}

function nomeUnidade(unidades: Unidade[], id: string): string {
  return unidades.find((u) => u.id === id)?.nome ?? id;
}

export function FormularioEditor({
  formulario = null,
  tiposProcesso,
  unidades,
  salvando = false,
  erroSalvar,
  onCriar,
  onSalvar,
  onCancelar,
}: FormularioEditorProps) {
  const editando = Boolean(formulario);

  const [tipoProcessoId, setTipoProcessoId] = useState<string>(
    formulario?.tipoProcessoId ?? '',
  );
  const [unidadeId, setUnidadeId] = useState<string>(formulario?.unidadeId ?? '');
  const [campos, setCampos] = useState<CampoDraft[]>(() =>
    formularioParaDrafts(formulario),
  );
  const [erros, setErros] = useState<ErrosFormulario>({ porCampo: {} });
  const [tentouSalvar, setTentouSalvar] = useState(false);

  const draft: DraftFormulario = useMemo(
    () => ({ tipoProcessoId, unidadeId, campos }),
    [tipoProcessoId, unidadeId, campos],
  );

  const revalidar = useCallback(
    (proximo: DraftFormulario) => {
      if (tentouSalvar) {
        setErros(validarDraft(proximo, !editando).erros);
      }
    },
    [tentouSalvar, editando],
  );

  function atualizarCampo(uid: string, patch: Partial<CampoDraft>) {
    setCampos((prev) => {
      const proximo = prev.map((c) => (c.uid === uid ? { ...c, ...patch } : c));
      revalidar({ tipoProcessoId, unidadeId, campos: proximo });
      return proximo;
    });
  }

  function adicionarCampo() {
    setCampos((prev) => {
      if (prev.length >= CAMPOS_MAX) return prev;
      return [...prev, campoVazio()];
    });
  }

  function removerCampo(uid: string) {
    setCampos((prev) => {
      if (prev.length <= 1) return prev;
      const proximo = prev.filter((c) => c.uid !== uid);
      revalidar({ tipoProcessoId, unidadeId, campos: proximo });
      return proximo;
    });
  }

  const moverCampo = useCallback((from: number, to: number) => {
    setCampos((prev) => {
      if (to < 0 || to >= prev.length || from === to) return prev;
      const proximo = prev.slice();
      const [removido] = proximo.splice(from, 1);
      proximo.splice(to, 0, removido);
      return proximo;
    });
  }, []);

  // Pré-visualização (visão do Cidadão) — Req. 16.5.
  const camposPreview = useMemo(() => draftsParaPreview(campos), [campos]);
  const [previewValues, setPreviewValues] = useState<FormValues>(() =>
    valoresIniciais(draftsParaPreview(campos)),
  );

  // Reinicializa os valores da pré-visualização quando a estrutura muda
  // (ids/tipos/valores padrão), mantendo o preview coerente com a configuração.
  const previewChave = useMemo(
    () =>
      camposPreview
        .map((c) => `${c.id}:${c.tipo}:${String(c.valorPadrao ?? '')}`)
        .join('|'),
    [camposPreview],
  );
  useEffect(() => {
    setPreviewValues(valoresIniciais(camposPreview));
    // Recalcula apenas quando a assinatura estrutural do preview muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewChave]);

  function handlePreviewChange(campoId: string, valor: FormFieldValue) {
    setPreviewValues((prev) => ({ ...prev, [campoId]: valor }));
  }

  function handleSalvar() {
    setTentouSalvar(true);
    const { erros: resultado, valido } = validarDraft(draft, !editando);
    setErros(resultado);
    if (!valido) return;

    const camposPayload = draftsParaCampos(campos);
    if (editando) {
      onSalvar({ campos: camposPayload });
    } else {
      onCriar({
        tipoProcessoId: tipoProcessoId.trim(),
        unidadeId: unidadeId.trim(),
        campos: camposPayload,
      });
    }
  }

  const temErroGeral = tentouSalvar && (erros.tipoProcessoId || erros.unidadeId || erros.campos);

  return (
    <DndProvider backend={HTML5Backend}>
      <section className="flex flex-col gap-5" aria-label="Editor de formulário">
        {erroSalvar && (
          <Alert variant="danger" title="Não foi possível salvar o formulário">
            {erroSalvar}
          </Alert>
        )}

        {temErroGeral && (
          <Alert variant="danger" title="Verifique os campos destacados">
            {erros.campos ?? erros.tipoProcessoId ?? erros.unidadeId}
          </Alert>
        )}

        {/* Par destino (Tipo de Processo + Unidade) */}
        {editando ? (
          <div className="rounded-card bg-bg-alt px-4 py-3">
            <p className="text-sm text-text-secondary">
              Editando o formulário de{' '}
              <span className="font-medium text-text-primary">
                {nomeTipo(tiposProcesso, tipoProcessoId)}
              </span>{' '}
              na unidade{' '}
              <span className="font-medium text-text-primary">
                {nomeUnidade(unidades, unidadeId)}
              </span>
              . O par tipo + unidade não pode ser alterado após a criação.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label="Tipo de processo"
              required
              placeholder="Selecione um tipo"
              value={tipoProcessoId}
              error={erros.tipoProcessoId}
              disabled={salvando}
              options={tiposProcesso.map((t) => ({ label: t.nome, value: t.id }))}
              onChange={(e) => {
                setTipoProcessoId(e.target.value);
                revalidar({ tipoProcessoId: e.target.value, unidadeId, campos });
              }}
            />
            <Select
              label="Unidade"
              required
              placeholder="Selecione uma unidade"
              value={unidadeId}
              error={erros.unidadeId}
              disabled={salvando}
              options={unidades.map((u) => ({ label: u.nome, value: u.id }))}
              onChange={(e) => {
                setUnidadeId(e.target.value);
                revalidar({ tipoProcessoId, unidadeId: e.target.value, campos });
              }}
            />
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Coluna: construtor de campos */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-heading text-base font-semibold text-text-primary">
                Campos ({campos.length}/{CAMPOS_MAX})
              </h3>
              <Button
                variant="secondary"
                disabled={salvando || campos.length >= CAMPOS_MAX}
                onClick={adicionarCampo}
              >
                Adicionar campo
              </Button>
            </div>

            <div className="flex flex-col gap-4">
              {campos.map((campo, index) => (
                <CampoCard
                  key={campo.uid}
                  campo={campo}
                  index={index}
                  total={campos.length}
                  erros={erros.porCampo[campo.uid]}
                  disabled={salvando}
                  onMover={moverCampo}
                  onAtualizar={atualizarCampo}
                  onRemover={removerCampo}
                />
              ))}
            </div>
          </div>

          {/* Coluna: pré-visualização (visão do Cidadão — Req. 16.5) */}
          <div className="flex flex-col gap-3">
            <h3 className="font-heading text-base font-semibold text-text-primary">
              Pré-visualização
            </h3>
            <div className="rounded-card border border-bg-alt bg-bg p-4">
              {camposPreview.length === 0 ? (
                <p className="text-sm text-text-secondary">
                  Adicione campos para visualizar o formulário.
                </p>
              ) : (
                <DynamicFormRenderer
                  campos={camposPreview}
                  value={previewValues}
                  onChange={handlePreviewChange}
                />
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-bg-alt pt-4">
          <Button variant="secondary" onClick={onCancelar} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={handleSalvar} loading={salvando}>
            {salvando ? (
              <span className="inline-flex items-center gap-2">
                <Spinner size="sm" className="text-current" /> Salvando...
              </span>
            ) : editando ? (
              'Salvar formulário'
            ) : (
              'Criar formulário'
            )}
          </Button>
        </div>
      </section>
    </DndProvider>
  );
}

export default FormularioEditor;
