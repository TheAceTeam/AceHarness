import type { Metadata } from 'next';
import 'material-symbols/outlined.css';
import 'dockview-react/dist/styles/dockview.css';
import './globals.css';
import { Providers } from './providers';
import { PRODUCT_DISPLAY_NAME } from '@/lib/core/branding';

export const metadata: Metadata = {
  title: PRODUCT_DISPLAY_NAME,
  description: `${PRODUCT_DISPLAY_NAME} - Agent Centric Engineering Harness`,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = process.env.CSIHARNESS_LOCALE === 'en' ? 'en' : 'zh-CN';

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
