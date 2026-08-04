/**
 * Ops helper: inspect SPV FBTC MPT + print AMMCreate seed plan.
 * Full create is easiest from portal /pool → FBTC after MPTokensV2 is on.
 *
 *   FALCON_RPC_URL=http://… pnpm exec tsx scripts/seed-fbtc-mpt-amm.mts
 *   FALCON_AMT=1000 FBTC_AMT=0.01 pnpm exec tsx scripts/seed-fbtc-mpt-amm.mts
 */

const RPC =
  process.env.FALCON_RPC_URL ||
  process.env.NEXT_PUBLIC_TESTNET_RPC_URL ||
  'http://46.224.0.140:6005'
const FALCON_AMT = parseFloat(process.env.FALCON_AMT || '1000')
const FBTC_AMT = parseFloat(process.env.FBTC_AMT || '0.01')
const TRADING_FEE = parseInt(process.env.TRADING_FEE || '500', 10)

async function rpc(method: string, params: Record<string, unknown> = {}) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params: [params] }),
  })
  const j = (await r.json()) as {
    result?: Record<string, unknown> & { error?: string; error_message?: string }
  }
  return j.result ?? {}
}

function btcToSats(btc: number): string {
  return String(Math.round(btc * 1e8))
}

async function main() {
  console.log('RPC', RPC)

  const bridge = await rpc('ledger_entry', {
    btc_bridge_state: true,
    ledger_index: 'validated',
  })
  if (bridge.error) {
    throw new Error(`btc_bridge_state: ${bridge.error_message || bridge.error}`)
  }
  const node = bridge.node as { MPTokenIssuanceID?: string; Account?: string } | undefined
  const mptId = node?.MPTokenIssuanceID
  if (!mptId) throw new Error('No MPTokenIssuanceID on BtcBridgeState')

  console.log('SPV FBTC MPT issuance:', mptId)
  console.log('Bridge account:', node?.Account || '(none)')

  const features = await rpc('feature', {})
  const feats = (features.features || {}) as Record<
    string,
    { name?: string; enabled?: boolean; supported?: boolean }
  >
  let mptV1 = false
  let mptV2 = false
  for (const v of Object.values(feats)) {
    if (v.name === 'MPTokensV1') mptV1 = !!v.enabled
    if (v.name === 'MPTokensV2') mptV2 = !!v.enabled || !!v.supported
  }
  // Some builds omit unsupported amendments from the map entirely
  const names = Object.values(feats).map((v) => v.name)
  const v2Listed = names.includes('MPTokensV2')
  console.log('MPTokensV1 enabled:', mptV1)
  console.log('MPTokensV2 listed:', v2Listed, 'enabled/supported:', mptV2)
  if (!v2Listed) {
    console.log(
      '→ MPTokensV2 not on this image. Rebuild Falcon with Supported::Yes before AMMCreate(MPT).',
    )
  }

  const amm = await rpc('amm_info', {
    asset: { currency: 'XRP' },
    asset2: { mpt_issuance_id: mptId },
    ledger_index: 'validated',
  })
  if (amm.amm) {
    console.log('AMM already live:')
    console.log(JSON.stringify(amm.amm, null, 2))
    return
  }
  console.log('AMM status:', amm.error_message || amm.error || 'not found')

  const drops = String(Math.round(FALCON_AMT * 1_000_000))
  const sats = btcToSats(FBTC_AMT)
  console.log(`
Seed plan (portal /pool → FBTC → Create AMM Pool):
  Amount (FALCON drops):  ${drops}   (${FALCON_AMT} FALCON)
  Amount2 (MPT sats):     { mpt_issuance_id: "${mptId}", value: "${sats}" }  (${FBTC_AMT} BTC)
  TradingFee:             ${TRADING_FEE}
  Initial price:          ${(FALCON_AMT / FBTC_AMT).toFixed(2)} FALCON per FBTC

Checklist:
  1. Enable MPTokensV2 on Falcon
  2. Fund seeder with FALCON + SPV FBTC (bridge peg-in)
  3. Create pool from portal or AMMCreate with fields above
`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
