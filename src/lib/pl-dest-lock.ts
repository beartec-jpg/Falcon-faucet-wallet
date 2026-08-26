/**
 * Falcon PL 2300 dest-lock (FalconBridge). Not Falcon Ledger 1001 collateral lock.
 * dest20 = sha256(lowercase PL account)[:20]
 */

import { Contract, Wallet, sha256, toUtf8Bytes, parseUnits, parseEther } from 'ethers'
import { signRailWithdraw } from '@/lib/pl-wallet-sign'
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
  'function submitHeaderWithProof(uint64 height, bytes32 hash, bytes32 parent, bytes32 claimRoot, uint256[2] a, uint256[2][2] b, uint256[2] c)',
  'function fplTip() view returns (uint64)',
  'function headers(uint64) view returns (bytes32 hash, bytes32 parent, bytes32 claimRoot, bool finalized)',
  'function claims(bytes32) view returns (address dest, uint256 amount, bool usdc, uint64 readyBlock, uint64 fplHeight, bytes32 leaf, bool open, bool challenged, bool taken)',
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

export function destLockContractReady(cfg: Pl2300BridgeConfig | null): boolean {
  return !!(
    cfg &&
    cfg.status === 'live' &&
    cfg.sepolia?.bridge?.match(/^0x[a-fA-F0-9]{40}$/)
  )
}

/** Peg-out needs Groth16 Falcon-512 headers on the live FalconQc contract. Peg-in does not. */
export function destLockHeadersReady(cfg: Pl2300BridgeConfig | null, fplTip: number | null): boolean {
  if (!destLockContractReady(cfg)) return false
  if (fplTip == null) return false
  const start = cfg!.sepolia.start_height || 0
  return fplTip > start && fplTip > 0
}

export type DestLockMintJob = {
  ok?: boolean
  status?: string
  account?: string
  asset?: string
  amount?: number
  credited?: number
  dest20?: string
  txid?: string
  error?: string
}

export async function mintAfterDestLockDeposit(opts: {
  account: string
  txHash: string
  asset: 'ETH' | 'USDC'
  onStep?: (s: string) => void
}): Promise<DestLockMintJob> {
  const account = opts.account.trim()
  const txHash = opts.txHash.trim()
  if (!account) throw new Error('PL account required to mint dest-lock deposit')
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash) && !/^[a-fA-F0-9]{64}$/.test(txHash)) {
    throw new Error('Deposit tx hash required to mint')
  }
  opts.onStep?.('Queuing Falcon PL mint…')
  const queued = await postMint('mint-eth-deposit', account, txHash, opts.asset)
  if (queued.status === 'done') return queued
  opts.onStep?.(
    queued.asset
      ? `Minting ${queued.asset} on Falcon PL (headers + RailDeposit)…`
      : 'Minting on Falcon PL…',
  )
  const t0 = Date.now()
  while (Date.now() - t0 < 180_000) {
    await new Promise((r) => setTimeout(r, 2000))
    const st = await postMint('mint-status', account, txHash, opts.asset)
    if (st.status === 'done') {
      opts.onStep?.(`${st.asset ?? opts.asset} minted on Falcon PL`)
      return st
    }
    if (st.status === 'error') {
      throw new Error(st.error || 'Dest-lock mint failed')
    }
    const elapsed = Math.round((Date.now() - t0) / 1000)
    opts.onStep?.(`Minting on Falcon PL… ${st.status ?? 'queued'} (${elapsed}s)`)
  }
  throw new Error(
    `Mint still running after 3 minutes. Keep this txid: ${txHash}. Do not deposit again.`,
  )
}

async function postMint(
  action: 'mint-eth-deposit' | 'mint-status',
  account: string,
  txHash: string,
  asset: 'ETH' | 'USDC',
): Promise<DestLockMintJob> {
  const res = await fetch('/api/wallet/pl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, account, txHash, asset }),
  })
  const d = (await res.json()) as DestLockMintJob & { error?: string }
  if (!res.ok) throw new Error(d.error || `mint api ${res.status}`)
  return d
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

export type DestLockClaimProof = {
  ok?: boolean
  noteId: string
  asset: string
  dest: string
  amount: number | string
  isUsdc: boolean
  leaf: string
  index: number
  proof: string[]
  claimRoot: string
  lcClaimRoot: string
  fplTip: number
  ready?: boolean
  error?: string
}

async function postClaimProof(body: Record<string, unknown>): Promise<DestLockClaimProof> {
  const res = await fetch('/api/wallet/pl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'claim-proof', ...body }),
  })
  const d = (await res.json()) as DestLockClaimProof
  if (!res.ok) throw new Error(d.error || `claim-proof ${res.status}`)
  return d
}

async function submitExact(txJson: string, network: string): Promise<string> {
  const res = await fetch('/api/wallet/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx_json: txJson, network }),
  })
  const out = (await res.json()) as { success?: boolean; hash?: string; error?: string; message?: string }
  if (!res.ok || out.success === false) {
    throw new Error(out.error || out.message || 'RailWithdraw submit failed')
  }
  return out.hash || ''
}

