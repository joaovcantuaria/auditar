import { Alert, Badge } from '@/components/ui';

/**
 * Seção "Autenticação de dois fatores (2FA)" das Configurações do Cidadão
 * (Req. 2.5).
 *
 * Estado do backend: o perfil (`GET /cidadao/conta`) já expõe
 * `doisFatoresAtivo: boolean` e `doisFatoresCanal: string | null` — usamos esses
 * campos para refletir o estado atual do 2FA.
 *
 * BLOQUEIO DE BACKEND (documentado honestamente): as funções de serviço
 * `ativar2fa`/`desativar2fa` existem em `auth.2fa.service.ts`, mas NÃO há
 * nenhuma rota HTTP montada para ativá-las/desativá-las (a task 3.5 previa
 * `PATCH /api/v1/cidadao/conta/2fa`, porém ela não foi exposta em nenhum
 * router). Portanto, não é possível ligar/desligar o 2FA pela UI sem inventar
 * um endpoint inexistente. Esta seção apenas exibe o estado atual e orienta o
 * cidadão; o toggle será habilitado quando o endpoint for disponibilizado.
 *
 * _Requirements: 2.5_
 */

export interface DoisFatoresSectionProps {
  /** Indica se o 2FA está ativo (vem do perfil). */
  ativo?: boolean;
  /** Canal preferido do 2FA quando ativo (email/sms). */
  canal?: string | null;
}

/** Rótulo amigável do canal 2FA. */
function rotularCanal(canal?: string | null): string {
  if (canal === 'email') return 'E-mail';
  if (canal === 'sms') return 'SMS';
  return 'não definido';
}

export function DoisFatoresSection({ ativo = false, canal }: DoisFatoresSectionProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="text-sm text-text-primary">Status atual:</span>
        {ativo ? (
          <Badge color="green">Ativo</Badge>
        ) : (
          <Badge color="neutral">Inativo</Badge>
        )}
        {ativo && (
          <span className="text-sm text-text-secondary">Canal: {rotularCanal(canal)}</span>
        )}
      </div>

      <p className="text-sm text-text-secondary">
        A autenticação de dois fatores adiciona uma camada extra de segurança: além da senha, um
        código de 6 dígitos é solicitado no login.
      </p>

      <Alert variant="info" title="Ativação indisponível no momento">
        A alteração do 2FA pela conta ainda não está disponível nesta versão. Entre em contato com o
        suporte para ativar ou desativar a autenticação de dois fatores.
      </Alert>
    </div>
  );
}

export default DoisFatoresSection;
