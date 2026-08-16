import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import Script from 'next/script'
import Providers from '@/components/Providers'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' })

const NETWORK = process.env.NEXT_PUBLIC_TESTNET_NAME ?? 'Falcon PL'

export const metadata: Metadata = {
  title: `${NETWORK} — Quantum-Safe Ledger for Real Participation`,
  description:
    'Falcon PL is the quantum-safe participation ledger. Falcon Consensus, Falcon-512 from genesis, protocol-controlled treasury, and rewards for those who secure and use the network.',
  icons: { icon: '/assets/images/brand/logo-mark.jpg', apple: '/assets/images/brand/apple-touch-icon.jpg' },
  manifest: '/manifest.json',
  openGraph: {
    title: `${NETWORK}`,
    description: 'The quantum-safe ledger built for real participation.',
    images: ['/assets/images/brand/og-image.jpg'],
  },
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
    <html lang="en" className={`dark ${inter.variable} ${jetbrainsMono.variable}`}>
      <head>
        {/* iOS PWA meta */}
        <meta name="mobile-web-app-capable" content="yes" />
        <link rel="apple-touch-icon" href="/assets/images/brand/apple-touch-icon.jpg" />
      </head>
      <body className="min-h-screen flex flex-col">
        <Providers>{children}</Providers>
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
