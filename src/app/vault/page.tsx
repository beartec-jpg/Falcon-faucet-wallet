// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
import { redirect } from 'next/navigation'

/** Moved into the Wallet cylinder: /vault → /wallet?tab=vault (other query params kept). */
export default async function VaultRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (k === 'tab') continue
    if (Array.isArray(v)) v.forEach((x) => q.append(k, x))
    else if (v != null) q.set(k, v)
  }
  q.set('tab', 'vault')
  redirect(`/wallet?${q.toString()}`)
}
