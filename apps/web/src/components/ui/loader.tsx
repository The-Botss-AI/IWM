'use client';

import { useEffect, useState, type CSSProperties } from 'react';

import { cn } from '@/lib/utils';

const SIZE = {
  xs: 'h-4 w-4',
  sm: 'h-5 w-5',
  md: 'h-8 w-8',
  lg: 'h-10 w-10',
} as const;

export type LoaderSize = keyof typeof SIZE;

/** One spin of the ring when it carries status text; the text changes once per spin. */
const MESSAGE_CYCLE_MS = 1800;

export interface LoaderProps {
  size?: LoaderSize;
  /** Announced to screen readers only. Never rendered as visible text. */
  label?: string;
  className?: string;
}

/**
 * The app's loading indicator: the animated gradient ring. Use this instead of
 * visible "Loading ..." copy. List and card areas that have a known shape
 * should prefer `Skeleton`.
 */
export function Loader({ size = 'md', label = 'Loading', className }: LoaderProps) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn('inline-flex items-center justify-center', className)}
    >
      <span aria-hidden className={cn('spinner-gradient', SIZE[size])} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Index into `count` messages that advances once per ring spin and loops. */
function useMessageCycle(count: number): number {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (count < 2) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % count), MESSAGE_CYCLE_MS);
    return () => window.clearInterval(id);
  }, [count]);
  return count > 0 ? index % count : 0;
}

export interface PageLoaderProps {
  label?: string;
  /**
   * Visible status lines shown under the ring for longer waits (app boot,
   * workspace load). The ring spins once per line, then the next line shows;
   * the list loops. Screen readers hear `label` once, not every line.
   */
  messages?: readonly string[];
  /** Fill the viewport (app boot) instead of a content area. */
  fullScreen?: boolean;
  className?: string;
}

/** A centered loader for a whole page, panel or route. */
export function PageLoader({
  label = 'Loading',
  messages,
  fullScreen = false,
  className,
}: PageLoaderProps) {
  const lines = messages ?? [];
  const index = useMessageCycle(lines.length);
  const spin = { '--spin-duration': `${MESSAGE_CYCLE_MS}ms` } as CSSProperties;
  return (
    <div
      className={cn(
        'flex w-full flex-col items-center justify-center gap-4',
        fullScreen ? 'min-h-screen' : 'min-h-[40vh]',
        className,
      )}
    >
      {lines.length > 0 ? (
        <>
          <span role="status" className="inline-flex" style={spin}>
            <span aria-hidden className={cn('spinner-gradient', SIZE.lg)} />
            <span className="sr-only">{label}</span>
          </span>
          <p key={index} aria-hidden className="animate-fade-in text-ink-muted text-sm font-medium">
            {lines[index]}
          </p>
        </>
      ) : (
        <Loader size="lg" label={label} />
      )}
    </div>
  );
}
