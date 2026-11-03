// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
// DEPRECATED: client wallet generates Falcon keys in-browser via WASM.
// Unauthenticated secret minting is disabled (fail closed).

import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  return NextResponse.json(
    {
      error:
        'Server-side wallet propose is disabled. Create wallets in-browser (WASM); never request falcon_secret from the API.',
      code: 'PROPOSE_DISABLED',
    },
    { status: 410 },
  )
}
