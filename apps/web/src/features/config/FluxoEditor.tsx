import { useCallback, useMemo, useRef, useState } from 'react';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import type { Identifier, XYCoord } from 'react-dnd';
import { calcularPrazoTotalFluxo } from '@auditar/shared';
import { Alert, Button, Input, Select, Spinner } from '@/components/ui';
import type {
  AutomacaoPayload,
  EtapaPayload,
  FluxoDetalhe,
  FluxoFormPayload,
} from './config.api';

/**
 * Editor visual de Fluxos (Painel Administrativo — Task 16.2 / Req. 15).
 *
 * Permite montar um Fluxo com uma lista ordenada de Etapas arrastáveis
 * (react-dnd), configurar cada Etapa (nome, prazo, servidor padrão, documentos
 * obrigatórios, observações obrigatórias e automações) e exibe em tempo real o
 * prazo total estimado (soma dos prazos das Etapas — Req. 15.5).
 *
 * Validações client-side espelham o backend (`fluxos.schema.ts`):
 *  - 15.6: o Fluxo precisa de ao menos 1 Etapa (máx. 50 — Req. 15.1);
 *  - 15.7: cada Etapa exige nome não vazio (≤100) e prazo inteiro em [1,365];
 *  - 15.2: documentos obrigatórios ≤20, observações ≤1000;
 *  - 15.3: até 10 automações por Etapa.
 *
 * O salvamento em si (POST/PUT) e a confirmação (Req. 15.4/15.8) são
 * responsabilidade do componente pai (`FluxosPage`), que recebe o payload
 * validado via `onSalvar`.
 *
 * _Requirements: 15.1, 15.2, 15.3, 15.5, 15.6, 15.7_
 */

// ---------------------------------------------------------------------------
// Limites (espelham fluxos.schema.ts do backend)
// ---------------------------------------------------------------------------

const NOME_MAX = 100;
const PRAZO_MIN = 1;
const PRAZO_MAX = 365;
const ETAPAS_MIN = 1;
const ETAPAS_MAX = 50;
const DOCS_MAX = 20;
const OBS_MAX = 1000;
const AUTOMACOES_MAX = 10;

const DND_TIPO_ETAPA = 'fluxo-etapa';

const TIPOS_AUTOMACAO: ReadonlyArray<{ label: string; value: AutomacaoPayload['tipo'] }> = [
  { label: 'E-mail ao cidadão', value: 'email_cidadao' },
  { label: 'Alerta ao servidor', value: 'alerta_servidor' },
  { label: 'Alterar status', value: 'alterar_status' },
];

// ---------------------------------------------------------------------------
// Modelo de estado local (com id estável para keys e drag-and-drop)
// ---------------------------------------------------------------------------

interface AutomacaoDraft {
  uid: string;
  tipo: AutomacaoPayload['tipo'];
  payload: string;
}

interface EtapaDraft {
  uid: string;
  nome: string;
  /** Mantido como string para permitir edição livre; validado ao salvar. */
  prazosDiasUteis: string;
  servidorPadraoId: string;
  documentosObrigatorios: string[];
  observacoesObrigatorias: string;
  automacoes: AutomacaoDraft[];
}

interface FluxoDraft {
  nome: string;
  etapas: EtapaDraft[];
}

let uidSeq = 0;
function novoUid(prefixo: string): string {
  uidSeq += 1;
  return `${prefixo}-${Date.now().toString(36)}-${uidSeq}`;
}

function etapaVazia(): EtapaDraft {
  return {
    uid: novoUid('etapa'),
    nome: '',
    prazosDiasUteis: '1',
    servidorPadraoId: '',
    documentosObrigatorios: [],
    observacoesObrigatorias: '',
    automacoes: [],
  };
}

/** Converte um Fluxo carregado do backend em rascunho editável. */
function fluxoParaDraft(fluxo: FluxoDetalhe | null): FluxoDraft {
  if (!fluxo) {
    return { nome: '', etapas: [etapaVazia()] };
  }
  return {
    nome: fluxo.nome,
    etapas: fluxo.etapas.map((etapa) => ({
      uid: novoUid('etapa'),
      nome: etapa.nome,
      prazosDiasUteis: String(etapa.prazosDiasUteis),
      servidorPadraoId: etapa.servidorPadraoId ?? '',
      documentosObrigatorios: etapa.documentosObrigatorios ?? [],
      observacoesObrigatorias: etapa.observacoesObrigatorias ?? '',
      automacoes: etapa.automacoes.map((a) => ({
        uid: novoUid('auto'),
        tipo: (a.tipo as AutomacaoPayload['tipo']) ?? 'email_cidadao',
        payload: a.payload,
      })),
    })),
  };
}

