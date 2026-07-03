/**
 * Browser-side Sepolia USDC → Falcon bridge (approve + lock deposit).
 */

import { Contract, JsonRpcProvider, Wallet, formatUnits, parseUnits } from 'ethers'
import type { SepoliaBridgeConfig } from '@/lib/bridge-config'

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
] as const

const LOCK_ABI = [
  'function deposit(uint256 amount, string falconAccount) returns (bytes32 depositId)',
  'event DepositCreated(bytes32 indexed depositId, address indexed sender, uint256 amount, string falconAccount)',
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

function provider(rpcUrl: string): JsonRpcProvider {
  return new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true })
}

export async function fetchSepoliaBalances(
  cfg: SepoliaBridgeConfig,
  evmAddress: string,
): Promise<SepoliaBalances> {
  const p = provider(cfg.rpc_url)
  const [ethWei, usdcRaw, decimals] = await Promise.all([
    p.getBalance(evmAddress),
    new Contract(cfg.usdc_token, ERC20_ABI, p).balanceOf(evmAddress),
    new Contract(cfg.usdc_token, ERC20_ABI, p).decimals().catch(() => cfg.usdc_decimals),
  ])
  return {
    eth: formatUnits(ethWei, 18),
    usdc: formatUnits(usdcRaw, decimals),
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
  const p = provider(cfg.rpc_url)
  const signer = new Wallet(evmPrivateKey, p)
  const usdc = new Contract(cfg.usdc_token, ERC20_ABI, signer)
  const lock = new Contract(cfg.lock_contract, LOCK_ABI, signer)

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
    onStep?.('Approving USDC…')
    const approveTx = await usdc.approve(cfg.lock_contract, amount)
    const approveRc = await approveTx.wait()
    if (!approveRc || approveRc.status !== 1) throw new Error('USDC approve failed')
    approveHash = approveRc.hash
  }

  onStep?.('Locking USDC on bridge…')
  const depositTx = await lock.deposit(amount, falconAccount)
  const depositRc = await depositTx.wait()
  if (!depositRc || depositRc.status !== 1) throw new Error('Bridge deposit failed')

  let depositId: string | undefined
  for (const log of depositRc.logs) {
    try {
      const parsed = lock.interface.parseLog(log)
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