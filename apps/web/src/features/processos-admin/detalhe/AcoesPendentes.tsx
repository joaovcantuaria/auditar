import { Alert } from '@/components/ui';
import type { AcoesPendentesResumo } from './api';

/**
 * Seção "Ações Pendentes" do Detalhe Administrativo (Task 28.1, Req 24.3).
 *
 * Renderiza, a partir do campo `acoesPendentes` do detalhe estendido
 * (`GET /admin/processos/:id`):
 *  - a próxima etapa prevista no fluxo (ou finalização, quando não houver);
 *  - os documentos solicitados ao cidadão ainda não anexados.
 *
 * É um bloco puramente informativo; a anexação em si é feita na aba Documentos
 * (Task 28.2). Quando não há próxima etapa nem pendências de documentos, exibe
 * um aviso positivo de "sem ações pendentes".
 *
 * _Requirements: 24.3_
 */
export interface AcoesPendentesProps {
  acoesPendentes: AcoesPendentesResumo;
}

export function AcoesPendentes({ acoesPendentes }: AcoesPendentesProps) {
  const { proximaEtapa, documentosSolicitadosPendentes } = acoesPendentes;
  const temDocsPendentes = documentosSolicitadosPendentes.length > 0;
  const semPendencias = !proximaEtapa && !temDocsPendentes;

  return (
    <section
      aria-labelledby="acoes-pendentes-heading"
      className="rounded-card border border-neutral bg-white p-4"
    >
      <h3
        id="acoes-pendentes-heading"
        className="mb-3 text-base font-semibold text-text-primary"
      >
        Ações pendentes
      </h3>

      {semPendencias ? (
        <p className="text-sm text-text-secondary">
          Não há ações pendentes para o avanço deste processo.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">
              Próxima etapa
            </p>
            <p className="text-sm text-text-primary">
              {proximaEtapa ? proximaEtapa.nome : 'Última etapa (finalização)'}
            </p>
          </div>

          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-secondary">
              Documentos solicitados pendentes
            </p>
            {temDocsPendentes ? (
              <Alert variant="warning">
                <ul className="list-disc pl-5">
                  {documentosSolicitadosPendentes.map((doc) => (
                    <li key={doc}>{doc}</li>
                  ))}
                </ul>
                Anexe os documentos acima na aba Documentos para liberar o avanço da etapa.
              </Alert>
            ) : (
              <p className="text-sm text-text-secondary">
                Nenhum documento solicitado está pendente.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export default AcoesPendentes;
