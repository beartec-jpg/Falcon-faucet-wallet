/**
 * Falcon PL 2300 FalconQcBridge (STATUS SoT). Not Falcon Ledger 1001 collateral lock.
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
    claimer?: string
    claim_delay?: number
    verifier?: string
    qc_version?: number
    legacy_destlock?: string
    legacy_qc_v2?: string
    legacy_verifier_v2?: string
    falcon_key_root?: string
    start_height: number
    eth_lock?: string
    usdc_lock?: string
  }
}

export const DEST_LOCK_ABI = [
  'function depositEth(bytes20 dest20) payable',
  'function depositUsdc(bytes20 dest20, uint256 amount)',
  'function kickoff(bytes32 noteId, address dest, uint256 amount, bool isUsdc)',
  'function take(bytes32 noteId)',
  'function fplTip() view returns (uint64)',
  'function headers(uint64) view returns (bytes32 hash, bytes32 parent, bytes32 innerHash, bytes32 claimRoot, bytes32 nextCommitteeRoot, bool finalized)',
  'function claimDelay() view returns (uint64)',
  'function claimer() view returns (address)',
  'function claims(bytes32) view returns (address dest, uint256 amount, bool usdc, uint64 readyBlock, bool open, bool taken)',
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

/** Live FalconQcBridge (STATUS SoT) — Bridge tab ready before /config fetch. */
export const PL2300_BRIDGE_FALLBACK: Pl2300BridgeConfig = {
  version: 1,
  status: 'live',
  network_id: 2300,
  sepolia: {
    chain_id: 11155111,
    chain_name: 'Sepolia',
    rpc_url: 'https://ethereum-sepolia-rpc.publicnode.com',
    explorer_url: 'https://sepolia.etherscan.io',
    usdc_token: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    usdc_decimals: 6,
    bridge: '0xf8F1471643792eb1cD5d0C31061629777E55bc48',
    qc_version: 2,
    verifier: '0x9992cD8e45A2b7983E2b7f8fC725308a0E4845EC',
    claimer: '0xDb52847EE70cEd3128f49309c3DC65b69d7466f4',
    claim_delay: 6,
    legacy_destlock: '0xdBF6855b00B78c047A729A21E13bfE5f4C991C05',
    legacy_qc_v2: '0x811854827627024B38926Ea9DCc0f88ACd5fB23e',
    legacy_verifier_v2: '0x2Cb70e9f082F2DF91E9A5e6E7C9DF6b8b11B4F80',
    falcon_key_root: '0x04a9ad1908569884ff307f63291c592af16fe345fb471c22104d0c0717bcfd8a',
    start_height: 353110,
  },
}

