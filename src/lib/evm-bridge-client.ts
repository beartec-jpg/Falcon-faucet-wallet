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

const TX_CONFIRM_TIMEOUT_MS = 180_000

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
  onStep?.('Connecting to Sepolia…')
  const p = await resolveProvider(cfg.rpc_url)
  const signer = new Wallet(evmPrivateKey, p)
  const usdc = new Contract(cfg.usdc_token, ERC20_ABI, signer)
  const lock = new Contract(cfg.lock_contract, LOCK_ABI, signer)

  onStep?.('Checking Sepolia balances…')
  const decimals: number = await usdc.decimals().catch(() => cfg.usdc_decimals)
  const amount = parseUnits(amountUsdc, decimals)

  if (amount <= 0n) throw new Error('Amount must be greater than zero')

  const ethBal = await p.getBalance(signer.address)
  if (ethBal === 0n) {
    throw new Error(
      'No Sepolia ETH for gas. Get test ETH from a Sepolia faucet, then try again.',
    )
  }

  const usdcBal: bigint = await usdc.balanceOf(signer.address)
  if (usdcBal < amount) {
    throw new Error(`Insufficient Sepolia USDC (have ${formatUnits(usdcBal, decimals)})`)
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