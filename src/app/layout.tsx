import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import './globals.css'

const NETWORK = process.env.NEXT_PUBLIC_NETWORK_NAME ?? 'Falcon Ledger Testnet'

export const metadata: Metadata = {
  title: `${NETWORK}`,
  description: `${NETWORK} faucet and passkey wallet for development and testing.`,
  icons: { icon: '/falcon-logo.png', apple: '/falcon-logo.png' },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Falcon Wallet',
  },
}

export const viewport: Viewport = {
  themeColor: '#c07838',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* iOS PWA meta */}
        <meta name="mobile-web-app-capable" content="yes" />
        <link rel="apple-touch-icon" href="/falcon-logo.png" />
      </head>
      <body className="min-h-screen flex flex-col">
        {children}
        {/* Register service worker for PWA */}
        <Script id="sw-register" strategy="afterInteractive">{`
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js').catch(() => {});
          }
        `}</Script>
      </body>
    </html>
  )
}
