// Browser depositor for the testnet4 BitVM2 bridge test. The depositor key is the
// wallet's own Bitcoin key: it is decrypted in this browser and never sent anywhere.
import * as btc from '@scure/btc-signer'
import { secp256k1 } from '@noble/curves/secp256k1'

const hex = {
  encode: (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''),
  decode: (h: string) => {
    if (!/^([0-9a-f]{2})*$/i.test(h)) throw new Error('bad hex')
    return Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16))
  },
}

export const TN4_MEMPOOL = 'https://mempool.space/testnet4'
export const FPL_SIGNET_EXPLORER = process.env.NEXT_PUBLIC_FPL_SIGNET_EXPLORER || 'https://5-78-142-246.sslip.io'
export const INTAKE = '/api/bridge/tn4/v1'

export type DepositorRequest = {
  graph_id: string
  deposit_txid: string
  peg_in_confirm_txid: string
  psbts: { deposit: string; refund: string; confirm: string }
}

export type Tn4Deposit = {
  id: string
  account: string
  state: string
  address: string
  funding?: string | null
  funding_sats?: number | null
  deposit_txid?: string | null
  peg_in_confirm_txid?: string | null
  kickoff?: string | null
  confirmations?: number | null
  created: number
  updated: number
  last_error?: string | null
  send_sats_min?: number
  send_sats_max?: number
  depositor_request?: DepositorRequest
  ceremony?: { seats?: { id: string }[]; nonced_sha256?: string; attestations_ok?: boolean }
}

export const STATE_LABEL: Record<string, string> = {
  awaiting_funding: 'Waiting for your testnet4 deposit (1 confirmation)',
  funded: 'Funded — starting operator ceremony',
  waiting_operator_liquidity: 'Waiting for operator liquidity',
  ceremony_pubkeys: 'Operators generating presigning keys',
  awaiting_signature: 'Sign the peg-in with your wallet',
  signed: 'Operators presigning the BitVM2 graph',
  presigned: 'Graph presigned — operators binding it on the Falcon ledger',
  broadcasting: 'Broadcasting peg-in deposit + confirm',
  peg_in_confirmed: 'Peg-in confirmed — waiting for 6 confirmations',
  awaiting_mint: 'Peg-in final — operators submit the SPV proof to mint BTC4',
  expired: 'Expired (no deposit within 3 days)',
  failed: 'Failed',
}

function pubkeyFromSecret(secretHex: string): string {
  return hex.encode(secp256k1.getPublicKey(hex.decode(secretHex), true))
}

export function depositorPubkey(secretHex: string): string {
  return pubkeyFromSecret(secretHex.replace(/^0x/i, '').toLowerCase())
}

/** Sign input 0 of each depositor PSBT (deposit: P2WSH ECDSA; refund/confirm: tapscript BIP340). */
export function signDepositorRequest(req: DepositorRequest, secretHex: string): Record<'deposit' | 'refund' | 'confirm', string> {
  const key = hex.decode(secretHex.replace(/^0x/i, '').toLowerCase())
  const sign = (psbtHex: string) => {
    const tx = btc.Transaction.fromPSBT(hex.decode(psbtHex), {
      allowUnknownInputs: true,
      allowUnknownOutputs: true,
      disableScriptCheck: true,
    })
    tx.signIdx(key, 0, [btc.SigHash.ALL])
    return hex.encode(tx.toPSBT())
  }
  return { deposit: sign(req.psbts.deposit), refund: sign(req.psbts.refund), confirm: sign(req.psbts.confirm) }
}

async function j<T>(r: Response): Promise<T> {
  const out = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((out as { error?: string }).error || `HTTP ${r.status}`)
  return out as T
}

export const createDeposit = (account: string, depositor_pubkey: string) =>
  fetch(`${INTAKE}/deposits`, { method: 'POST', body: JSON.stringify({ account, depositor_pubkey }) }).then((r) => j<Tn4Deposit>(r))
export const getDeposit = (id: string) => fetch(`${INTAKE}/deposits/${id}`, { cache: 'no-store' }).then((r) => j<Tn4Deposit>(r))
export const listDeposits = (account: string) =>
  fetch(`${INTAKE}/deposits?account=${encodeURIComponent(account)}`, { cache: 'no-store' }).then((r) => j<Tn4Deposit[]>(r))
export const postSignatures = (id: string, signed: object) =>
  fetch(`${INTAKE}/deposits/${id}/signatures`, { method: 'POST', body: JSON.stringify(signed) }).then((r) => j<Tn4Deposit>(r))
