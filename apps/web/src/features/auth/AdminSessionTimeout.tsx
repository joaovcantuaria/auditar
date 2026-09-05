import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Modal } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { useIdleTimeout } from '@/hooks/useIdleTimeout';

export interface AdminSessionTimeoutProps {
  /** Duração total de inatividade até logout (ms). Padrão: 60 min (hook). */
  timeoutMs?: number;
  /** Antecedência do aviso (ms). Padrão: 2 min (hook). */
  warningMs?: number;
}

/**
 * Encerramento de sessão por inatividade do Servidor (Req. 8.7).
 *
 * Monta o `useIdleTimeout` apenas para sessões de servidor autenticadas. Exibe
 * um `Modal` de aviso pouco antes do timeout ("Sua sessão expirará em breve")
 * com contagem regressiva e opção de continuar conectado; ao esgotar, faz
 * `logout()` e redireciona para `/admin/login`.
 *
 * Renderiza `null` (fora do modal), portanto pode ser colocado em qualquer
 * ponto do shell administrativo sem impacto no layout.
 */
export function AdminSessionTimeout({ timeoutMs, warningMs }: AdminSessionTimeoutProps) {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.user?.role);

  const enabled = isAuthenticated && role === 'servidor';

  const handleTimeout = useCallback(() => {
    logout();
    navigate('/admin/login', { replace: true });
  }, [logout, navigate]);

  const { warning, remainingSeconds, stayActive } = useIdleTimeout({
    enabled,
    timeoutMs,
    warningMs,
    onTimeout: handleTimeout,
  });

  return (
    <Modal
      open={enabled && warning}
      onClose={stayActive}
      title="Sua sessão expirará em breve"
      size="sm"
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="secondary" onClick={handleTimeout}>
            Sair agora
          </Button>
          <Button onClick={stayActive}>Continuar conectado</Button>
        </>
      }
    >
      <p className="text-text-primary">
        Por inatividade, sua sessão será encerrada em{' '}
        <strong>{remainingSeconds}</strong> segundo(s). Deseja continuar conectado?
      </p>
    </Modal>
  );
}

export default AdminSessionTimeout;