export async function fetchPl2300BridgeConfig(): Promise<Pl2300BridgeConfig | null> {
  if (cached) return cached
  try {
    const res = await fetch('/config/pl-2300-bridge.json', { cache: 'no-store' })
    if (!res.ok) return cached ?? PL2300_BRIDGE_FALLBACK
    cached = (await res.json()) as Pl2300BridgeConfig
    return cached
  } catch {
    return cached ?? PL2300_BRIDGE_FALLBACK
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

/** Peg-in/out: FalconQcBridge (STATUS SoT). legacy_destlock = Kickoff leftover only. */
export function pegInBridge(cfg: Pl2300BridgeConfig): string {
  return cfg.sepolia.bridge
}

export function pegOutBridge(cfg: Pl2300BridgeConfig): string {
  return cfg.sepolia.bridge
}

export function leftoverDestLock(cfg: Pl2300BridgeConfig): string {
  const legacy = cfg.sepolia.legacy_destlock?.trim()
  if (legacy && /^0x[a-fA-F0-9]{40}$/.test(legacy)) return legacy
  return cfg.sepolia.bridge
}

export async function fetchFplTip(cfg: Pl2300BridgeConfig): Promise<number> {
  return withSepolia(cfg.sepolia.rpc_url, async (p) => {
    if (Number(cfg.sepolia.qc_version ?? 0) >= 2) {
      const c = new Contract(pegOutBridge(cfg), DEST_LOCK_ABI, p)
      return Number(await c.fplTip())
    }
    const c = new Contract(pegInBridge(cfg), DEST_LOCK_ABI, p)
    const delay = await c.claimDelay()
    return Number(delay) > 0 ? 1 : 0
  })
}

export function destLockContractReady(cfg: Pl2300BridgeConfig | null): boolean {
  return !!(
    cfg &&
    cfg.status === 'live' &&
    cfg.sepolia?.bridge?.match(/^0x[a-fA-F0-9]{40}$/)
  )
}

/** V2 unwrap needs sequential headers on Sepolia (fplTip > start_height). */
export function destLockHeadersReady(cfg: Pl2300BridgeConfig | null, fplTip?: number | null): boolean {
  if (!destLockContractReady(cfg) || !cfg) return false
  if (Number(cfg.sepolia.qc_version ?? 0) < 2) return true
  const start = Number(cfg.sepolia.start_height ?? 0)
  if (fplTip == null) return true
  return Number(fplTip) > start
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
  deposit_block?: number
  lc_execution?: number
  lc_finalized_slot?: number
}

export async function queueDestLockMint(opts: {
  account: string
  txHash: string
  asset: 'ETH' | 'USDC'
}): Promise<DestLockMintJob> {
  const account = opts.account.trim()
  const txHash = opts.txHash.trim()
  if (!account) throw new Error('PL account required to mint dest-lock deposit')
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash) && !/^[a-fA-F0-9]{64}$/.test(txHash)) {
    throw new Error('Deposit tx hash required to mint')
  }
  return postMint('mint-eth-deposit', account, txHash, opts.asset)
}

export async function mintAfterDestLockDeposit(opts: {
  account: string
  txHash: string
  asset: 'ETH' | 'USDC'
  onStep?: (s: string) => void
}): Promise<DestLockMintJob> {
  const account = opts.account.trim()
  const txHash = opts.txHash.trim()
  opts.onStep?.('Queuing Falcon PL mint…')
  const queued = await queueDestLockMint({ account, txHash, asset: opts.asset })
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
    if (
      st.deposit_block &&
      st.lc_execution != null &&
      st.lc_execution < st.deposit_block
    ) {
      opts.onStep?.(
        `Waiting for Ethereum finality (light client ${st.lc_execution} / deposit ${st.deposit_block})… ${elapsed}s. Do not send again.`,
      )
    } else {
      opts.onStep?.(`Minting on Falcon PL… ${st.status ?? 'queued'} (${elapsed}s)`)
    }
  }
  // Keep the job; UI restores from localStorage + mint-status after refresh.
  opts.onStep?.(`Mint still running. Tx ${txHash.slice(0, 10)}… — keep this tab or refresh; do not deposit again.`)
  return { ...queued, status: 'running', txid: txHash, account, asset: opts.asset }
}

