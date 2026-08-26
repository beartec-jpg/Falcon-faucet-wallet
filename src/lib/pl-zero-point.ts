/**
 * Falcon PL 2300 public zero-point. Subtract baseline rail/account
 * credits so explorers and the wallet read 0 until new peg-ins.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'

export type ZeroRail = { minted: number; burned: number }
export type ZeroPoint = {
  rails: Record<string, ZeroRail>
  accounts: Record<string, Record<string, number>>
}

const EMPTY: ZeroPoint = { rails: {}, accounts: {} }

let cached: ZeroPoint | null = null

export async function loadZeroPoint(): Promise<ZeroPoint> {
  if (cached) return cached
  try {
    const raw = await readFile(
      path.join(process.cwd(), 'public', 'config', 'pl-2300-zero-point.json'),
      'utf8',
    )
    const j = JSON.parse(raw) as Partial<ZeroPoint>
    cached = {
      rails: j.rails ?? {},
      accounts: Object.fromEntries(
        Object.entries(j.accounts ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
      ),
    }
  } catch {
    cached = EMPTY
  }
  return cached
}

export function offsetAsset(zp: ZeroPoint, account: string, asset: string, raw: number): number {
  const off = zp.accounts[account.trim().toLowerCase()]?.[asset] ?? 0
  const n = Number(raw)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, n - off)
}

export function offsetRail(
  zp: ZeroPoint,
  asset: string,
  minted: number,
  burned: number,
): { minted: number; burned: number } {
  const r = zp.rails[asset] ?? { minted: 0, burned: 0 }
  return {
    minted: Math.max(0, Number(minted) - r.minted),
    burned: Math.max(0, Number(burned) - r.burned),
  }
}
