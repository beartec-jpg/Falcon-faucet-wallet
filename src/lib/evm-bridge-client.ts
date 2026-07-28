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
  chainLabel = 'chain',
): Promise<{ status?: number | null; hash: string; logs?: unknown[] }> {
  onStep?.(`${label} submitted — waiting for ${chainLabel} confirmation…`)
  onStep?.(`Tx ${tx.hash.slice(0, 10)}…`)
  const rc = await tx.wait(1, TX_CONFIRM_TIMEOUT_MS)
  if (!rc) {
    throw new Error(`${label} timed out after 3 minutes (${tx.hash})`)
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

export const BSC_TESTNET_RPC_FALLBACKS = [
  'https://bsc-testnet-rpc.publicnode.com',
  'https://data-seed-prebsc-1-s1.binance.org:8545',
  'https://bsc-testnet.drpc.org',
  'https://rpc.ankr.com/bsc_testnet_chapel',
] as const

function provider(rpcUrl: string, chainId = 11155111): JsonRpcProvider {
  return new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true })
}

/** Same-origin BSC proxy — works under Vercel CSP where public RPCs fail with "Failed to fetch". */
function bscTestnetProxyUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/api/wallet/bnb-rpc`
  }
  return '/api/wallet/bnb-rpc'
}

async function withEvmProvider<T>(
  primaryUrl: string,
  chainId: number,
  fallbacks: readonly string[],
  fn: (p: JsonRpcProvider) => Promise<T>,
  label = 'EVM',
): Promise<T> {
  const urls: string[] = []
  // Prefer same-origin proxy for BSC testnet first
  if (chainId === 97) {
    urls.push(bscTestnetProxyUrl())
  }
  urls.push(primaryUrl, ...fallbacks.filter((u) => u !== primaryUrl && !urls.includes(u)))

  let lastErr: unknown
  for (const url of urls) {
    try {
      return await fn(provider(url, chainId))
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`${label} RPC unavailable`)
}

async function withSepoliaProvider<T>(
  primaryUrl: string,
  fn: (p: JsonRpcProvider) => Promise<T>,
): Promise<T> {
  return withEvmProvider(primaryUrl, 11155111, SEPOLIA_RPC_FALLBACKS, fn, 'Sepolia')
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

/**
 * Generic ERC-20 lock deposit (USDC, WETH, WBNB, …) into FalconCollateralLock.
 * Same approve + deposit(amount, falconAccount) flow for any token address.
 */
export async function depositErc20ToBridge(opts: {
  rpcUrl: string
  chainId?: number
  rpcFallbacks?: readonly string[]
  chainLabel?: string
  tokenAddress: string
  lockContract: string
  tokenDecimals: number
  tokenSymbol: string
  evmPrivateKey: string
  amount: string
  falconAccount: string
  gasTokenSymbol?: string
  onStep?: (step: string) => void
}): Promise<BridgeDepositResult> {
  const {
    rpcUrl,
    chainId = 11155111,
    rpcFallbacks = SEPOLIA_RPC_FALLBACKS,
    chainLabel = 'Sepolia',
    tokenAddress,
    lockContract,
    tokenDecimals,
    tokenSymbol,
    evmPrivateKey,
    amount: amountStr,
    falconAccount,
    gasTokenSymbol = 'ETH',
    onStep,
  } = opts
  if (!FALCON_ADDRESS_RE.test(falconAccount.trim())) {
    throw new Error('Invalid Falcon destination address — cannot bridge in')
  }
  onStep?.(`Connecting to ${chainLabel}…`)
  const p = await resolveEvmProvider(rpcUrl, chainId, rpcFallbacks, chainLabel)
  const signer = new Wallet(evmPrivateKey, p)
  const token = new Contract(tokenAddress, ERC20_ABI, signer)
  const lock = new Contract(lockContract, LOCK_ABI, signer)

  onStep?.(`Checking ${chainLabel} ${tokenSymbol} balances…`)
  const decimals: number = await token.decimals().catch(() => tokenDecimals)

  const gasBal = await p.getBalance(signer.address)
  if (gasBal === 0n) {
    throw new Error(
      `No ${gasTokenSymbol} for gas on ${chainLabel}. Fund the Multi-chain address, then try again.`,
    )
  }

  const tokenBal: bigint = await token.balanceOf(signer.address)
  const amount = parseUnits(amountStr, decimals)
  if (amount <= 0n) throw new Error('Amount must be greater than zero')
  if (amount > tokenBal) {
    throw new Error(
      `Amount exceeds ${tokenSymbol} balance (${formatUnits(tokenBal, decimals)} available)`,
    )
  }

  let approveHash: string | undefined
  const allowance: bigint = await token.allowance(signer.address, lockContract)
  if (allowance < amount) {
    onStep?.(`Signing ${tokenSymbol} approve…`)
    let approveTx
    try {
      approveTx = await token.approve(lockContract, amount)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new Error(`${tokenSymbol} approve failed: ${msg}`)
    }
    const approveRc = await waitForTx(approveTx, `${tokenSymbol} approve`, onStep, chainLabel)
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
  const depositRc = await waitForTx(depositTx, 'Bridge deposit', onStep, chainLabel)

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

export async function depositUsdcToBridge(opts: {
  cfg: SepoliaBridgeConfig
  evmPrivateKey: string
  amountUsdc: string
  falconAccount: string
  onStep?: (step: string) => void
}): Promise<BridgeDepositResult> {
  const { cfg, evmPrivateKey, amountUsdc, falconAccount, onStep } = opts
  return depositErc20ToBridge({
    rpcUrl: cfg.rpc_url,
    tokenAddress: cfg.usdc_token,
    lockContract: cfg.lock_contract,
    tokenDecimals: cfg.usdc_decimals,
    tokenSymbol: 'USDC',
    evmPrivateKey,
    amount: amountUsdc,
    falconAccount,
    onStep,
  })
}

const WETH_ABI = [
  'function deposit() payable',
  'function withdraw(uint256 wad)',
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
] as const

/** Wrap native gas token into WETH/WBNB-style ERC-20. */
export async function wrapNativeToWrapped(opts: {
  rpcUrl: string
  chainId?: number
  rpcFallbacks?: readonly string[]
  chainLabel?: string
  wrappedToken: string
  wrappedSymbol?: string
  nativeSymbol?: string
  evmPrivateKey: string
  amount: string
  gasReserve?: string
  onStep?: (step: string) => void
}): Promise<string> {
  const chainId = opts.chainId ?? 11155111
  const fallbacks = opts.rpcFallbacks ?? SEPOLIA_RPC_FALLBACKS
  const chainLabel = opts.chainLabel ?? 'Sepolia'
  const wrappedSymbol = opts.wrappedSymbol ?? 'WETH'
  const nativeSymbol = opts.nativeSymbol ?? 'ETH'
  const gasReserveAmt = opts.gasReserve ?? '0.001'
  const p = await resolveEvmProvider(opts.rpcUrl, chainId, fallbacks, chainLabel)
  const signer = new Wallet(opts.evmPrivateKey, p)
  const wrapped = new Contract(opts.wrappedToken, WETH_ABI, signer)
  const value = parseUnits(opts.amount, 18)
  if (value <= 0n) throw new Error('Amount must be greater than zero')
  const nativeBal = await p.getBalance(signer.address)
  const gasReserve = parseUnits(gasReserveAmt, 18)
  if (nativeBal < value + gasReserve) {
    throw new Error(
      `Need ${opts.amount} ${nativeSymbol} + ~${gasReserveAmt} for gas (have ${formatUnits(nativeBal, 18)} ${nativeSymbol})`,
    )
  }
  opts.onStep?.(`Wrapping ${opts.amount} ${nativeSymbol} → ${wrappedSymbol}…`)
  const tx = await wrapped.deposit({ value })
  const rc = await waitForTx(tx, `${wrappedSymbol} wrap`, opts.onStep, chainLabel)
  return rc.hash
}

/** Wrap native ETH into WETH on Sepolia. */
export async function wrapEthToWeth(opts: {
  rpcUrl: string
  wethToken: string
  evmPrivateKey: string
  amountEth: string
  onStep?: (step: string) => void
}): Promise<string> {
  return wrapNativeToWrapped({
    rpcUrl: opts.rpcUrl,
    wrappedToken: opts.wethToken,
    evmPrivateKey: opts.evmPrivateKey,
    amount: opts.amountEth,
    onStep: opts.onStep,
  })
}

/**
 * Bridge In FETH: wrap ETH→WETH if needed, approve, lock into FETH FalconCollateralLock.
 * `amountEth` is the amount of ETH to lock as WETH (1:1 mint of FETH).
 */
export async function depositEthToFethBridge(opts: {
  cfg: SepoliaBridgeConfig
  evmPrivateKey: string
  amountEth: string
  falconAccount: string
  onStep?: (step: string) => void
}): Promise<BridgeDepositResult & { wrapHash?: string }> {
  const { cfg, evmPrivateKey, amountEth, falconAccount, onStep } = opts
  const weth = cfg.weth_token
  const lock = cfg.weth_lock_contract
  if (!weth?.match(/^0x[a-fA-F0-9]{40}$/) || !lock?.match(/^0x[a-fA-F0-9]{40}$/)) {
    throw new Error('FETH bridge not deployed yet — WETH lock contract missing from config')
  }
  if (!FALCON_ADDRESS_RE.test(falconAccount.trim())) {
    throw new Error('Invalid Falcon destination address — cannot bridge in')
  }

  onStep?.('Connecting to Sepolia…')
  const p = await resolveProvider(cfg.rpc_url)
  const signer = new Wallet(evmPrivateKey, p)
  const wethC = new Contract(weth, WETH_ABI, signer)
  const amount = parseUnits(amountEth, cfg.weth_decimals ?? 18)
  if (amount <= 0n) throw new Error('Amount must be greater than zero')

  let wrapHash: string | undefined
  const wethBal: bigint = await wethC.balanceOf(signer.address)
  if (wethBal < amount) {
    const need = amount - wethBal
    wrapHash = await wrapEthToWeth({
      rpcUrl: cfg.rpc_url,
      wethToken: weth,
      evmPrivateKey,
      amountEth: formatUnits(need, 18),
      onStep,
    })
  }

  const result = await depositErc20ToBridge({
    rpcUrl: cfg.rpc_url,
    chainId: cfg.chain_id ?? 11155111,
    tokenAddress: weth,
    lockContract: lock,
    tokenDecimals: cfg.weth_decimals ?? 18,
    tokenSymbol: 'WETH',
    evmPrivateKey,
    amount: amountEth,
    falconAccount,
    onStep,
  })
  return { ...result, wrapHash }
}

/**
 * Bridge In FBNB: wrap BNB→WBNB if needed, approve, lock on BSC testnet.
 */
export async function depositBnbToFbnbBridge(opts: {
  rpcUrl: string
  wbnbToken: string
  lockContract: string
  wbnbDecimals?: number
  evmPrivateKey: string
  amountBnb: string
  falconAccount: string
  onStep?: (step: string) => void
}): Promise<BridgeDepositResult & { wrapHash?: string }> {
  const {
    rpcUrl,
    wbnbToken,
    lockContract,
    wbnbDecimals = 18,
    evmPrivateKey,
    amountBnb,
    falconAccount,
    onStep,
  } = opts
  if (!wbnbToken?.match(/^0x[a-fA-F0-9]{40}$/) || !lockContract?.match(/^0x[a-fA-F0-9]{40}$/)) {
    throw new Error('FBNB bridge not deployed yet — WBNB lock contract missing from config')
  }
  if (!FALCON_ADDRESS_RE.test(falconAccount.trim())) {
    throw new Error('Invalid Falcon destination address — cannot bridge in')
  }

  onStep?.('Connecting to BSC testnet…')
  const p = await resolveEvmProvider(rpcUrl, 97, BSC_TESTNET_RPC_FALLBACKS, 'BSC testnet')
  const signer = new Wallet(evmPrivateKey, p)
  const wbnbC = new Contract(wbnbToken, WETH_ABI, signer)
  const amount = parseUnits(amountBnb, wbnbDecimals)
  if (amount <= 0n) throw new Error('Amount must be greater than zero')

  let wrapHash: string | undefined
  const wbnbBal: bigint = await wbnbC.balanceOf(signer.address)
  if (wbnbBal < amount) {
    const need = amount - wbnbBal
    wrapHash = await wrapNativeToWrapped({
      rpcUrl,
      chainId: 97,
      rpcFallbacks: BSC_TESTNET_RPC_FALLBACKS,
      chainLabel: 'BSC testnet',
      wrappedToken: wbnbToken,
      wrappedSymbol: 'WBNB',
      nativeSymbol: 'BNB',
      gasReserve: '0.002',
      evmPrivateKey,
      amount: formatUnits(need, 18),
      onStep,
    })
  }

  const result = await depositErc20ToBridge({
    rpcUrl,
    chainId: 97,
    rpcFallbacks: BSC_TESTNET_RPC_FALLBACKS,
    chainLabel: 'BSC testnet',
    tokenAddress: wbnbToken,
    lockContract,
    tokenDecimals: wbnbDecimals,
    tokenSymbol: 'WBNB',
    gasTokenSymbol: 'BNB',
    evmPrivateKey,
    amount: amountBnb,
    falconAccount,
    onStep,
  })
  return { ...result, wrapHash }
}

/** WETH → FETH lock deposit (pre-wrapped). Prefer depositEthToFethBridge for UX. */
export async function depositWethToBridge(opts: {
  cfg: SepoliaBridgeConfig & { weth_token?: string; weth_lock_contract?: string; weth_decimals?: number }
  evmPrivateKey: string
  amountWeth: string
  falconAccount: string
  onStep?: (step: string) => void
}): Promise<BridgeDepositResult> {
  const { cfg, evmPrivateKey, amountWeth, falconAccount, onStep } = opts
  const weth = cfg.weth_token
  const lock = cfg.weth_lock_contract
  if (!weth?.match(/^0x[a-fA-F0-9]{40}$/) || !lock?.match(/^0x[a-fA-F0-9]{40}$/)) {
    throw new Error('FETH bridge not deployed yet — WETH lock contract missing from config')
  }
  return depositErc20ToBridge({
    rpcUrl: cfg.rpc_url,
    tokenAddress: weth,
    lockContract: lock,
    tokenDecimals: cfg.weth_decimals ?? 18,
    tokenSymbol: 'WETH',
    evmPrivateKey,
    amount: amountWeth,
    falconAccount,
    onStep,
  })
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

async function resolveEvmProvider(
  primaryUrl: string,
  chainId = 11155111,
  fallbacks: readonly string[] = SEPOLIA_RPC_FALLBACKS,
  label = 'EVM',
): Promise<JsonRpcProvider> {
  const urls: string[] = []
  if (chainId === 97) {
    urls.push(bscTestnetProxyUrl())
  }
  urls.push(primaryUrl, ...fallbacks.filter((u) => u !== primaryUrl && !urls.includes(u)))

  let lastErr: unknown
  for (const url of urls) {
    try {
      const prov = provider(url, chainId)
      await prov.getBlockNumber()
      return prov
    } catch (e) {
      lastErr = e
    }
  }
  const hint =
    chainId === 97
      ? 'Cannot reach BSC testnet (proxy + public RPCs failed). Hard-refresh and try again.'
      : `Cannot reach ${label} RPC`
  throw lastErr instanceof Error ? new Error(`${hint}: ${lastErr.message}`) : new Error(hint)
}

async function resolveProvider(primaryUrl: string): Promise<JsonRpcProvider> {
  return resolveEvmProvider(primaryUrl, 11155111, SEPOLIA_RPC_FALLBACKS, 'Sepolia')
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