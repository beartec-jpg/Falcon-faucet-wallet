// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
import ContentPage, { Code, Section } from '@/components/content/ContentPage'
import { DevNav, Table, TestnetNotice } from '@/components/developers/DevBits'
import { EXPLORER_ERROR_CODES, EXPLORER_URL, explorerEndpoints } from '@/lib/developers/content'
import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta('/developers/explorer-api', 'Explorer API docs', 'Falcon PL Explorer API v1: public read-only REST endpoints.')

export default function ExplorerApiDocs() {
  const eps = explorerEndpoints()
  return (
    <ContentPage current="community" title="Explorer API v1" back={{ href: '/developers', label: 'Developers' }}>
      <DevNav active="/developers/explorer-api" />
      <TestnetNotice />
      <Section title="Overview">
        <p>Public, read-only, no key needed. Base URL <span className="font-mono">{EXPLORER_URL}</span>. Machine-readable spec: <a className="text-amber-300 hover:underline" href="/v1/openapi.json">/v1/openapi.json</a> (OpenAPI 3.1).</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Amounts are objects <span className="font-mono">{'{ asset, raw, decimals, value }'}</span>; <span className="font-mono">raw</span> and <span className="font-mono">value</span> are strings.</li>
          <li>Lists take <span className="font-mono">?limit=</span> (1–100, default 25) and an opaque <span className="font-mono">?cursor=</span> from <span className="font-mono">page.next_cursor</span>.</li>
          <li>Every 200 has a weak ETag; send <span className="font-mono">If-None-Match</span> to get 304. <span className="font-mono">/v1/health</span> is never cached.</li>
          <li>CORS is open (<span className="font-mono">*</span>) and every response carries <span className="font-mono">x-api-version</span>.</li>
          <li>Order book endpoints return empty data with <span className="font-mono">active: false</span> before activation, and 501 if the node does not expose the RPC.</li>
        </ul>
      </Section>
      <Section title={`Endpoints (${eps.length})`}>
        <Table head={['GET', 'Summary', 'Params', 'Status codes']} rows={eps.map((e) => [e.path, e.summary, e.params.join(', ') || '—', e.statuses.join(' ')])} />
      </Section>
      <Section title="Example">
        <Code>{`curl -s ${EXPLORER_URL}/v1/explorer/blocks/latest
curl -s "${EXPLORER_URL}/v1/explorer/blocks?limit=10"
curl -s ${EXPLORER_URL}/v1/explorer/orderbook/BTC4-FPL?levels=20`}</Code>
      </Section>
      <Section title="Errors">
        <p>Errors look like <span className="font-mono">{'{ "error": { "code", "message" } }'}</span> and are never cached. Codes: {EXPLORER_ERROR_CODES.map((c) => <span key={c} className="font-mono mr-2">{c}</span>)}</p>
      </Section>
    </ContentPage>
  )
}
