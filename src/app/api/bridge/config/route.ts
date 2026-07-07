import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const configPath = path.join(process.cwd(), 'public', 'config', 'usdc-bridge.json')
    const raw = await readFile(configPath, 'utf8')
    const config = JSON.parse(raw)

    const lockContract =
      process.env.SEPOLIA_LOCK_CONTRACT?.trim() ||
      process.env.NEXT_PUBLIC_SEPOLIA_LOCK_CONTRACT?.trim() ||
      config.sepolia?.lock_contract ||
      ''

    const usdcToken =
      process.env.SEPOLIA_USDC_TOKEN?.trim() ||
      process.env.NEXT_PUBLIC_SEPOLIA_USDC_TOKEN?.trim() ||
      config.sepolia?.usdc_token ||
      ''

    // The Falcon node RPC is server/relay infrastructure and must not leak an
    // internal plaintext (http://<ip>) endpoint to the browser. Only expose a
    // Falcon RPC URL if one is explicitly published via env; otherwise omit it.
    const falconRpc =
      process.env.NEXT_PUBLIC_FALCON_BRIDGE_RPC_URL?.trim() ||
      process.env.FALCON_BRIDGE_RPC_URL?.trim() ||
      ''
    const falcon = { ...(config.falcon ?? {}) }
    if (falconRpc) {
      falcon.rpc_url = falconRpc
    } else {
      delete falcon.rpc_url
    }

    return NextResponse.json({
      ...config,
      falcon,
      sepolia: {
        ...config.sepolia,
        lock_contract: lockContract,
        usdc_token: usdcToken,
      },
      lock_contract_ready: /^0x[a-fA-F0-9]{40}$/.test(lockContract),
    })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Bridge config unavailable' },
      { status: 500 },
    )
  }
}