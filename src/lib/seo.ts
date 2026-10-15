import type { Metadata } from 'next'

export const SITE_URL = 'https://falcon-fpl.com'
export const SITE_NAME = 'Falcon PL'

/** Per-route metadata: title (templated), description, canonical, OG/Twitter. */
export function pageMeta(path: string, title: string, description: string): Metadata {
  return {
    // Absolute title + template: keeps "%s · Falcon PL" working for nested routes.
    title: { absolute: `${title} · ${SITE_NAME}`, template: `%s · ${SITE_NAME}` },
    description,
    alternates: { canonical: path },
    openGraph: {
      title: `${title} · ${SITE_NAME}`,
      description,
      url: path,
      type: 'website',
      siteName: SITE_NAME,
      images: ['/assets/images/brand/og-image.jpg'],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} · ${SITE_NAME}`,
      description,
      images: ['/assets/images/brand/og-image.jpg'],
    },
  }
}
