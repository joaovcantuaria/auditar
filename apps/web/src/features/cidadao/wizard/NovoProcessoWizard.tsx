import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { CampoFormulario } from '@auditar/shared';
import { Alert, Button } from '@/components/ui';
import { cn } from '@/lib/cn';
import { queryKeys } from '@/hooks/useSocket';
import {
  useWizardStore,
  WIZARD_FIRST_STEP,
  WIZARD_LAST_STEP,
  type WizardStep,
} from '@/store/wizardStore';
import { toRespostas, type FormValues, type FormFieldValue } from '@/features/formularios';
import {
  criarProcesso,
  enviarDocumentos,
  extrairMensagemErro,
  type CriarProcessoResultado,
  type UploadResultado,
} from './wizard.api';
import { StepCategoria } from './steps/StepCategoria';
import { StepTipo } from './steps/StepTipo';
import { StepUnidade } from './steps/StepUnidade';
import { StepFormulario } from './steps/StepFormulario';
import { StepDocumentos } from './steps/StepDocumentos';
import { StepRevisao } from './steps/StepRevisao';

/**
 * NovoProcessoWizard — assistente de 6 etapas para o Cidadão abrir um Processo
 * (Req. 4.1–4.13).
 *
 * Estado dos 6 steps: mantido no `wizardStore` (step atual, categoria, tipo,
 * unidade e respostas do formulário). O estado que NÃO é serializável ou é
 * exclusivo desta tela vive localmente:
 *   - `arquivos` (File[]) coletados no step 5 (o upload ocorre no submit);
 *   - `campos` do formulário carregado (para o gate de avanço e a revisão);
 *   - flags de validade do formulário, submissão, resultado e erro.
 *
 * Navegação: um `StepIndicator` mostra o progresso (1–6); os botões
 * "Voltar"/"Avançar" respeitam o gate por step — não avança enquanto o step
 * atual não estiver válido. Voltar nunca perde dados (Req. 4.9).
 *
 * Submissão (step 6): cria o Processo (`POST /processos`) e, em seguida, envia
 * os documentos anexados (ver ordem em `wizard.api.ts`). Em caso de sucesso,
 * exibe o Protocolo (Req. 4.8) e um link para o detalhe; em caso de falha na
 * criação, preserva TODO o estado do wizard e exibe o erro para nova tentativa
 * (Req. 4.11). O store só é resetado após o sucesso (ao sair) ou no cancelamento.
 *
 * _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.13_
 */

const STEP_TITLES: Record<WizardStep, string> = {
  1: 'Categoria',
  2: 'Tipo de processo',
  3: 'Unidade',
  4: 'Formulário',
  5: 'Documentos',
  6: 'Revisão',
};