async function accountSeq(account: string, network: string): Promise<{ sequence: number; balance: number }> {
  const res = await fetch(
    `/api/wallet/account?address=${encodeURIComponent(account)}&network=${encodeURIComponent(network)}`,
  )
  const j = (await res.json()) as { sequence?: number; balance?: number; error?: string }
  if (!res.ok) throw new Error(j.error || 'account lookup failed')
  return { sequence: Number(j.sequence ?? 0), balance: Number(j.balance ?? 0) }
}

export async function pegOutDestLock(opts: {
  cfg: Pl2300BridgeConfig
  account: string
  falconSecret: string
  evmPrivateKey: string
  asset: 'ETH' | 'USDC'
  amountExact: bigint
  dest: string
  network: string
  onStep?: (s: string) => void
}): Promise<{ burnTxId: string; openHash: string; takeHash: string; noteId: string }> {
  const dest = opts.dest.trim()
  if (!/^0x[a-fA-F0-9]{40}$/.test(dest)) throw new Error('Need your Sepolia 0x address for dest-lock take')
  if (opts.amountExact <= 0n) throw new Error('Amount must be greater than zero')
  const snap = await accountSeq(opts.account, opts.network)
  if (snap.balance < 2) throw new Error('Need 2 FPL on this account for the burn fee')
  opts.onStep?.(`Burning ${opts.asset} on Falcon PL…`)
  const burn = await signRailWithdraw({
    account: opts.account,
    sequence: snap.sequence,
    asset: opts.asset,
    amount: opts.amountExact.toString(),
    externalTo: dest,
    falconSecret: opts.falconSecret,
  })
  if (!burn.rawJson) throw new Error('withdraw sign missing exact JSON')
  const burnTxId = await submitExact(burn.rawJson, opts.network)
  opts.onStep?.('Waiting for the burn note to pack…')
  let proof: DestLockClaimProof | null = null
  const tPack = Date.now()
  while (Date.now() - tPack < 90_000) {
    try {
      proof = await postClaimProof({
        account: opts.account,
        asset: opts.asset,
        dest,
        amount: opts.amountExact.toString(),
      })
      if (proof.noteId && proof.claimRoot) break
    } catch {
      /* not packed yet */
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  if (!proof?.noteId) {
    throw new Error('Burn submitted but the withdraw note did not pack. Keep this panel open and retry Bridge out.')
  }
  const proveHeight = Number(proof.fplTip || 0)
  if (!proveHeight) {
    throw new Error('Burn packed but no FPL height yet. Retry Bridge out in a moment.')
  }
  opts.onStep?.(`Proving Falcon-512 header ${proveHeight} (you pay Sepolia gas)…`)
  let headerProof: {
    height: number
    header: string
    parent: string
    claimRoot: string
    a: [string, string]
    b: [[string, string], [string, string]]
    c: [string, string]
    error?: string
  } | null = null
  const tPr = Date.now()
  while (Date.now() - tPr < 3 * 60_000) {
    const res = await fetch('/api/wallet/pl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'header-proof', height: proveHeight }),
    })
    const d = (await res.json()) as typeof headerProof & { error?: string }
    if (res.ok && d && d.a && d.header) {
      headerProof = d
      break
    }
    opts.onStep?.(d?.error || 'Waiting for 4 Falcon-512 attestations + Groth16…')
    await new Promise((r) => setTimeout(r, 4000))
  }
  if (!headerProof) {
    throw new Error('Header proof did not land. Do not burn again — retry Bridge out.')
  }
  const fplHeight = Number(headerProof.height)
  opts.onStep?.(`submitHeaderWithProof h=${fplHeight} from your Sepolia key…`)
  await withSepolia(opts.cfg.sepolia.rpc_url, async (p) => {
    const signer = new Wallet(opts.evmPrivateKey, p)
    const c = new Contract(opts.cfg.sepolia.bridge, DEST_LOCK_ABI, signer)
    const tx = await c.submitHeaderWithProof(
      fplHeight,
      headerProof!.header,
      headerProof!.parent,
      headerProof!.claimRoot,
      headerProof!.a,
      headerProof!.b,
      headerProof!.c,
    )
    const rc = await tx.wait(1)
    if (!rc || rc.status !== 1) throw new Error(`submitHeaderWithProof failed (${tx.hash})`)
    return tx.hash as string
  })
  opts.onStep?.(`openClaim at FPL height ${fplHeight}…`)
  const openHash = await withSepolia(opts.cfg.sepolia.rpc_url, async (p) => {
    const signer = new Wallet(opts.evmPrivateKey, p)
    const c = new Contract(opts.cfg.sepolia.bridge, DEST_LOCK_ABI, signer)
    const tx = await c.openClaim(
      proof!.noteId,
      dest,
      opts.amountExact,
      opts.asset === 'USDC',
      proof!.proof,
      proof!.index,
      fplHeight,
    )
    const rc = await tx.wait(1)
    if (!rc || rc.status !== 1) throw new Error(`openClaim failed (${tx.hash})`)
    return tx.hash as string
  })
  opts.onStep?.('take() dest-locked funds…')
  const takeHash = await takeDestLockClaim({
    cfg: opts.cfg,
    evmPrivateKey: opts.evmPrivateKey,
    noteId: proof.noteId,
    onStep: opts.onStep,
  })
  return { burnTxId, openHash, takeHash, noteId: proof.noteId }
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

