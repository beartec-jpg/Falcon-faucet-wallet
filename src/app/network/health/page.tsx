// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
import { redirect } from 'next/navigation'

/** Network health now lives in the Explorer (network tab, #network-health section). */
export default function NetworkHealthRedirect() {
  redirect('/scan#network-health')
}
