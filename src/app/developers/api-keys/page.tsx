// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
import ContentPage, { Section } from '@/components/content/ContentPage'
import { DevNav, TestnetNotice } from '@/components/developers/DevBits'
import FreeKeyButton from '@/components/developers/FreeKeyButton'
import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta('/developers/api-keys', 'Get an API key', 'Get a Falcon Cloud RPC API key.')

export default function ApiKeysPage() {
  return (
    <ContentPage current="community" title="Get an API key" back={{ href: '/developers', label: 'Developers' }}>
      <DevNav active="/developers/api-keys" />
      <TestnetNotice />
      <Section title="Free plan">
        <p data-testid="api-keys-free">Every plan, including Free, needs an API key. Get a Free key instantly, no card needed. Your key is shown once; keep it private. We store only a hash.</p>
        <FreeKeyButton />
      </Section>
      <Section title="Builder and Scale">
        <p>Paid plans are monthly subscriptions by card checkout on the <a className="text-amber-300 hover:underline" href="/developers/pricing">pricing page</a>. Your key is shown once when you return from checkout. If a subscription is cancelled or a payment fails, its key stops working.</p>
      </Section>
    </ContentPage>
  )
}