export function NovoProcessoWizard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // --- Estado do wizardStore ----------------------------------------------
  const step = useWizardStore((s) => s.step);
  const categoriaId = useWizardStore((s) => s.categoriaId);
  const tipoProcessoId = useWizardStore((s) => s.tipoProcessoId);
  const unidadeId = useWizardStore((s) => s.unidadeId);
  const answers = useWizardStore((s) => s.answers);
  const setStep = useWizardStore((s) => s.setStep);
  const nextStep = useWizardStore((s) => s.nextStep);
  const prevStep = useWizardStore((s) => s.prevStep);
  const setCategoria = useWizardStore((s) => s.setCategoria);
  const setTipoProcesso = useWizardStore((s) => s.setTipoProcesso);
  const setUnidade = useWizardStore((s) => s.setUnidade);
  const setAnswer = useWizardStore((s) => s.setAnswer);
  const setAnswers = useWizardStore((s) => s.setAnswers);
  const reset = useWizardStore((s) => s.reset);

  // --- Estado local ---------------------------------------------------------
  // Rótulos das seleções, para a revisão (step 6).
  const [categoriaNome, setCategoriaNome] = useState('');
  const [tipoNome, setTipoNome] = useState('');
  const [unidadeNome, setUnidadeNome] = useState('');
  // Unidades atendentes declaradas pelo tipo selecionado (restringe o step 3).
  const [unidadesAtendentesIds, setUnidadesAtendentesIds] = useState<string[]>([]);
  // Arquivos coletados no step 5 (upload no submit).
  const [arquivos, setArquivos] = useState<File[]>([]);
  // Formulário: campos carregados + validade reportada pelo renderer.
  const [campos, setCampos] = useState<CampoFormulario[]>([]);
  const [formularioValido, setFormularioValido] = useState(false);
  // Submissão.
  const [submetendo, setSubmetendo] = useState(false);
  const [erroSubmissao, setErroSubmissao] = useState<string | undefined>();
  const [resultado, setResultado] = useState<CriarProcessoResultado | undefined>();
  const [uploads, setUploads] = useState<UploadResultado[]>([]);

  const values = answers as FormValues;

  // --- Handlers de seleção (com captura dos rótulos p/ revisão) -------------
  const handleCategoria = useCallback(
    (id: string, nome: string) => {
      setCategoria(id);
      setCategoriaNome(nome);
      // Dependentes limpos pelo store; limpamos os rótulos locais associados.
      setTipoNome('');
      setUnidadeNome('');
      setUnidadesAtendentesIds([]);
      setCampos([]);
    },
    [setCategoria],
  );

  const handleTipo = useCallback(
    (id: string, nome: string, unidadeIds: string[]) => {
      setTipoProcesso(id);
      setTipoNome(nome);
      setUnidadesAtendentesIds(unidadeIds);
      setUnidadeNome('');
      setCampos([]);
    },
    [setTipoProcesso],
  );

  const handleUnidade = useCallback(
    (id: string, nome: string) => {
      setUnidade(id);
      setUnidadeNome(nome);
      setCampos([]);
    },
    [setUnidade],
  );

  const handleFormChange = useCallback(
    (campoId: string, valor: FormFieldValue) => setAnswer(campoId, valor),
    [setAnswer],
  );

  const handleReplaceValues = useCallback(
    (novos: FormValues) => setAnswers(novos),
    [setAnswers],
  );

  const handleValidity = useCallback((valido: boolean, camposCarregados: CampoFormulario[]) => {
    setFormularioValido(valido);
    setCampos(camposCarregados);
  }, []);

  // --- Gate de avanço por step ---------------------------------------------
  const podeAvancar = useMemo(() => {
    switch (step) {
      case 1:
        return Boolean(categoriaId);
      case 2:
        return Boolean(tipoProcessoId);
      case 3:
        return Boolean(unidadeId);
      case 4:
        return formularioValido;
      case 5:
        return true; // documentos são opcionais
      default:
        return true;
    }
  }, [step, categoriaId, tipoProcessoId, unidadeId, formularioValido]);

  // --- Submissão (step 6) ---------------------------------------------------
  async function handleConfirmar(): Promise<void> {
    if (!tipoProcessoId || !unidadeId) return;
    setSubmetendo(true);
    setErroSubmissao(undefined);
    try {
      const criado = await criarProcesso({
        tipoProcessoId,
        unidadeId,
        respostas: toRespostas(campos, values),
      });

      // Processo criado (Protocolo já gerado). Anexos são "best-effort": uma
      // falha de anexo não invalida o Processo criado (Req. 4.8).
      let resultadosUpload: UploadResultado[] = [];
      if (arquivos.length > 0) {
        resultadosUpload = await enviarDocumentos(criado.processoId, arquivos);
      }

      // Atualiza a lista de processos do Cidadão (Req. 3.6).
      void queryClient.invalidateQueries({ queryKey: queryKeys.processos() });

      setUploads(resultadosUpload);
      setResultado(criado);
    } catch (err) {
      // Falha na CRIAÇÃO: preserva todo o estado do wizard (Req. 4.11).
      setErroSubmissao(extrairMensagemErro(err, 'Ocorreu um erro ao abrir o processo.'));
    } finally {
      setSubmetendo(false);
    }
  }

  function handleCancelar(): void {
    reset();
    navigate('/processos');
  }

  function handleConcluir(): void {
    reset();
    if (resultado) {
      navigate(`/processos/${encodeURIComponent(resultado.protocolo)}`);
    } else {
      navigate('/processos');
    }
  }

  // --- Tela de sucesso (Protocolo) -----------------------------------------
  if (resultado) {
    const falhas = uploads.filter((u) => !u.sucesso);
    return (
      <section className="mx-auto flex max-w-2xl flex-col gap-6">
        <Alert variant="success" title="Processo aberto com sucesso!">
          Guarde o número do protocolo para acompanhar o andamento do seu processo.
        </Alert>

        <div className="flex flex-col items-center gap-2 rounded-card border border-neutral bg-white p-8 text-center">
          <span className="text-sm text-text-secondary">Protocolo</span>
          <span className="font-heading text-3xl font-semibold text-primary">
            {resultado.protocolo}
          </span>
        </div>

        {falhas.length > 0 && (
          <Alert variant="warning" title="Alguns anexos não foram enviados">
            <ul className="list-disc pl-5">
              {falhas.map((f) => (
                <li key={f.nome}>
                  {f.nome}: {f.erro}
                </li>
              ))}
            </ul>
            Você pode reenviá-los pela página de detalhe do processo.
          </Alert>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button onClick={handleConcluir}>Ver processo</Button>
          <Button variant="secondary" onClick={handleCancelar}>
            Voltar aos meus processos
          </Button>
        </div>
      </section>
    );
  }

  // --- Wizard ---------------------------------------------------------------
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold text-text-primary">Novo Processo</h1>
        <p className="text-sm text-text-secondary">
          Etapa {step} de {WIZARD_LAST_STEP}: {STEP_TITLES[step]}
        </p>
      </header>

      <StepIndicator current={step} onNavigate={setStep} />

      <div className="min-h-[16rem]">
        {step === 1 && (
          <StepCategoria categoriaId={categoriaId} onSelecionar={handleCategoria} />
        )}
        {step === 2 && categoriaId && (
          <StepTipo
            categoriaId={categoriaId}
            tipoProcessoId={tipoProcessoId}
            onSelecionar={handleTipo}
          />
        )}
        {step === 3 && tipoProcessoId && (
          <StepUnidade
            tipoProcessoId={tipoProcessoId}
            unidadesAtendentesIds={unidadesAtendentesIds}
            unidadeId={unidadeId}
            onSelecionar={handleUnidade}
          />
        )}
        {step === 4 && tipoProcessoId && unidadeId && (
          <StepFormulario
            tipoProcessoId={tipoProcessoId}
            unidadeId={unidadeId}
            values={values}
            onChange={handleFormChange}
            onReplaceValues={handleReplaceValues}
            onValidityChange={handleValidity}
          />
        )}
        {step === 5 && <StepDocumentos files={arquivos} onChange={setArquivos} />}
        {step === 6 && (
          <StepRevisao
            categoriaNome={categoriaNome}
            tipoNome={tipoNome}
            unidadeNome={unidadeNome}
            campos={campos}
            values={values}
            arquivos={arquivos}
            erroSubmissao={erroSubmissao}
          />
        )}
      </div>

      <footer className="flex flex-col gap-3 border-t border-neutral pt-4 sm:flex-row sm:justify-between">
        <Button variant="ghost" onClick={handleCancelar} disabled={submetendo}>
          Cancelar
        </Button>
        <div className="flex flex-col gap-3 sm:flex-row">
          {step > WIZARD_FIRST_STEP && (
            <Button variant="secondary" onClick={prevStep} disabled={submetendo}>
              Voltar
            </Button>
          )}
          {step < WIZARD_LAST_STEP ? (
            <Button onClick={nextStep} disabled={!podeAvancar}>
              Avançar
            </Button>
          ) : (
            <Button onClick={handleConfirmar} loading={submetendo}>
              Confirmar e abrir processo
            </Button>
          )}
        </div>
      </footer>
    </section>
  );
}

