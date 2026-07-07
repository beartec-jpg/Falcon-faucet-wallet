/**
 * Browser-side Sepolia USDC → Falcon bridge (approve + lock deposit).
 */

import { Contract, JsonRpcProvider, Wallet, formatUnits, parseUnits } from 'ethers'
import type { SepoliaBridgeConfig } from '@/lib/bridge-config'

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
] as const

const LOCK_ABI = [
  'function deposit(uint256 amount, string falconAccount) returns (bytes32 depositId)',
  'function withdraw(uint256 amount, address recipient, bytes32 withdrawalId, string falconAccount, string falconTxHash) external',
  'event DepositCreated(bytes32 indexed depositId, address indexed sender, uint256 amount, string falconAccount)',
  'event WithdrawalReleased(bytes32 indexed withdrawalId, address indexed recipient, uint256 amount, string falconAccount, string falconTxHash)',
] as const

export interface SepoliaBalances {
  eth: string
  usdc: string
}

export interface BridgeDepositResult {
  approveHash?: string
  depositHash: string
  depositId?: string
}

/** Classic XRPL/Falcon address (r...) — deposits mint F-USDC to this account. */
const FALCON_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/

const TX_CONFIRM_TIMEOUT_MS = 180_000
/**
 * Default number of blocks to scan back from the chain tip for a WithdrawalReleased
 * event, by EVM chain id. Mainnet uses a deeper window for reorg safety; testnets
 * are shallower. Overridable per-call or via bridge config (release_lookback_blocks).
 */
function defaultReleaseLookbackBlocks(chainId: number): number {
  return chainId === 1 ? 200 : 50
}

async function waitForTx(
  tx: { hash: string; wait: (conf?: number, timeout?: number) => Promise<{ status?: number | null; hash: string; logs?: unknown[] } | null> },
  label: string,
  onStep?: (step: string) => void,
): Promise<{ status?: number | null; hash: string; logs?: unknown[] }> {
  onStep?.(`${label} submitted — waiting for Sepolia confirmation…`)
  onStep?.(`Tx ${tx.hash.slice(0, 10)}… (track on Etherscan if slow)`)
  const rc = await tx.wait(1, TX_CONFIRM_TIMEOUT_MS)
  if (!rc) {
    throw new Error(`${label} timed out after 3 minutes. Check Etherscan for ${tx.hash}`)
  }
  if (rc.status !== 1) throw new Error(`${label} failed on-chain (${tx.hash})`)
  return rc
}

/** Public Sepolia RPC fallbacks — rpc.sepolia.org often returns 404 from browsers/serverless. */
export const SEPOLIA_RPC_FALLBACKS = [
  'https://ethereum-sepolia-rpc.publicnode.com',
  'https://1rpc.io/sepolia',
  'https://sepolia.drpc.org',
] as const

function provider(rpcUrl: string): JsonRpcProvider {
  return new JsonRpcProvider(rpcUrl, 11155111, { staticNetwork: true })
}