export async function fetchDestLockMintStatus(opts: {
  account: string
  txHash: string
  asset: 'ETH' | 'USDC'
}): Promise<DestLockMintJob> {
  return postMint('mint-status', opts.account.trim(), opts.txHash.trim(), opts.asset)
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
    const c = new Contract(pegInBridge(opts.cfg), DEST_LOCK_ABI, signer)
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
    const lock = pegInBridge(opts.cfg)
    const bridge = new Contract(lock, DEST_LOCK_ABI, signer)
    const amount = parseUnits(opts.amountUsdc, opts.cfg.sepolia.usdc_decimals ?? 6)
    if (amount <= 0n) throw new Error('Amount must be greater than zero')
    const allowance: bigint = await usdc.allowance(signer.address, lock)
    let approveHash: string | undefined
    if (allowance < amount) {
      opts.onStep?.('Approving USDC…')
      const atx = await usdc.approve(lock, amount)
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
  const v2 =
    Number(opts.cfg.sepolia.qc_version ?? 0) >= 2 ||
    (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_QC_V2 === '1')
  if (v2) {
    opts.onStep?.('Waiting FalconQcBridgeV2 headers, then openClaim + dest take (no claimer)…')
    let openJ: { error?: string; tx?: string; waiting?: boolean; message?: string; ethTip?: number } = {}
    const tHdr = Date.now()
    while (Date.now() - tHdr < 15 * 60_000) {
      const open = await fetch('/api/wallet/pl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'eth-open-claim',
          noteId: proof.noteId,
          dest,
          amount: opts.amountExact.toString(),
          asset: opts.asset,
          account: opts.account,
        }),
      })
      openJ = (await open.json()) as typeof openJ
      if (open.ok && openJ.tx) break
      if (open.status === 409 || openJ.waiting) {
        opts.onStep?.(openJ.message || `Waiting V2 header (eth tip ${openJ.ethTip ?? '…'}). Do not burn again.`)
        await new Promise((r) => setTimeout(r, 8000))
        continue
      }
      throw new Error(openJ.error || 'V2 openClaim failed')
    }
    if (!openJ.tx) {
      throw new Error(
        'Burn is packed. V2 headers have not caught this claimRoot yet (one-host lagged unwrap). Keep this panel and retry Bridge out — do not burn again.',
      )
    }
    opts.onStep?.('take() dest-only (no claimer)…')
    const takeHash = await takeDestLockClaim({
      cfg: opts.cfg,
      evmPrivateKey: opts.evmPrivateKey,
      noteId: proof.noteId,
      onStep: opts.onStep,
    })
    return {
      burnTxId,
      openHash: openJ.tx || '',
      takeHash,
      noteId: proof.noteId,
    }
  }
  opts.onStep?.('Dest-lock Kickoff (dest = burn external_to; leftover-only after V2)…')
  const kick = await fetch('/api/wallet/pl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'eth-kickoff',
      noteId: proof.noteId,
      dest,
      amount: opts.amountExact.toString(),
      asset: opts.asset,
    }),
  })
  const kickJ = (await kick.json()) as { error?: string; tx?: string }
  if (!kick.ok) throw new Error(kickJ.error || 'Dest-lock Kickoff failed')
  const openHash = kickJ.tx || ''

  const delay = Number(opts.cfg.sepolia.claim_delay ?? 6) || 6
  opts.onStep?.(`Waiting CSV=${delay} Sepolia blocks, then dest take…`)
  const tCsv = Date.now()
  while (Date.now() - tCsv < 15 * 60_000) {
    const ready = await withSepolia(opts.cfg.sepolia.rpc_url, async (p) => {
      const c = new Contract(leftoverDestLock(opts.cfg), DEST_LOCK_ABI, p)
      const row = await c.claims(proof!.noteId)
      const readyBlock = Number(row?.readyBlock ?? row?.[3] ?? 0)
      const open = Boolean(row?.open ?? row?.[4])
      const taken = Boolean(row?.taken ?? row?.[5])
      const bn = await p.getBlockNumber()
      return { readyBlock, open, taken, bn }
    })
    if (ready.taken) break
    if (ready.open && ready.bn >= ready.readyBlock) break
    opts.onStep?.(
      `Kickoff CSV ${ready.bn} / ${ready.readyBlock || '…'} (need ${delay} blocks)…`,
    )
    await new Promise((r) => setTimeout(r, 8000))
  }
  opts.onStep?.('take() dest-locked funds…')
  const takeHash = await takeDestLockClaim({
    cfg: opts.cfg,
    evmPrivateKey: opts.evmPrivateKey,
    noteId: proof.noteId,
    onStep: opts.onStep,
    lock: leftoverDestLock(opts.cfg),
  })
  return { burnTxId, openHash, takeHash, noteId: proof.noteId }
}

export async function takeDestLockClaim(opts: {
  cfg: Pl2300BridgeConfig
  evmPrivateKey: string
  noteId: string
  onStep?: (s: string) => void
  /** Dest-lock leftover Kickoff take; default is V2 peg-out. */
  lock?: string
}): Promise<string> {
  return withSepolia(opts.cfg.sepolia.rpc_url, async (p) => {
    const signer = new Wallet(opts.evmPrivateKey, p)
    const c = new Contract(opts.lock || pegOutBridge(opts.cfg), DEST_LOCK_ABI, signer)
    opts.onStep?.('take() dest-only…')
    const tx = await c.take(opts.noteId)
    const rc = await tx.wait(1)
    if (!rc || rc.status !== 1) throw new Error(`take failed (${tx.hash})`)
    return tx.hash
  })
}

