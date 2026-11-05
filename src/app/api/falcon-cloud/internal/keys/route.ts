// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
// GET /api/falcon-cloud/internal/keys  (Authorization: Bearer $FALCON_CLOUD_EXPORT_TOKEN)
// -> { keys: [{ key_id, sha256, tier, stripe_customer, disabled }] }. Polled by fpl-gateway ([portal] config).
// Hashes only. 404 when the token isn't configured, 401 on a bad token.
import { NextRequest, NextResponse } from 'next/server'
import { exportToken, isExportAuthorized } from '@/lib/developers/export-auth'
import { listExportKeys } from '@/lib/developers/key-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store' }

export async function GET(req: NextRequest) {
  const token = exportToken()
  if (!token) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: noStore })
  if (!isExportAuthorized(req.headers.get('authorization'), token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore })
  }
  try {
    return NextResponse.json({ keys: await listExportKeys() }, { headers: noStore })
  } catch (e) {
    console.error('falcon-cloud key export failed:', (e as Error).message)
    return NextResponse.json({ error: 'Export failed' }, { status: 500, headers: noStore })
  }
}
