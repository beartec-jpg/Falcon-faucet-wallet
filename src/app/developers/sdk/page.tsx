// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
import ContentPage, { Section } from '@/components/content/ContentPage'
import { DevNav, TestnetNotice } from '@/components/developers/DevBits'
import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta('/developers/sdk', 'Falcon Sign SDK', 'Falcon Sign SDK: coming soon under Apache-2.0.')

export default function SdkPage() {
  return (
    <ContentPage current="community" title="Falcon Sign SDK" back={{ href: '/developers', label: 'Developers' }}>
      <DevNav active="/developers/sdk" />
      <TestnetNotice />
      <Section title="Coming soon">
        <p data-testid="sdk-coming-soon">A client SDK for building, Falcon-512 signing and submitting Falcon PL transactions. It will be released as open source under the <span className="font-mono">Apache-2.0</span> licence.</p>
        <p className="text-xs text-slate-400">Until then, use the <a className="text-amber-300 hover:underline" href="/developers/gateway">RPC gateway</a> and the <a className="text-amber-300 hover:underline" href="/developers/explorer-api">Explorer API</a>.</p>
      </Section>
    </ContentPage>
  )
}
