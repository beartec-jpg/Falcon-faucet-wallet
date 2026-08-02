/**
 * Sign BTCBridgeSetWatch with validator Falcon secret via admin RPC, submit publicly.
 */
import { execSync } from 'node:child_process'
import { decodeFalconSecret, addressFromPubBlob, bytesToHex } from '../src/lib/falcon-keys.ts'

const HOST = '46.224.0.140'
const KEY = `${process.env.HOME}/.ssh/id_ed25519`
const PUBLIC = 'http://46.224.0.140:6005'
const HOLD =
  '63A820000000000000000000000000000000000000000000000000000000000000000088516760B275A820C25F002D9AFA802A4D8B5B303E4AFE7C9C92F846266C2DAD654696F19AB47513885168'
const WATCH = 'D826DB3317A1F76F828DD5EBD595581146F6BCC63489F90E77486F1DB15D91B5'

function ssh(cmd: string): string {
  return execSync(
    `ssh -o StrictHostKeyChecking=no -i ${KEY} root@${HOST} ${JSON.stringify(cmd)}`,
    { encoding: 'utf8', maxBuffer: 20_000_000 },
  )
}

async function publicRpc(method: string, params: Record<string, unknown> = {}) {
  const r = await fetch(PUBLIC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params: [params] }),
  })
  return r.json() as Promise<any>
}

function adminRpc(method: string, params: Record<string, unknown>) {
  const payload = JSON.stringify({ method, params: [params] })
  const cmd = `docker exec qxrp-val2 curl -sf -X POST http://127.0.0.1:5005 -H 'Content-Type: application/json' -d ${JSON.stringify(payload)}`
  return JSON.parse(ssh(cmd))
}

async function main() {
  const secret = ssh(
    "awk '/^\\[validation_falcon_secret\\]/{getline;print;exit}' /var/lib/qxrp-val2/config/xrpld.cfg",
  ).trim()
  const decoded = decodeFalconSecret(secret)
  const account = addressFromPubBlob(decoded.pubBlob)
  const publicKeyHex = bytesToHex(decoded.pubBlob).toUpperCase()
  console.log('account', account)
  console.log('pubkey_prefix', publicKeyHex.slice(0, 20))

  const info = await publicRpc('account_info', {
    account,
    ledger_index: 'validated',
  })
  let seq = info.result?.account_data?.Sequence as number | undefined
  if (!seq) {
    console.log('not funded — funding from genesis ECDSA…')
    // Fund via previous working payment path
    const { encode, encodeForSigning } = await import('ripple-binary-codec')
    const { sign: ecdsaSign } = await import('ripple-keypairs')
    const { Wallet } = await import('xrpl')
    const { getFalconCodecDefinitions } = await import('../src/lib/falcon-codec-definitions.ts')
    const genesis = Wallet.fromSeed('snoPBrXtMeMyMHUVTgbuqAfg1SUTb', {
      algorithm: 'ecdsa-secp256k1',
    })
    const defs = getFalconCodecDefinitions()
    const gInfo = await publicRpc('account_info', {
      account: genesis.classicAddress,
      ledger_index: 'validated',
    })
    const gSeq = gInfo.result.account_data.Sequence
    const pay: Record<string, unknown> = {
      TransactionType: 'Payment',
      Account: genesis.classicAddress,
      Destination: account,
      Amount: '50000000', // 50 FALCON
      Fee: '12',
      Sequence: gSeq,
      SigningPubKey: genesis.publicKey,
    }
    const toSign = encodeForSigning(pay, defs)
    pay.TxnSignature = ecdsaSign(toSign, genesis.privateKey)
    const blob = encode(pay, defs)
    const sub = await publicRpc('submit', { tx_blob: blob })
    console.log('fund', sub.result?.engine_result, sub.result?.engine_result_message)
    if (sub.result?.engine_result !== 'tesSUCCESS' && sub.result?.engine_result !== 'terQUEUED') {
      process.exit(1)
    }
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      const again = await publicRpc('account_info', {
        account,
        ledger_index: 'validated',
      })
      if (again.result?.account_data?.Sequence) {
        seq = again.result.account_data.Sequence
        console.log('funded seq', seq)
        break
      }
    }
  }
  if (!seq) {
    console.error('still unfunded')
    process.exit(1)
  }
  console.log('seq', seq)

  const le0 = await publicRpc('ledger_entry', {
    btc_bridge_state: true,
    ledger_index: 'validated',
  })
  const cur = String(le0.result?.node?.BtcWatchScriptHash || '').toUpperCase()
  console.log('current', cur)
  if (cur === WATCH) {
    console.log('ALREADY BOUND')
    return
  }

  const tx = {
    TransactionType: 'BTCBridgeSetWatch',
    Account: account,
    Fee: '1000000',
    Sequence: seq,
    BtcWatchScriptHash: WATCH,
    BtcHoldProgram: HOLD,
  }
  const signed = adminRpc('sign', { tx_json: tx, falcon_secret: secret })
  console.log('sign keys', Object.keys(signed.result || signed))
  const blob = (signed.result || signed).tx_blob
  if (!blob) {
    console.error(JSON.stringify(signed).slice(0, 1000))
    process.exit(1)
  }
  const sub = await publicRpc('submit', { tx_blob: blob })
  console.log(JSON.stringify(sub, null, 2).slice(0, 2000))
  const eng = sub.result?.engine_result
  if (eng !== 'tesSUCCESS' && eng !== 'terQUEUED') {
    process.exit(1)
  }
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const le = await publicRpc('ledger_entry', {
      btc_bridge_state: true,
      ledger_index: 'validated',
    })
    const got = String(le.result?.node?.BtcWatchScriptHash || '').toUpperCase()
    console.log(`t=${i} ${got.slice(0, 24)}…`)
    if (got === WATCH) {
      console.log('OK protocol hold bound')
      return
    }
  }
  process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
