import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { BOOT } from '@/lib/boot';
import { AppHeader } from '@/components/AppHeader';
import { ServiceWorker } from '@/components/ServiceWorker';
import { StoryWarm } from '@/components/StoryWarm';
import { UpdateBanner } from '@/components/UpdateBanner';
import './globals.css';

export const metadata: Metadata = {
  title: 'smartnews',
  description: 'World news, clustered from many sources and summarised into one paragraph.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'smartnews', statusBarStyle: 'default' },
  icons: {
    icon: ['/icon.svg', '/icon-192.png'],
    apple: '/icon-192.png',
    // iOS generates no splash of its own: it shows one of these or a white
    // rectangle, and it will only show one whose media query matches the device
    // exactly. Hence a file per screen rather than one scaled image.
    other: [
    { rel: 'apple-touch-startup-image', url: '/splash/1290x2796.png',
      media: '(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)' },
    { rel: 'apple-touch-startup-image', url: '/splash/1284x2778.png',
      media: '(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)' },
    { rel: 'apple-touch-startup-image', url: '/splash/1242x2688.png',
      media: '(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)' },
    { rel: 'apple-touch-startup-image', url: '/splash/1179x2556.png',
      media: '(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)' },
    { rel: 'apple-touch-startup-image', url: '/splash/1170x2532.png',
      media: '(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)' },
    { rel: 'apple-touch-startup-image', url: '/splash/1125x2436.png',
      media: '(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)' },
    { rel: 'apple-touch-startup-image', url: '/splash/1242x2208.png',
      media: '(device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)' },
    { rel: 'apple-touch-startup-image', url: '/splash/828x1792.png',
      media: '(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)' },
    { rel: 'apple-touch-startup-image', url: '/splash/750x1334.png',
      media: '(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)' },
    { rel: 'apple-touch-startup-image', url: '/splash/1620x2160.png',
      media: '(device-width: 810px) and (device-height: 1080px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)' },
    { rel: 'apple-touch-startup-image', url: '/splash/1668x2388.png',
      media: '(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)' },
    { rel: 'apple-touch-startup-image', url: '/splash/2048x2732.png',
      media: '(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)' },
    ],
  },
};

export const viewport: Viewport = {
  // One static value, which BOOT overwrites in place before the first paint. It
  // exists so an installed app's status bar has the page's own ground to sit on
  // from the moment the document is parsed rather than the manifest's colour.
  themeColor: '#f7f7fa',
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
        <StoryWarm />
        <ServiceWorker />
        <UpdateBanner />
      </body>
    </html>
  );
}
