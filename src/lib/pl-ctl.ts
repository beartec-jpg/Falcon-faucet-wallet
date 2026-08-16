/**
 * Sign+submit Falcon-512 txs via falcon-pl-ctl (live 2200 keyring).
 * Status still goes over TCP in pl-rpc.ts.
 */

import { spawn } from 'child_process'
import os from 'os'
import path from 'path'

export const PL_CTL =
  process.env.FALCON_PL_CTL?.trim() ||
  path.join(os.homedir(), 'falcon-pl-public-testnet-2300/bin/falcon-pl-ctl')
export const PL_KEYS =
  process.env.FALCON_PL_KEYS?.trim() ||
  path.join(os.homedir(), 'falcon-pl-public-testnet-2300/keys')
export const PL_SCHEME = process.env.FALCON_PL_SCHEME?.trim() || 'falcon-512'
export const PL_ADDR = process.env.FALCON_PL_RPC?.trim() || '127.0.0.1:19301'
export const PL_NETWORK_ID = Number(process.env.FALCON_PL_NETWORK_ID ?? '2300')

export function runCtl(
  args: string[],
  opts?: { timeoutMs?: number },
): Promise<{ code: number; stdout: string; stderr: string }> {
  const timeoutMs = opts?.timeoutMs ?? 20_000
  return new Promise((resolve, reject) => {
    const child = spawn(PL_CTL, ['--addr', PL_ADDR, ...args], {
      env: process.env,
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`ctl timeout: ${args.join(' ')}`))
    }, timeoutMs)
    child.stdout.on('data', (d) => {
      stdout += String(d)
    })
    child.stderr.on('data', (d) => {
      stderr += String(d)
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

function mustOk(r: { code: number; stdout: string; stderr: string }, what: string) {
  if (r.code !== 0) {
    throw new Error(`${what} failed: ${(r.stderr || r.stdout).trim() || `exit ${r.code}`}`)
  }
  return r.stdout
}

function txIdOf(out: string): string {
  const m = out.match(/tx_id=([0-9a-fA-F]+)/)
  return m?.[1] ?? ''
}

export async function ctlHeartbeat(account: string): Promise<{ txId: string; raw: string }> {
  const out = mustOk(
    await runCtl([
      'heartbeat',
      '--account',
      account,
      '--scheme',
      PL_SCHEME,
      '--keys-dir',
      PL_KEYS,
      '--network-id',
      String(PL_NETWORK_ID),
      '--fee',
      '2',
    ]),
    'heartbeat',
  )
  return { txId: txIdOf(out), raw: out }
}

export async function ctlFaucet(to: string, amount = 10_000): Promise<{ txId: string; raw: string }> {
  const out = mustOk(
    await runCtl([
      'faucet',
      '--to',
      to,
      '--amount',
      String(amount),
      '--scheme',
      PL_SCHEME,
      '--keys-dir',
      PL_KEYS,
      '--network-id',
      String(PL_NETWORK_ID),
      '--fee',
      '2',
    ]),
    'faucet',
  )
  return { txId: txIdOf(out), raw: out }
}

export async function ctlWatcherWork(
  account: string,
  count = 168,
  asset = 'BTC',
): Promise<{ accepted: number; lastTx: string; raw: string }> {
  const out = mustOk(
    await runCtl(
      [
        'watcher-work',
        '--account',
        account,
        '--asset',
        asset,
        '--count',
        String(count),
        '--scheme',
        PL_SCHEME,
        '--keys-dir',
        PL_KEYS,
        '--network-id',
        String(PL_NETWORK_ID),
        '--fee',
        '2',
      ],
      { timeoutMs: 180_000 },
    ),
    'watcher-work',
  )
  const m = out.match(/accepted=(\d+)/)
  const last = out.match(/last_tx=([0-9a-fA-F]+)/)
  return {
    accepted: m ? Number(m[1]) : 0,
    lastTx: last?.[1] ?? '',
    raw: out,
  }
}

export async function ctlClaim(account: string): Promise<{ txId: string; raw: string }> {
  const out = mustOk(
    await runCtl([
      'claim',
      '--account',
      account,
      '--scheme',
      PL_SCHEME,
      '--keys-dir',
      PL_KEYS,
      '--network-id',
      String(PL_NETWORK_ID),
      '--fee',
      '2',
    ]),
    'claim',
  )
  return { txId: txIdOf(out), raw: out }
}

export async function ctlPay(
  from: string,
  to: string,
  amount: number,
): Promise<{ txId: string; raw: string }> {
  const out = mustOk(
    await runCtl([
      'pay',
      '--from',
      from,
      '--to',
      to,
      '--amount',
      String(Math.floor(amount)),
      '--scheme',
      PL_SCHEME,
      '--keys-dir',
      PL_KEYS,
      '--network-id',
      String(PL_NETWORK_ID),
      '--fee',
      '2',
    ]),
    'pay',
  )
  return { txId: txIdOf(out), raw: out }
}

export async function ctlGenWallet(account: string): Promise<void> {
  mustOk(
    await runCtl(
      ['gen-wallet', '--keys-dir', PL_KEYS, '--account', account, '--scheme', PL_SCHEME],
      { timeoutMs: 30_000 },
    ),
    'gen-wallet',
  )
}
