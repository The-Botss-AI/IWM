import { cn } from '@/lib/utils';

type Variant = 'full' | 'icon';
type SizePreset = 'sm' | 'md' | 'lg';

interface LogoProps {
  variant?: Variant;
  size?: SizePreset | number;
  className?: string;
  /** Always use the light wordmark (for dark surfaces in either theme). */
  inverse?: boolean;
}

const SIZE_PX: Record<SizePreset, number> = { sm: 24, md: 32, lg: 44 };
const ALT = 'IWM';

/**
 * Brand mark, from `public/branding/`:
 *   - `logo-icon.png`: the app icon alone, for collapsed sidebars and tight spaces;
 *   - `logo.png`: icon and wordmark with dark text, for light surfaces;
 *   - `logo-light.png`: the same with light text, used in dark mode and when
 *     `inverse` is set.
 * Replace those files (same names) to rebrand.
 *
 * Plain `<img>` rather than `next/image`: the files are small, the size is
 * height driven, and skipping the optimisation pipeline avoids layout shift.
 */
export function Logo({ variant = 'full', size = 'md', className, inverse }: LogoProps) {
  const height = typeof size === 'number' ? size : SIZE_PX[size];

  if (variant === 'icon') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/branding/logo-icon.png"
        alt={ALT}
        style={{ height, width: 'auto' }}
        className={cn('shrink-0 select-none', className)}
        draggable={false}
      />
    );
  }

  return (
    <span className={cn('inline-flex shrink-0 align-middle', className)}>
      {inverse ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/branding/logo-light.png"
          alt={ALT}
          style={{ height, width: 'auto' }}
          className="select-none"
          draggable={false}
        />
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/branding/logo.png"
            alt={ALT}
            style={{ height, width: 'auto' }}
            className="select-none dark:hidden"
            draggable={false}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/branding/logo-light.png"
            alt={ALT}
            style={{ height, width: 'auto' }}
            className="hidden select-none dark:block"
            draggable={false}
          />
        </>
      )}
    </span>
  );
}
