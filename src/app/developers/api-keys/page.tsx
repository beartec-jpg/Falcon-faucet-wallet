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
        <Section title="Not open yet">
          <p data-testid="api-keys-closed">API key sign-up opens when the RPC gateway launches. Follow the <a className="text-amber-300 hover:underline" href="/community">community</a> channels for the announcement.</p>
        </Section>
      )}
    </ContentPage>
  )
}
