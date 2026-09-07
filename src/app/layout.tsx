import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'smartnews',
  description: 'World news, clustered from many sources and summarised into one paragraph.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'smartnews', statusBarStyle: 'default' },
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
};

export const viewport: Viewport = {
  themeColor: '#f7f7fa',
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="wash" aria-hidden><i /><i /><i /></div>
        {children}
      </body>
    </html>
  );
}