// ---------------------------------------------------------------------------
// StepIndicator — progresso 1–6, com navegação para etapas já visitadas.
// ---------------------------------------------------------------------------

interface StepIndicatorProps {
  current: WizardStep;
  onNavigate: (step: WizardStep) => void;
}

function StepIndicator({ current, onNavigate }: StepIndicatorProps) {
  const steps: WizardStep[] = [1, 2, 3, 4, 5, 6];
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="Progresso do assistente">
      {steps.map((s) => {
        const estado = s === current ? 'atual' : s < current ? 'concluido' : 'futuro';
        const podeVoltar = s < current;
        return (
          <li key={s} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!podeVoltar && s !== current}
              aria-current={s === current ? 'step' : undefined}
              onClick={() => podeVoltar && onNavigate(s)}
              className={cn(
                'flex min-h-touch items-center gap-2 rounded-btn px-3 py-1.5 text-sm',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                estado === 'atual' && 'bg-primary text-white',
                estado === 'concluido' && 'bg-primary-light text-primary-dark hover:bg-primary/20',
                estado === 'futuro' && 'bg-bg-alt text-text-secondary',
                !podeVoltar && s !== current && 'cursor-not-allowed',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold',
                  estado === 'atual' ? 'bg-white text-primary' : 'bg-white/60 text-text-secondary',
                )}
              >
                {s}
              </span>
              <span className="hidden sm:inline">{STEP_TITLES[s]}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export default NovoProcessoWizard;
