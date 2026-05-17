import type { Metadata, Viewport } from 'next';
import { RootProvider } from 'fumadocs-ui/provider/next';
import type { ReactNode } from 'react';
import './global.css';

export const metadata: Metadata = {
  title: {
    default: 'Khone Docs',
    template: '%s | Khone Docs',
  },
  description:
    'Documentation for Khone, an HTTP microbatching gateway for AWS Lambda on Lambda Managed Instances.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body>
        <RootProvider
          search={{
            options: {
              type: 'static',
            },
          }}
          theme={{
            attribute: ['class', 'data-theme'],
            defaultTheme: 'system',
            enableSystem: true,
          }}
        >
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
