import type { Metadata } from 'next';
import 'material-symbols/outlined.css';
import 'dockview-react/dist/styles/dockview.css';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'ACEHarness',
  description: 'ACEHarness - Agent Centric Engineering Harness',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = process.env.ACE_LOCALE === 'en' ? 'en' : 'zh-CN';

  return (
    <html lang={locale} suppressHydrationWarning>
      <head />
      <body>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
