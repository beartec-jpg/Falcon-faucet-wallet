import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import Script from 'next/script'
import { headers } from 'next/headers'
import Providers from '@/components/Providers'
import { SITE_NAME, SITE_URL } from '@/lib/seo'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' })

const NETWORK = process.env.NEXT_PUBLIC_TESTNET_NAME ?? 'Falcon PL'

const HOME_DESCRIPTION =
  'Falcon PL: a quantum-safe participation ledger with Falcon-512 signatures from genesis. Testnet 2300 wallet, faucet and explorer are live.'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${NETWORK} — Quantum-safe participation ledger (testnet 2300)`,
    template: `%s · ${SITE_NAME}`,
  },
  description: HOME_DESCRIPTION,
  alternates: { canonical: '/' },
  icons: {
    icon: '/assets/images/brand/logo-mark.jpg',
    apple: '/assets/images/brand/apple-touch-icon.jpg',
  },
  manifest: '/manifest.json',
  openGraph: {
    title: `${NETWORK}`,
    description:
      'Quantum-safe participation ledger. Pre-public testnet 2300. Test tokens have no cash value.',
    url: '/',
    type: 'website',
    siteName: SITE_NAME,
    images: ['/assets/images/brand/og-image.jpg'],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Falcon PL',
  },
}

export const viewport: Viewport = {
  themeColor: '#c07838',
  width: 'device-width',
  initialScale: 1,
}

const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: SITE_URL,
      logo: `${SITE_URL}/assets/images/brand/logo-mark.jpg`,
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      name: SITE_NAME,
      url: SITE_URL,
      publisher: { '@id': `${SITE_URL}/#organization` },
    },
  ],
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the request makes every page dynamic, which a per-request CSP nonce needs (M-3).
  const nonce = (await headers()).get('x-nonce') ?? undefined
  return (
    <html lang="en" className={`dark ${inter.variable} ${jetbrainsMono.variable}`}>
      <head>
        {/* iOS PWA meta */}
        <meta name="mobile-web-app-capable" content="yes" />
        <script
          type="application/ld+json"
          nonce={nonce}
          // Static JSON, no user input.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
      </head>
      <body className="min-h-screen flex flex-col">
        <Providers>{children}</Providers>
        {/* Register service worker for PWA */}
        <Script id="sw-register" strategy="afterInteractive" nonce={nonce}>
          {process.env.NEXT_PUBLIC_DISABLE_SW === '1'
            ? `if ('serviceWorker' in navigator) { navigator.serviceWorker.getRegistrations().then(function(rs){ rs.forEach(function(r){ r.unregister(); }); }); }`
            : `if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js').catch(function(){}); }`}
        </Script>
      </body>
    </html>
  )
}
