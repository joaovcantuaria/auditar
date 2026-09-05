import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Duração padrão da sessão por inatividade (Req. 8.7): 60 minutos.
 * O servidor é deslogado após esse período sem interação.
 */
export const DEFAULT_IDLE_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * Antecedência padrão do aviso: 2 minutos antes do logout, exibe o modal
 * "Sua sessão expirará em breve".
 */
export const DEFAULT_WARNING_MS = 2 * 60 * 1000;

/** Eventos de atividade do usuário que reiniciam o cronômetro de inatividade. */
const ACTIVITY_EVENTS: ReadonlyArray<keyof WindowEventMap> = [
  'mousemove',
  'mousedown',
  'keydown',
  'click',
  'scroll',
  'touchstart',
];

export interface UseIdleTimeoutOptions {
  /**
   * Quando `false`, o hook fica inerte (sem listeners nem timers). Deve ser
   * `true` apenas para sessões de servidor autenticadas.
   */
  enabled?: boolean;
  /** Duração total de inatividade até o logout, em ms. Padrão: 60 min. */
  timeoutMs?: number;
  /**
   * Antecedência do aviso em relação ao timeout, em ms. Padrão: 2 min.
   * Deve ser menor que `timeoutMs`.
   */
  warningMs?: number;
  /** Chamado quando o período de inatividade se esgota (deve deslogar/redirecionar). */
  onTimeout: () => void;
  /** Chamado quando o aviso é disparado (opcional; o estado `warning` já reflete isso). */
  onWarning?: () => void;
}

export interface UseIdleTimeoutResult {
  /** `true` enquanto o modal de aviso deve ser exibido (pré-logout). */
  warning: boolean;
  /** Segundos inteiros restantes até o logout durante o aviso (>= 0). */
  remainingSeconds: number;
  /**
   * Reinicia o cronômetro e esconde o aviso. Use no botão
   * "Continuar conectado" do modal de aviso.
   */
  stayActive: () => void;
}

/**
 * Hook reutilizável de timeout por inatividade (Req. 8.7).
 *
 * Rastreia atividade do usuário (mouse, teclado, clique, scroll, toque) e, após
 * `timeoutMs` sem interação, chama `onTimeout`. Em `warningMs` antes do fim,
 * ativa o estado `warning` e passa a expor `remainingSeconds` para uma contagem
 * regressiva no modal de aviso.
 *
 * O hook é autocontido e testável: não conhece o `authStore` nem o roteador —
 * o consumidor passa `onTimeout` (ex.: `logout()` + navegação para
 * `/admin/login`). Deve ser montado apenas para sessões de servidor via
 * `enabled`.
 */
export function useIdleTimeout({
  enabled = true,
  timeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  warningMs = DEFAULT_WARNING_MS,
  onTimeout,
  onWarning,
}: UseIdleTimeoutOptions): UseIdleTimeoutResult {
  const [warning, setWarning] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  const logoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Espelha `warning` para leitura síncrona dentro dos listeners de atividade. */
  const warningRef = useRef(false);

  // Mantém callbacks atualizados sem reinstalar os listeners a cada render.
  const onTimeoutRef = useRef(onTimeout);
  const onWarningRef = useRef(onWarning);
  onTimeoutRef.current = onTimeout;
  onWarningRef.current = onWarning;

  const clearTimers = useCallback(() => {
    if (logoutTimer.current) clearTimeout(logoutTimer.current);
    if (warningTimer.current) clearTimeout(warningTimer.current);
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    logoutTimer.current = null;
    warningTimer.current = null;
    countdownTimer.current = null;
  }, []);

  const startCountdown = useCallback(() => {
    warningRef.current = true;
    setWarning(true);
    onWarningRef.current?.();

    const deadline = Date.now() + Math.max(0, warningMs);
    setRemainingSeconds(Math.ceil(Math.max(0, warningMs) / 1000));

    countdownTimer.current = setInterval(() => {
      const secondsLeft = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemainingSeconds(secondsLeft);
      if (secondsLeft <= 0 && countdownTimer.current) {
        clearInterval(countdownTimer.current);
        countdownTimer.current = null;
      }
    }, 1000);
  }, [warningMs]);

  const scheduleTimers = useCallback(() => {
    clearTimers();
    warningRef.current = false;
    setWarning(false);

    const safeTimeout = Math.max(0, timeoutMs);
    const safeWarning = Math.min(Math.max(0, warningMs), safeTimeout);
    const warningDelay = Math.max(0, safeTimeout - safeWarning);

    warningTimer.current = setTimeout(startCountdown, warningDelay);
    logoutTimer.current = setTimeout(() => {
      clearTimers();
      warningRef.current = false;
      setWarning(false);
      onTimeoutRef.current();
    }, safeTimeout);
  }, [clearTimers, startCountdown, timeoutMs, warningMs]);

  const stayActive = useCallback(() => {
    scheduleTimers();
  }, [scheduleTimers]);

  useEffect(() => {
    if (!enabled) {
      clearTimers();
      setWarning(false);
      return;
    }

    scheduleTimers();

    // Durante o aviso NÃO reiniciamos por atividade: o usuário precisa
    // confirmar explicitamente ("Continuar conectado") via `stayActive`.
    const listener = () => {
      if (warningRef.current) return;
      scheduleTimers();
    };

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, listener, { passive: true });
    }

    return () => {
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, listener);
      }
      clearTimers();
    };
  }, [enabled, scheduleTimers, clearTimers]);

  return { warning, remainingSeconds, stayActive };
}

export default useIdleTimeout;
