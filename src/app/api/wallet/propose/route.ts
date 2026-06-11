import { NextResponse } from 'next/server'
import { proxyWalletPropose } from '@/lib/signer-proxy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const wallet = await proxyWalletPropose('falcon512')
    return NextResponse.json({
      address:       wallet.account_id,
      publicKey:     wallet.public_key,
      keyType:       wallet.key_type,
      falcon_secret: wallet.falcon_secret,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Wallet creation failed'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}