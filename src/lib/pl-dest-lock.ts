/**
 * Falcon PL 2300 dest-lock (FalconBridge). Not Falcon Ledger 1001 collateral lock.
 * dest20 = sha256(lowercase PL account)[:20]
 */

import { Contract, Wallet, sha256, toUtf8Bytes, parseUnits, parseEther } from 'ethers'
import { SEPOLIA_RPC_FALLBACKS } from '@/lib/evm-bridge-client'
import { JsonRpcProvider } from 'ethers'

export interface Pl2300BridgeConfig {
  version: number
  status: string
  network_id: number
  sepolia: {
    chain_id: number
    chain_name: string
    rpc_url: string
    explorer_url: string
    usdc_token: string
    usdc_decimals: number
    bridge: string
    verifier: string
    start_height: number
  }
}

export const DEST_LOCK_ABI = [
  'function depositEth(bytes20 dest20) payable',
  'function depositUsdc(bytes20 dest20, uint256 amount)',
  'function openClaim(bytes32 noteId, address dest, uint256 amount, bool isUsdc, bytes32[] proof, uint32 index, uint64 fplHeight)',
  'function take(bytes32 noteId)',
  'function fplTip() view returns (uint64)',
  'function ethPool() view returns (uint256)',
  'function usdcPool() view returns (uint256)',
  'event Deposit(bytes32 indexed dest20, address indexed token, uint256 amount, bytes32 lockId)',
  'event ClaimOpened(bytes32 indexed noteId, address dest, uint256 amount, bool usdc, uint64 readyBlock)',
  'event ClaimTaken(bytes32 indexed noteId, address dest, uint256 amount)',
] as const

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
] as const

export function dest20FromAccount(account: string): string {
  const digest = sha256(toUtf8Bytes(account.trim().toLowerCase()))
  return '0x' + digest.slice(2, 42)
}

let cached: Pl2300BridgeConfig | null = null

export async function fetchPl2300BridgeConfig(): Promise<Pl2300BridgeConfig | null> {
  if (cached) return cached
  try {
    const res = await fetch('/config/pl-2300-bridge.json', { cache: 'no-store' })
    if (!res.ok) return null
    cached = (await res.json()) as Pl2300BridgeConfig
    return cached
  } catch {
    return null
  }
}

function provider(rpcUrl: string, chainId = 11155111): JsonRpcProvider {
  return new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true })
}

async function withSepolia<T>(rpcUrl: string, fn: (p: JsonRpcProvider) => Promise<T>): Promise<T> {
  const urls = [rpcUrl, ...SEPOLIA_RPC_FALLBACKS.filter((u) => u !== rpcUrl)]
  let last: unknown
  for (const url of urls) {
    try {
      return await fn(provider(url))
    } catch (e) {
      last = e
    }
  }
  throw last instanceof Error ? last : new Error('Sepolia RPC unavailable')
}

export async function fetchFplTip(cfg: Pl2300BridgeConfig): Promise<number> {
  return withSepolia(cfg.sepolia.rpc_url, async (p) => {
    const c = new Contract(cfg.sepolia.bridge, DEST_LOCK_ABI, p)
    const tip = await c.fplTip()
    return Number(tip)
  })
}

export function destLockHeadersReady(cfg: Pl2300BridgeConfig | null, fplTip: number | null): boolean {
  if (!cfg?.sepolia?.bridge?.match(/^0x[a-fA-F0-9]{40}$/)) return false
  if (cfg.status !== 'live') return false
  if (fplTip == null) return false
  return fplTip > (cfg.sepolia.start_height || 0)
}

export async function depositEthDestLock(opts: {
  cfg: Pl2300BridgeConfig
  evmPrivateKey: string
  amountEth: string
  plAccount: string
  onStep?: (s: string) => void
}): Promise<{ depositHash: string; dest20: string }> {
  const dest20 = dest20FromAccount(opts.plAccount)
  if (!opts.plAccount.trim()) throw new Error('PL account required for dest-lock')
  opts.onStep?.('Connecting to Sepolia…')
  return withSepolia(opts.cfg.sepolia.rpc_url, async (p) => {
    const signer = new Wallet(opts.evmPrivateKey, p)
    const c = new Contract(opts.cfg.sepolia.bridge, DEST_LOCK_ABI, signer)
    const value = parseEther(opts.amountEth)
    if (value <= 0n) throw new Error('Amount must be greater than zero')
    opts.onStep?.(`depositEth dest20=${dest20.slice(0, 10)}…`)
    const tx = await c.depositEth(dest20, { value })
    opts.onStep?.(`Tx ${tx.hash.slice(0, 10)}… waiting for confirmation`)
    const rc = await tx.wait(1)
    if (!rc || rc.status !== 1) throw new Error(`depositEth failed (${tx.hash})`)
    return { depositHash: tx.hash, dest20 }
  })
}

export async function depositUsdcDestLock(opts: {
  cfg: Pl2300BridgeConfig
  evmPrivateKey: string
  amountUsdc: string
  plAccount: string
  onStep?: (s: string) => void
}): Promise<{ depositHash: string; approveHash?: string; dest20: string }> {
  const dest20 = dest20FromAccount(opts.plAccount)
  if (!opts.plAccount.trim()) throw new Error('PL account required for dest-lock')
  opts.onStep?.('Connecting to Sepolia…')
  return withSepolia(opts.cfg.sepolia.rpc_url, async (p) => {
    const signer = new Wallet(opts.evmPrivateKey, p)
    const usdc = new Contract(opts.cfg.sepolia.usdc_token, ERC20_ABI, signer)
    const bridge = new Contract(opts.cfg.sepolia.bridge, DEST_LOCK_ABI, signer)
    const amount = parseUnits(opts.amountUsdc, opts.cfg.sepolia.usdc_decimals ?? 6)
    if (amount <= 0n) throw new Error('Amount must be greater than zero')
    const allowance: bigint = await usdc.allowance(signer.address, opts.cfg.sepolia.bridge)
    let approveHash: string | undefined
    if (allowance < amount) {
      opts.onStep?.('Approving USDC…')
      const atx = await usdc.approve(opts.cfg.sepolia.bridge, amount)
      const arc = await atx.wait(1)
      if (!arc || arc.status !== 1) throw new Error(`USDC approve failed (${atx.hash})`)
      approveHash = atx.hash
    }
    opts.onStep?.(`depositUsdc dest20=${dest20.slice(0, 10)}…`)
    const tx = await bridge.depositUsdc(dest20, amount)
    const rc = await tx.wait(1)
    if (!rc || rc.status !== 1) throw new Error(`depositUsdc failed (${tx.hash})`)
    return { depositHash: tx.hash, approveHash, dest20 }
  })
}

export async function takeDestLockClaim(opts: {
  cfg: Pl2300BridgeConfig
  evmPrivateKey: string
  noteId: string
  onStep?: (s: string) => void
}): Promise<string> {
  return withSepolia(opts.cfg.sepolia.rpc_url, async (p) => {
    const signer = new Wallet(opts.evmPrivateKey, p)
    const c = new Contract(opts.cfg.sepolia.bridge, DEST_LOCK_ABI, signer)
    opts.onStep?.('take() dest-locked claim…')
    const tx = await c.take(opts.noteId)
    const rc = await tx.wait(1)
    if (!rc || rc.status !== 1) throw new Error(`take failed (${tx.hash})`)
    return tx.hash
  })
}

