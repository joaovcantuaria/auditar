import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_WARNING_MS,
  useIdleTimeout,
} from '../useIdleTimeout';

describe('useIdleTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('exposes the 60-minute default and a shorter pre-warning (Req. 8.7)', () => {
    expect(DEFAULT_IDLE_TIMEOUT_MS).toBe(60 * 60 * 1000);
    expect(DEFAULT_WARNING_MS).toBeLessThan(DEFAULT_IDLE_TIMEOUT_MS);
  });

  it('shows the warning before timeout and fires onTimeout at the end', () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() =>
      useIdleTimeout({ enabled: true, timeoutMs: 1000, warningMs: 400, onTimeout }),
    );

    expect(result.current.warning).toBe(false);

    // Advance to the warning threshold (timeout - warning = 600ms).
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current.warning).toBe(true);
    expect(onTimeout).not.toHaveBeenCalled();

    // Advance the rest of the way to trigger the logout.
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(result.current.warning).toBe(false);
  });

  it('resets the countdown on user activity before the warning', () => {
    const onTimeout = vi.fn();
    renderHook(() =>
      useIdleTimeout({ enabled: true, timeoutMs: 1000, warningMs: 400, onTimeout }),
    );

    act(() => {
      vi.advanceTimersByTime(500);
    });
    // Activity keeps the session alive.
    act(() => {
      window.dispatchEvent(new Event('keydown'));
    });
    act(() => {
      vi.advanceTimersByTime(700);
    });
    // Would have timed out at 1000ms without the reset; still alive here.
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('ignores activity while the warning is showing (requires explicit stayActive)', () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() =>
      useIdleTimeout({ enabled: true, timeoutMs: 1000, warningMs: 400, onTimeout }),
    );

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current.warning).toBe(true);

    // Activity during the warning must NOT reset the timer.
    act(() => {
      window.dispatchEvent(new Event('mousemove'));
      vi.advanceTimersByTime(400);
    });
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('stayActive dismisses the warning and reschedules the timers', () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() =>
      useIdleTimeout({ enabled: true, timeoutMs: 1000, warningMs: 400, onTimeout }),
    );

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current.warning).toBe(true);

    act(() => {
      result.current.stayActive();
    });
    expect(result.current.warning).toBe(false);

    // A full new cycle is needed before it would trigger again.
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(onTimeout).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('does nothing when disabled', () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() =>
      useIdleTimeout({ enabled: false, timeoutMs: 1000, warningMs: 400, onTimeout }),
    );

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onTimeout).not.toHaveBeenCalled();
    expect(result.current.warning).toBe(false);
  });
});
