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

    return NextResponse.json({
      ...config,
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