// ---------------------------------------------------------------------------
// Validação client-side (Req. 15.6 / 15.7)
// ---------------------------------------------------------------------------

interface ErrosEtapa {
  nome?: string;
  prazo?: string;
  servidor?: string;
}

interface ErrosFluxo {
  nome?: string;
  etapas?: string;
  porEtapa: Record<string, ErrosEtapa>;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validarDraft(draft: FluxoDraft): { erros: ErrosFluxo; valido: boolean } {
  const erros: ErrosFluxo = { porEtapa: {} };
  let valido = true;

  const nome = draft.nome.trim();
  if (nome.length === 0) {
    erros.nome = 'O nome do fluxo é obrigatório';
    valido = false;
  } else if (nome.length > NOME_MAX) {
    erros.nome = `O nome deve ter no máximo ${NOME_MAX} caracteres`;
    valido = false;
  }

  if (draft.etapas.length < ETAPAS_MIN) {
    erros.etapas = 'O fluxo deve ter ao menos uma etapa';
    valido = false;
  } else if (draft.etapas.length > ETAPAS_MAX) {
    erros.etapas = `Um fluxo pode ter no máximo ${ETAPAS_MAX} etapas`;
    valido = false;
  }

  draft.etapas.forEach((etapa) => {
    const errosEtapa: ErrosEtapa = {};
    const nomeEtapa = etapa.nome.trim();
    if (nomeEtapa.length === 0) {
      errosEtapa.nome = 'O nome da etapa é obrigatório';
      valido = false;
    } else if (nomeEtapa.length > NOME_MAX) {
      errosEtapa.nome = `Máximo de ${NOME_MAX} caracteres`;
      valido = false;
    }

    const prazo = Number(etapa.prazosDiasUteis);
    if (
      etapa.prazosDiasUteis.trim() === '' ||
      !Number.isInteger(prazo) ||
      prazo < PRAZO_MIN ||
      prazo > PRAZO_MAX
    ) {
      errosEtapa.prazo = `Prazo deve ser inteiro entre ${PRAZO_MIN} e ${PRAZO_MAX} dias úteis`;
      valido = false;
    }

    const servidor = etapa.servidorPadraoId.trim();
    if (servidor.length > 0 && !UUID_REGEX.test(servidor)) {
      errosEtapa.servidor = 'Informe um UUID válido do servidor padrão';
      valido = false;
    }

    if (Object.keys(errosEtapa).length > 0) {
      erros.porEtapa[etapa.uid] = errosEtapa;
    }
  });

  return { erros, valido };
}

/** Monta o payload aceito pelo backend a partir de um rascunho válido. */
function draftParaPayload(draft: FluxoDraft): FluxoFormPayload {
  return {
    nome: draft.nome.trim(),
    etapas: draft.etapas.map((etapa): EtapaPayload => {
      const servidor = etapa.servidorPadraoId.trim();
      const docs = etapa.documentosObrigatorios
        .map((d) => d.trim())
        .filter((d) => d.length > 0);
      const obs = etapa.observacoesObrigatorias.trim();
      const automacoes = etapa.automacoes.map(
        (a): AutomacaoPayload => ({ tipo: a.tipo, payload: a.payload }),
      );
      return {
        nome: etapa.nome.trim(),
        prazosDiasUteis: Number(etapa.prazosDiasUteis),
        servidorPadraoId: servidor.length > 0 ? servidor : undefined,
        documentosObrigatorios: docs.length > 0 ? docs : undefined,
        observacoesObrigatorias: obs.length > 0 ? obs : undefined,
        automacoes: automacoes.length > 0 ? automacoes : undefined,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Card de Etapa (arrastável)
// ---------------------------------------------------------------------------

interface DragItem {
  index: number;
  uid: string;
}

interface EtapaCardProps {
  etapa: EtapaDraft;
  index: number;
  total: number;
  erros?: ErrosEtapa;
  disabled: boolean;
  onMover: (from: number, to: number) => void;
  onAtualizar: (uid: string, patch: Partial<EtapaDraft>) => void;
  onRemover: (uid: string) => void;
}

function EtapaCard({
  etapa,
  index,
  total,
  erros,
  disabled,
  onMover,
  onAtualizar,
  onRemover,
}: EtapaCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  const [{ handlerId }, drop] = useDrop<DragItem, void, { handlerId: Identifier | null }>({
    accept: DND_TIPO_ETAPA,
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
    type: DND_TIPO_ETAPA,
    item: (): DragItem => ({ index, uid: etapa.uid }),
    canDrag: !disabled,
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
  });

  preview(drop(ref));

  // --- Handlers de documentos obrigatórios (Req. 15.2, ≤20) ---------------
  function adicionarDocumento() {
    if (etapa.documentosObrigatorios.length >= DOCS_MAX) return;
    onAtualizar(etapa.uid, {
      documentosObrigatorios: [...etapa.documentosObrigatorios, ''],
    });
  }
  function atualizarDocumento(i: number, valor: string) {
    const docs = etapa.documentosObrigatorios.slice();
    docs[i] = valor;
    onAtualizar(etapa.uid, { documentosObrigatorios: docs });
  }
  function removerDocumento(i: number) {
    onAtualizar(etapa.uid, {
      documentosObrigatorios: etapa.documentosObrigatorios.filter((_, idx) => idx !== i),
    });
  }

  // --- Handlers de automações (Req. 15.3, ≤10) ----------------------------
  function adicionarAutomacao() {
    if (etapa.automacoes.length >= AUTOMACOES_MAX) return;
    onAtualizar(etapa.uid, {
      automacoes: [
        ...etapa.automacoes,
        { uid: novoUid('auto'), tipo: 'email_cidadao', payload: '' },
      ],
    });
  }
  function atualizarAutomacao(i: number, patch: Partial<AutomacaoDraft>) {
    const automacoes = etapa.automacoes.slice();
    automacoes[i] = { ...automacoes[i], ...patch };
    onAtualizar(etapa.uid, { automacoes });
  }
  function removerAutomacao(i: number) {
    onAtualizar(etapa.uid, {
      automacoes: etapa.automacoes.filter((_, idx) => idx !== i),
    });
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
            aria-label={`Arraste para reordenar a etapa ${index + 1}`}
            disabled={disabled}
            className="min-h-touch min-w-touch cursor-grab rounded-btn px-2 text-text-secondary hover:bg-bg-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed"
          >
            <span aria-hidden="true">⠿</span>
          </button>
          <h4 className="font-heading text-sm font-semibold text-text-primary">
            Etapa {index + 1}
          </h4>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled || index === 0}
            aria-label="Mover etapa para cima"
            onClick={() => onMover(index, index - 1)}
          >
            ↑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled || index === total - 1}
            aria-label="Mover etapa para baixo"
            onClick={() => onMover(index, index + 1)}
          >
            ↓
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={disabled || total <= ETAPAS_MIN}
            onClick={() => onRemover(etapa.uid)}
          >
            Remover
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Nome da etapa"
          required
          maxLength={NOME_MAX}
          value={etapa.nome}
          error={erros?.nome}
          disabled={disabled}
          onChange={(e) => onAtualizar(etapa.uid, { nome: e.target.value })}
        />
        <Input
          label="Prazo (dias úteis)"
          type="number"
          required
          min={PRAZO_MIN}
          max={PRAZO_MAX}
          value={etapa.prazosDiasUteis}
          error={erros?.prazo}
          disabled={disabled}
          onChange={(e) => onAtualizar(etapa.uid, { prazosDiasUteis: e.target.value })}
        />
      </div>

      <div className="mt-4">
        <Input
          label="Servidor padrão (UUID) — opcional"
          value={etapa.servidorPadraoId}
          error={erros?.servidor}
          disabled={disabled}
          helperText="Identificador do servidor responsável padrão desta etapa"
          placeholder="00000000-0000-0000-0000-000000000000"
          onChange={(e) => onAtualizar(etapa.uid, { servidorPadraoId: e.target.value })}
        />
      </div>

      {/* Documentos obrigatórios (Req. 15.2, ≤20) */}
      <fieldset className="mt-4 rounded-card border border-bg-alt p-3">
        <legend className="px-1 text-sm font-medium text-text-primary">
          Documentos obrigatórios ({etapa.documentosObrigatorios.length}/{DOCS_MAX})
        </legend>
        <div className="flex flex-col gap-2">
          {etapa.documentosObrigatorios.map((doc, i) => (
            <div key={`${etapa.uid}-doc-${i}`} className="flex items-end gap-2">
              <div className="flex-1">
                <Input
                  label={`Documento ${i + 1}`}
                  value={doc}
                  disabled={disabled}
                  onChange={(e) => atualizarDocumento(i, e.target.value)}
                />
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                aria-label={`Remover documento ${i + 1}`}
                onClick={() => removerDocumento(i)}
              >
                Remover
              </Button>
            </div>
          ))}
          <div>
            <Button
              size="sm"
              variant="secondary"
              disabled={disabled || etapa.documentosObrigatorios.length >= DOCS_MAX}
              onClick={adicionarDocumento}
            >
              Adicionar documento
            </Button>
          </div>
        </div>
      </fieldset>

      {/* Observações obrigatórias (Req. 15.2, ≤1000) */}
      <div className="mt-4 flex flex-col gap-1">
        <label
          htmlFor={`${etapa.uid}-obs`}
          className="text-sm font-medium text-text-primary"
        >
          Observações obrigatórias — opcional
        </label>
        <textarea
          id={`${etapa.uid}-obs`}
          rows={2}
          maxLength={OBS_MAX}
          value={etapa.observacoesObrigatorias}
          disabled={disabled}
          className="w-full rounded-btn border border-neutral bg-white px-3 py-2 text-base text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:bg-bg-alt"
          onChange={(e) =>
            onAtualizar(etapa.uid, { observacoesObrigatorias: e.target.value })
          }
        />
        <p className="text-right text-xs text-text-secondary">
          {etapa.observacoesObrigatorias.length}/{OBS_MAX}
        </p>
      </div>

      {/* Automações (Req. 15.3, ≤10) */}
      <fieldset className="mt-4 rounded-card border border-bg-alt p-3">
        <legend className="px-1 text-sm font-medium text-text-primary">
          Automações ({etapa.automacoes.length}/{AUTOMACOES_MAX})
        </legend>
        <div className="flex flex-col gap-3">
          {etapa.automacoes.map((auto, i) => (
            <div key={auto.uid} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-end">
              <Select
                label={`Tipo ${i + 1}`}
                value={auto.tipo}
                disabled={disabled}
                options={TIPOS_AUTOMACAO.map((t) => ({ label: t.label, value: t.value }))}
                onChange={(e) =>
                  atualizarAutomacao(i, { tipo: e.target.value as AutomacaoPayload['tipo'] })
                }
              />
              <Input
                label="Payload"
                value={auto.payload}
                disabled={disabled}
                onChange={(e) => atualizarAutomacao(i, { payload: e.target.value })}
              />
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                aria-label={`Remover automação ${i + 1}`}
                onClick={() => removerAutomacao(i)}
              >
                Remover
              </Button>
            </div>
          ))}
          <div>
            <Button
              size="sm"
              variant="secondary"
              disabled={disabled || etapa.automacoes.length >= AUTOMACOES_MAX}
              onClick={adicionarAutomacao}
            >
              Adicionar automação
            </Button>
          </div>
        </div>
      </fieldset>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor principal
// ---------------------------------------------------------------------------

export interface FluxoEditorProps {
  /** Fluxo a editar; `null`/ausente inicia um novo fluxo. */
  fluxo?: FluxoDetalhe | null;
  /** Indica salvamento em andamento (desabilita os controles). */
  salvando?: boolean;
  /** Erro de salvamento (backend) a exibir no topo. */
  erroSalvar?: string;
  /** Recebe o payload validado para persistir (POST/PUT). */
  onSalvar: (payload: FluxoFormPayload) => void;
  /** Cancela e fecha o editor. */
  onCancelar: () => void;
}

export function FluxoEditor({
  fluxo = null,
  salvando = false,
  erroSalvar,
  onSalvar,
  onCancelar,
}: FluxoEditorProps) {
  const [draft, setDraft] = useState<FluxoDraft>(() => fluxoParaDraft(fluxo));
  const [erros, setErros] = useState<ErrosFluxo>({ porEtapa: {} });
  const [tentouSalvar, setTentouSalvar] = useState(false);

  const editando = Boolean(fluxo);

  // Prazo total estimado — recalculado a cada render (Req. 15.5). Prazos
  // inválidos/vazios contam como 0 no somatório visual.
  const prazoTotal = useMemo(() => {
    return calcularPrazoTotalFluxo(
      draft.etapas.map((e) => {
        const n = Number(e.prazosDiasUteis);
        return { prazosDiasUteis: Number.isFinite(n) && n > 0 ? n : 0 };
      }),
    );
  }, [draft.etapas]);

  const revalidar = useCallback(
    (proximo: FluxoDraft) => {
      if (tentouSalvar) {
        setErros(validarDraft(proximo).erros);
      }
    },
    [tentouSalvar],
  );

  function atualizarNome(nome: string) {
    setDraft((prev) => {
      const proximo = { ...prev, nome };
      revalidar(proximo);
      return proximo;
    });
  }

  function atualizarEtapa(uid: string, patch: Partial<EtapaDraft>) {
    setDraft((prev) => {
      const proximo = {
        ...prev,
        etapas: prev.etapas.map((e) => (e.uid === uid ? { ...e, ...patch } : e)),
      };
      revalidar(proximo);
      return proximo;
    });
  }

  function adicionarEtapa() {
    setDraft((prev) => {
      if (prev.etapas.length >= ETAPAS_MAX) return prev;
      return { ...prev, etapas: [...prev.etapas, etapaVazia()] };
    });
  }

  function removerEtapa(uid: string) {
    setDraft((prev) => {
      if (prev.etapas.length <= ETAPAS_MIN) return prev;
      const proximo = { ...prev, etapas: prev.etapas.filter((e) => e.uid !== uid) };
      revalidar(proximo);
      return proximo;
    });
  }

  const moverEtapa = useCallback((from: number, to: number) => {
    setDraft((prev) => {
      if (to < 0 || to >= prev.etapas.length || from === to) return prev;
      const etapas = prev.etapas.slice();
      const [removida] = etapas.splice(from, 1);
      etapas.splice(to, 0, removida);
      return { ...prev, etapas };
    });
  }, []);

  function handleSalvar() {
    setTentouSalvar(true);
    const { erros: resultado, valido } = validarDraft(draft);
    setErros(resultado);
    if (!valido) return;
    onSalvar(draftParaPayload(draft));
  }

  return (
    <DndProvider backend={HTML5Backend}>
      <section className="flex flex-col gap-5" aria-label="Editor de fluxo">
        {erroSalvar && (
          <Alert variant="danger" title="Não foi possível salvar o fluxo">
            {erroSalvar}
          </Alert>
        )}

        {tentouSalvar && (erros.nome || erros.etapas) && (
          <Alert variant="danger" title="Verifique os campos destacados">
            {erros.etapas ?? erros.nome}
          </Alert>
        )}

        <Input
          label="Nome do fluxo"
          required
          maxLength={NOME_MAX}
          value={draft.nome}
          error={erros.nome}
          disabled={salvando}
          onChange={(e) => atualizarNome(e.target.value)}
        />

        {/* Prazo total estimado (Req. 15.5) */}
        <div
          className="flex items-center justify-between rounded-card bg-bg-alt px-4 py-3"
          aria-live="polite"
        >
          <span className="text-sm font-medium text-text-primary">
            Prazo total estimado
          </span>
          <span className="font-heading text-lg font-semibold text-primary">
            {prazoTotal} {prazoTotal === 1 ? 'dia útil' : 'dias úteis'}
          </span>
        </div>

        <div className="flex items-center justify-between gap-3">
          <h3 className="font-heading text-base font-semibold text-text-primary">
            Etapas ({draft.etapas.length}/{ETAPAS_MAX})
          </h3>
          <Button
            variant="secondary"
            disabled={salvando || draft.etapas.length >= ETAPAS_MAX}
            onClick={adicionarEtapa}
          >
            Adicionar etapa
          </Button>
        </div>

        <div className="flex flex-col gap-4">
          {draft.etapas.map((etapa, index) => (
            <EtapaCard
              key={etapa.uid}
              etapa={etapa}
              index={index}
              total={draft.etapas.length}
              erros={erros.porEtapa[etapa.uid]}
              disabled={salvando}
              onMover={moverEtapa}
              onAtualizar={atualizarEtapa}
              onRemover={removerEtapa}
            />
          ))}
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
              'Salvar nova versão'
            ) : (
              'Salvar fluxo'
            )}
          </Button>
        </div>
      </section>
    </DndProvider>
  );
}

export default FluxoEditor;
