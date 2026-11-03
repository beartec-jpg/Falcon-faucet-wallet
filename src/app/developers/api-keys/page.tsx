// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
import ContentPage, { Section } from '@/components/content/ContentPage'
import { DevNav, TestnetNotice } from '@/components/developers/DevBits'
import ApiKeyRequest from '@/components/developers/ApiKeyRequest'
import { apiKeysEnabled } from '@/lib/developers/content'
import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta('/developers/api-keys', 'Get an API key', 'Request a Falcon Cloud RPC API key.')

export default function ApiKeysPage() {
  const on = apiKeysEnabled()
  return (
    <ContentPage current="community" title="Get an API key" back={{ href: '/developers', label: 'Developers' }}>
      <DevNav active="/developers/api-keys" />
      <TestnetNotice />
      {on ? (
        <ApiKeyRequest />
      ) : (
        <Section title="Keys are issued on request">
          <p data-testid="api-keys-closed">Every plan, including Free, needs an API key. Keys are issued manually on request through BEARTEC; self-serve sign-up is not available yet. Ask via the <a className="text-amber-300 hover:underline" href="/feedback">feedback page</a> or the <a className="text-amber-300 hover:underline" href="/community">community</a> channels, saying which plan you want. Your key is shown to you once; keep it private.</p>
          <p className="text-xs text-slate-400">Plan changes are also handled on request. No payment is taken on this site.</p>
        </Section>
      )}
    </ContentPage>
  )
}
