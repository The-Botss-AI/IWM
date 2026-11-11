import { useRef, type KeyboardEvent } from 'react';

/**
 * Roving tabindex and arrow keys for a row of `role="radio"` buttons: only the
 * checked item (or the first when none is checked) is tabbable, and the arrow
 * keys move focus and select, like native radios.
 */
export function useRadioKeys({
  count,
  current,
  select,
}: {
  count: number;
  current: number;
  select: (index: number) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function move(index: number) {
    const next = Math.min(count - 1, Math.max(0, index));
    select(next);
    refs.current[next]?.focus();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      move(current < 0 ? 0 : current + 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(current < 0 ? 0 : current - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      move(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      move(count - 1);
    }
  }

  return {
    onKeyDown,
    setRef: (index: number) => (el: HTMLButtonElement | null) => {
      refs.current[index] = el;
    },
    tabIndexFor: (index: number): 0 | -1 =>
      current === index || (current < 0 && index === 0) ? 0 : -1,
  };
}