async function withSepoliaProvider<T>(
  primaryUrl: string,
  fn: (p: JsonRpcProvider) => Promise<T>,
): Promise<T> {
  const urls = [primaryUrl, ...SEPOLIA_RPC_FALLBACKS.filter((u) => u !== primaryUrl)]
  let lastErr: unknown
  for (const url of urls) {
    try {
      return await fn(provider(url))
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Sepolia RPC unavailable')
}

export async function fetchSepoliaBalances(
  cfg: SepoliaBridgeConfig,
  evmAddress: string,
): Promise<SepoliaBalances> {
  return withSepoliaProvider(cfg.rpc_url, async (p) => {
    const usdc = new Contract(cfg.usdc_token, ERC20_ABI, p)
    const [ethWei, usdcRaw, decimals] = await Promise.all([
      p.getBalance(evmAddress),
      usdc.balanceOf(evmAddress),
      usdc.decimals().catch(() => cfg.usdc_decimals),
    ])
    return {
      eth: formatUnits(ethWei, 18),
      usdc: formatUnits(usdcRaw, decimals),
    }
  })
}

export async function depositUsdcToBridge(opts: {
  cfg: SepoliaBridgeConfig
  evmPrivateKey: string
  amountUsdc: string
  falconAccount: string
  onStep?: (step: string) => void
}): Promise<BridgeDepositResult> {
  const { cfg, evmPrivateKey, amountUsdc, falconAccount, onStep } = opts
  if (!FALCON_ADDRESS_RE.test(falconAccount.trim())) {
    throw new Error('Invalid Falcon destination address — cannot bridge in')
  }
  onStep?.('Connecting to Sepolia…')
  const p = await resolveProvider(cfg.rpc_url)
  const signer = new Wallet(evmPrivateKey, p)
  const usdc = new Contract(cfg.usdc_token, ERC20_ABI, signer)
  const lock = new Contract(cfg.lock_contract, LOCK_ABI, signer)

  onStep?.('Checking Sepolia balances…')
  const decimals: number = await usdc.decimals().catch(() => cfg.usdc_decimals)

  const ethBal = await p.getBalance(signer.address)
  if (ethBal === 0n) {
    throw new Error(
      'No Sepolia ETH for gas. Get test ETH from a Sepolia faucet, then try again.',
    )
  }

  const usdcBal: bigint = await usdc.balanceOf(signer.address)
  const amount = parseUnits(amountUsdc, decimals)
  if (amount <= 0n) throw new Error('Amount must be greater than zero')
  if (amount > usdcBal) {
    throw new Error(
      `Amount exceeds Sepolia USDC balance (${formatUnits(usdcBal, decimals)} available)`,
    )
  }

  let approveHash: string | undefined
  const allowance: bigint = await usdc.allowance(signer.address, cfg.lock_contract)
  if (allowance < amount) {
    onStep?.('Signing USDC approve (no second passkey — uses Sepolia wallet)…')
    let approveTx
    try {
      approveTx = await usdc.approve(cfg.lock_contract, amount)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new Error(`USDC approve failed: ${msg}`)
    }
    const approveRc = await waitForTx(approveTx, 'USDC approve', onStep)
    approveHash = approveRc.hash
  }

  onStep?.('Signing lock deposit on bridge contract…')
  let depositTx
  try {
    depositTx = await lock.deposit(amount, falconAccount)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`Bridge deposit failed to submit: ${msg}`)
  }
  const depositRc = await waitForTx(depositTx, 'Bridge deposit', onStep)

  let depositId: string | undefined
  for (const log of depositRc.logs ?? []) {
    try {
      const parsed = lock.interface.parseLog(log as { topics: readonly string[]; data: string })
      if (parsed?.name === 'DepositCreated') {
        depositId = parsed.args.depositId as string
        break
      }
    } catch {
      /* not our event */
    }
  }

  return {
    approveHash,
    depositHash: depositRc.hash,
    depositId,
  }
}

export async function sendSepoliaEth(opts: {
  cfg: SepoliaBridgeConfig
  evmPrivateKey: string
  to: string
  amountEth: string
}): Promise<string> {
  const p = await resolveProvider(opts.cfg.rpc_url)
  const signer = new Wallet(opts.evmPrivateKey, p)
  const tx = await signer.sendTransaction({
    to: opts.to,
    value: parseUnits(opts.amountEth, 18),
  })
  const rc = await tx.wait()
  if (!rc || rc.status !== 1) throw new Error('ETH send failed')
  return rc.hash
}

export async function sendSepoliaUsdc(opts: {
  cfg: SepoliaBridgeConfig
  evmPrivateKey: string
  to: string
  amountUsdc: string
}): Promise<string> {
  const p = await resolveProvider(opts.cfg.rpc_url)
  const signer = new Wallet(opts.evmPrivateKey, p)
  const usdc = new Contract(opts.cfg.usdc_token, ERC20_ABI, signer)
  const decimals: number = await usdc.decimals().catch(() => opts.cfg.usdc_decimals)
  const amount = parseUnits(opts.amountUsdc, decimals)
  const tx = await usdc.transfer(opts.to, amount)
  const rc = await tx.wait()
  if (!rc || rc.status !== 1) throw new Error('USDC send failed')
  return rc.hash
}

async function resolveProvider(primaryUrl: string): Promise<JsonRpcProvider> {
  const urls = [primaryUrl, ...SEPOLIA_RPC_FALLBACKS.filter((u) => u !== primaryUrl)]
  for (const url of urls) {
    try {
      const prov = provider(url)
      await prov.getBlockNumber()
      return prov
    } catch {
      /* try next */
    }
  }
  throw new Error('Cannot reach Sepolia RPC')
}

export interface WithdrawalReleaseStatus {
  released: boolean
  txHash?: string
  amount?: string
}

interface WithdrawalReleasedLog {
  transactionHash?: string
  logIndex?: number
  args?: { amount?: bigint }
}

/**
 * Poll Sepolia for a WithdrawalReleased event crediting `recipient` after a
 * Falcon bridge-out. Best-effort: returns { released:false } if nothing is
 * found before the timeout (relay may still be processing). Never throws for
 * missing releases — only for total RPC failure.
 *
 * The scan window lags the chain tip by `lookbackBlocks` and is re-scanned with
 * that same overlap on every poll, so an event that lands during a short reorg
 * or between polls is still detected rather than dropped (previously only 1
 * block back was scanned, which could miss releases on reorg or slow polling).
 */
export async function waitForWithdrawalRelease(opts: {
  cfg: SepoliaBridgeConfig
  recipient: string
  fromBlock?: number
  timeoutMs?: number
  pollMs?: number
  lookbackBlocks?: number
}): Promise<WithdrawalReleaseStatus> {
  const { cfg, recipient } = opts
  const timeoutMs = opts.timeoutMs ?? 300_000
  const pollMs = opts.pollMs ?? 15_000
  const deadline = Date.now() + timeoutMs
  const lookback = Math.max(
    1,
    opts.lookbackBlocks ?? cfg.release_lookback_blocks ?? defaultReleaseLookbackBlocks(cfg.chain_id),
  )

  return withSepoliaProvider(cfg.rpc_url, async (p) => {
    const lock = new Contract(cfg.lock_contract, LOCK_ABI, p)
    const decimals = cfg.usdc_decimals
    const filter = lock.filters.WithdrawalReleased(null, recipient)

    // Cursor for the low end of the scan window; advances forward each poll but
    // always keeps a `lookback` overlap so reorged/late events are re-scanned.
    let scanFrom = opts.fromBlock ?? Math.max(0, (await p.getBlockNumber()) - lookback)
    const seen = new Set<string>()

    for (;;) {
      try {
        const latest = await p.getBlockNumber()
        // Lower bound = the persisted cursor, but never newer than `latest - lookback`,
        // so every poll re-scans at least the last `lookback` blocks (reorg/gap overlap).
        const fromBlock = Math.max(0, Math.min(scanFrom, latest - lookback))
        const events = (await lock.queryFilter(filter, fromBlock, latest)) as WithdrawalReleasedLog[]

        // De-dup across overlapping windows and return the newest matching release.
        let match: WithdrawalReleasedLog | undefined
        for (const ev of events) {
          const key = `${ev.transactionHash ?? ''}:${ev.logIndex ?? ''}`
          if (seen.has(key)) continue
          seen.add(key)
          match = ev
        }
        if (match) {
          const raw = match.args?.amount
          return {
            released: true,
            txHash: match.transactionHash,
            amount: typeof raw === 'bigint' ? formatUnits(raw, decimals) : undefined,
          }
        }

        // Advance the cursor while retaining the lookback overlap for the next poll.
        scanFrom = Math.max(scanFrom, latest - lookback)
      } catch {
        /* transient RPC hiccup — keep polling until deadline */
      }
      if (Date.now() >= deadline) return { released: false }
      await new Promise((r) => setTimeout(r, pollMs))
    }
  })
}