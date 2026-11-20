import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { newId } from '../../shared/random.js';
import { useApp } from '../app/store.js';
/** Repeats that still move by one, and then by five, before a hold moves by ten. */
export const HOLD_SINGLE_STEPS = 9;
export const HOLD_FIVE_STEPS = 21;
export function HoldButton({
  label,
  children,
  disabled,
  onStep,
  className = '',
  accelerate = false,
}: {
  label: string;
  children: ReactNode;
  disabled?: boolean;
  /** `size` is 1 unless `accelerate` is set and the control has been held for a while. */
  onStep: (groupId: string, size: number) => void;
  className?: string;
  /** A long hold moves in fives, then tens, so a big swing takes a moment instead of a minute. */
  accelerate?: boolean;
}) {
  const pointers = useRef(new Map<number, { timer: ReturnType<typeof setTimeout>; group: string }>());
  const step = useRef(onStep);
  step.current = onStep;
  const stop = useCallback((id: number) => {
    const entry = pointers.current.get(id);
    if (entry) clearTimeout(entry.timer);
    pointers.current.delete(id);
  }, []);
  const clear = useCallback(() => {
    for (const id of pointers.current.keys()) stop(id);
  }, [stop]);
  useEffect(() => {
    document.addEventListener('visibilitychange', clear);
    window.addEventListener('blur', clear);
    window.addEventListener('mtg-cancel-input', clear);
    return () => {
      clear();
      document.removeEventListener('visibilitychange', clear);
      window.removeEventListener('blur', clear);
      window.removeEventListener('mtg-cancel-input', clear);
    };
  }, [clear]);
  useEffect(() => {
    if (disabled) clear();
  }, [disabled, clear]);
  const feedback = () => {
    const p = useApp.getState().profile;
    if (p.haptics) navigator.vibrate?.(8);
  };
  return (
    <button
      className={`hold ${className}`}
      disabled={disabled}
      aria-label={label}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.button !== 0 || disabled) return;
        e.preventDefault();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          return;
        }
        const pid = e.pointerId,
          group = newId();
        step.current(group, 1);
        feedback();
        let repeats = 0;
        const repeat = () => {
          if (!pointers.current.has(pid)) return;
          repeats++;
          const size = !accelerate || repeats <= HOLD_SINGLE_STEPS ? 1 : repeats <= HOLD_FIVE_STEPS ? 5 : 10;
          step.current(group, size);
          pointers.current.get(pid)!.timer = setTimeout(repeat, size === 1 ? 130 : 190);
        };
        pointers.current.set(pid, { group, timer: setTimeout(repeat, 350) });
      }}
      onPointerUp={(e) => stop(e.pointerId)}
      onPointerCancel={(e) => stop(e.pointerId)}
      onLostPointerCapture={(e) => stop(e.pointerId)}
      onClick={(e) => {
        if (e.detail === 0 && !disabled) {
          step.current(newId(), 1);
          feedback();
        }
      }}
    >
      {children}
    </button>
  );
}
