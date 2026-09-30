import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * Root application shell.
 *
 * Phase 0 intentionally contains no routes: the public store, customer panel
 * and admin panel are implemented in later phases together with the
 * Neo-Brutalist design system.
 */
export const metadata: Metadata = {
  title: 'RuangNode',
  description: 'Digital products and managed application hosting.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
