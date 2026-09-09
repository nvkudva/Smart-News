import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { BOOT } from '@/lib/boot';
import { AppHeader } from '@/components/AppHeader';
import { ServiceWorker } from '@/components/ServiceWorker';
import { UpdateBanner } from '@/components/UpdateBanner';
import './globals.css';

export const metadata: Metadata = {
  title: 'smartnews',
  description: 'World news, clustered from many sources and summarised into one paragraph.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'smartnews', statusBarStyle: 'default' },
  icons: { icon: ['/icon.svg', '/icon-192.png'], apple: '/icon-192.png' },
};

export const viewport: Viewport = {
  // themeColor is not declared here on purpose: BOOT writes the meta tag from
  // the reader's stored theme before first paint, and a static one would race it.
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* next/script, not a bare <script>: React 19 hoists a script it finds
            in the tree, which desynchronises the body's children from the
            server HTML and leaves the whole page below the layout unhydrated.
            beforeInteractive is also the only strategy that runs early enough
            to place the rail and the theme before the first paint. */}
        <Script id="boot" strategy="beforeInteractive">{BOOT}</Script>
        <div className="wash" aria-hidden><i /><i /><i /></div>
        <AppHeader />
        {children}
        <ServiceWorker />
        <UpdateBanner />
      </body>
    </html>
  );
}
