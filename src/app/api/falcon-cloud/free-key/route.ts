// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
// POST /api/falcon-cloud/free-key { acceptTerms: true } -> { key, keyId, tier: 'free' } shown once.
// Self-serve Free tier: no Stripe. Only sha256(key) is stored; fpl-gateway picks it up via the hash-only export.
// Browser-only (origin check), per-IP burst limit plus durable per-IP/day and global/day caps in Postgres.
import { NextRequest, NextResponse } from 'next/server'
import { requireBrowserOrigin } from '@/lib/origin'
import { clientIp } from '@/lib/security'
import { hit } from '@/lib/api-guard'
import { mintApiKey } from '@/lib/developers/api-keys'
import { countFreeKeysSince, insertFreeKey } from '@/lib/developers/key-store'
import { freeMintAllowed, hashIp } from '@/lib/developers/key-policy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store' }
const BURST = { name: 'falcon-free-key', limit: 3, windowSec: 600 }

export async function POST(req: NextRequest) {
  if (!requireBrowserOrigin(req)) return NextResponse.json({ error: 'Origin not allowed' }, { status: 403, headers: noStore })
  let body: { acceptTerms?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: noStore }) }
  if (body.acceptTerms !== true) return NextResponse.json({ error: 'Please accept the Terms of Use.' }, { status: 400, headers: noStore })
  const salt = (process.env.FALCON_CLOUD_REVEAL_SECRET || process.env.FALCON_CLOUD_EXPORT_TOKEN)?.trim()
  if (!salt) return NextResponse.json({ error: 'Free keys are not available right now.' }, { status: 503, headers: noStore })
  const ip = clientIp(req)
  if (!(await hit(BURST, ip))) return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429, headers: noStore })
  const ipHash = hashIp(ip, salt)
  try {
    const verdict = freeMintAllowed(await countFreeKeysSince(ipHash, new Date(Date.now() - 24 * 3600 * 1000)))
    if (verdict === 'ip') return NextResponse.json({ error: 'Free key limit reached for today from this network.' }, { status: 429, headers: noStore })
    if (verdict === 'total') return NextResponse.json({ error: 'Free sign-ups are paused for today. Please try tomorrow.' }, { status: 429, headers: noStore })
    const { key, sha256, id } = mintApiKey()
    await insertFreeKey({ keyId: id, sha256, ipHash })
    return NextResponse.json({ key, keyId: id, tier: 'free' }, { headers: noStore })
  } catch (e) {
    console.error('falcon-cloud free key failed:', (e as Error).message)
    return NextResponse.json({ error: 'Could not create a key. Please try again.' }, { status: 500, headers: noStore })
  }
}
