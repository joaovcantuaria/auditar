import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui';
import { useNotificacaoStore } from '@/store/notificacaoStore';
import { BellIcon } from './icons';

/** Formata a data ISO em algo curto e legível (pt-BR). */
function formatarData(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Sino de notificações do Header. Exibe o contador de não lidas (do
 * `notificacaoStore`) e abre um painel simples com a lista. A lógica completa
 * (fetch inicial, tempo real) chega na task 11.3 via `useNotificacoes`; aqui
 * ficam a apresentação e a interação básica (marcar como lida).
 */
export function NotificationBell() {
  const notificacoes = useNotificacaoStore((s) => s.notificacoes);
  const naoLidas = useNotificacaoStore((s) => s.naoLidas);
  const marcarComoLida = useNotificacaoStore((s) => s.marcarComoLida);
  const marcarTodasComoLidas = useNotificacaoStore((s) => s.marcarTodasComoLidas);

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // Fecha ao clicar fora ou pressionar Escape.
  useEffect(() => {
    if (!open) return undefined;

    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const contadorLabel =
    naoLidas > 0 ? `${naoLidas} notificações não lidas` : 'Sem notificações não lidas';

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notificações. ${contadorLabel}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className={cn(
          'relative inline-flex min-h-touch min-w-touch items-center justify-center rounded-btn',
          'text-text-secondary hover:bg-bg-alt hover:text-text-primary',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        )}
      >
        <BellIcon />
        {naoLidas > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-1.5 top-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-4 text-white"
          >
            {naoLidas > 99 ? '99+' : naoLidas}
          </span>
        )}
      </button>

      {open && (
        <div
          id={panelId}
          role="region"
          aria-label="Lista de notificações"
          className="absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-card border border-neutral/20 bg-white shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-neutral/15 px-4 py-3">
            <h2 className="font-heading text-sm font-semibold text-text-primary">
              Notificações
            </h2>
            {naoLidas > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="min-h-0 min-w-0 px-2 py-1 text-xs"
                onClick={() => marcarTodasComoLidas()}
              >
                Marcar todas como lidas
              </Button>
            )}
          </div>

          <ul className="max-h-96 overflow-y-auto">
            {notificacoes.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-text-secondary">
                Nenhuma notificação.
              </li>
            ) : (
              notificacoes.map((n) => (
                <li key={n.id} className="border-b border-neutral/10 last:border-0">
                  <button
                    type="button"
                    onClick={() => marcarComoLida(n.id)}
                    className={cn(
                      'flex w-full flex-col gap-0.5 px-4 py-3 text-left',
                      'hover:bg-bg-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                      !n.lida && 'bg-primary-light/50',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      {!n.lida && (
                        <span
                          aria-hidden="true"
                          className="h-2 w-2 shrink-0 rounded-full bg-primary"
                        />
                      )}
                      <span className="text-sm text-text-primary">{n.conteudo}</span>
                    </span>
                    <span className="text-xs text-text-secondary">
                      {formatarData(n.criadaEm)}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
