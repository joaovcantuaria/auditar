import type { CampoFormulario } from '@auditar/shared';
import { TipoCampo } from '@auditar/shared';
import { Alert } from '@/components/ui';
import type { FormValues } from '@/features/formularios';
import { formatarTamanho } from '../documentos.validacao';

/**
 * Step 6 do wizard — revisão das escolhas antes de confirmar (Req. 4.7).
 *
 * Apenas apresentação: exibe as seleções (categoria, tipo, unidade), as
 * respostas do formulário (com rótulos) e a lista de documentos anexados. A
 * submissão em si (criar processo → anexar documentos → exibir protocolo) é
 * orquestrada pelo container `NovoProcessoWizard`.
 */

interface StepRevisaoProps {
  categoriaNome: string;
  tipoNome: string;
  unidadeNome: string;
  campos: CampoFormulario[];
  values: FormValues;
  arquivos: File[];
  /** Mensagem de erro da submissão anterior (Req. 4.11 — dados preservados). */
  erroSubmissao?: string;
}

/** Converte o valor de um campo em texto legível para a revisão. */
function valorLegivel(campo: CampoFormulario, valor: FormValues[string]): string {
  if (valor === undefined || valor === null) return '—';
  if (campo.tipo === TipoCampo.SELECAO_MULTIPLA && Array.isArray(valor)) {
    return valor.length > 0 ? (valor as string[]).join(', ') : '—';
  }
  if (Array.isArray(valor)) {
    // Upload no formulário dinâmico (File[]): mostra os nomes.
    const arquivos = valor as File[];
    return arquivos.length > 0 ? arquivos.map((f) => f.name).join(', ') : '—';
  }
  const texto = String(valor).trim();
  return texto.length > 0 ? texto : '—';
}

export function StepRevisao({
  categoriaNome,
  tipoNome,
  unidadeNome,
  campos,
  values,
  arquivos,
  erroSubmissao,
}: StepRevisaoProps) {
  return (
    <div className="flex flex-col gap-6">
      {erroSubmissao && (
        <Alert variant="danger" title="Não foi possível abrir o processo">
          {erroSubmissao} Seus dados foram preservados — revise e tente confirmar novamente.
        </Alert>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="font-heading text-base font-semibold text-text-primary">Seleções</h3>
        <dl className="grid grid-cols-1 gap-2 rounded-card border border-neutral bg-white p-4 sm:grid-cols-3">
          <ResumoItem termo="Categoria" descricao={categoriaNome} />
          <ResumoItem termo="Tipo de processo" descricao={tipoNome} />
          <ResumoItem termo="Unidade" descricao={unidadeNome} />
        </dl>
      </section>

      {campos.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="font-heading text-base font-semibold text-text-primary">
            Dados do formulário
          </h3>
          <dl className="flex flex-col gap-2 rounded-card border border-neutral bg-white p-4">
            {campos
              .filter((campo) => campo.tipo !== TipoCampo.UPLOAD)
              .map((campo) => (
                <ResumoItem
                  key={campo.id}
                  termo={campo.rotulo}
                  descricao={valorLegivel(campo, values[campo.id])}
                />
              ))}
          </dl>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="font-heading text-base font-semibold text-text-primary">Documentos</h3>
        {arquivos.length === 0 ? (
          <p className="text-sm text-text-secondary">Nenhum documento anexado.</p>
        ) : (
          <ul className="flex flex-col gap-1 rounded-card border border-neutral bg-white p-4 text-sm text-text-primary">
            {arquivos.map((file, indice) => (
              <li key={`${file.name}-${indice}`} className="flex justify-between gap-3">
                <span>{file.name}</span>
                <span className="text-text-secondary">{formatarTamanho(file.size)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

interface ResumoItemProps {
  termo: string;
  descricao: string;
}

function ResumoItem({ termo, descricao }: ResumoItemProps) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs font-medium uppercase tracking-wide text-text-secondary">{termo}</dt>
      <dd className="text-sm text-text-primary">{descricao}</dd>
    </div>
  );
}

export default StepRevisao;
