import Link from 'next/link';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { Logo } from '@/components/branding/logo';

/**
 * Minimal layout for public forms. Like `/sign/[token]` it mounts no app shell
 * or session gate: respondents have no account. The token in the URL is the
 * credential, so the page is never indexed and never sends a referrer.
 */
export const metadata: Metadata = {
  title: 'Form',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function PublicFormLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-bg-subtle flex min-h-screen flex-col">
      <header className="border-line flex h-14 items-center border-b bg-white px-4 sm:px-6">
        <Link href="/" aria-label="The Botss">
          <Logo size="sm" />
        </Link>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
