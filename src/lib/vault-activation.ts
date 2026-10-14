/**
 * Vault activation funded from the linked hot wallet.
 *
 * Flow (one tap on /vault): the hot wallet sends `pay_to_key` (v2.9.65+) or a
 * plain `pay` (before the key-bind height) of the activation fee plus tx fees
 * to the not-yet-existing `.vault` name, committing sha256(raw vault pubkey).
 * The vault key then signs `vault_open` (which binds that committed key and
 * locks payouts to the hot account), and the name is activated.
 */

/** Per-tx FPL fee used by the site wallet. */
export const PL_TX_FEE = 2

/** FPL the vault itself must hold: name fee + VaultOpen fee + one VaultLock retry. */
export function vaultActivationNeedFpl(nameFee: number): number {
  return Math.max(0, Math.floor(nameFee)) + 2 * PL_TX_FEE
}

/** FPL the hot wallet must send so the vault holds `vaultActivationNeedFpl`. */
export function vaultFundShortfall(nameFee: number, vaultBalance: number): number {
  const need = vaultActivationNeedFpl(nameFee)
  const have = Math.max(0, Math.floor(vaultBalance || 0))
  return Math.max(0, need - have)
}

/** Hot-wallet balance needed to fund `amount` (amount + its own Pay fee). */
export function hotWalletCostFpl(amount: number): number {
  return amount + PL_TX_FEE
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.trim()
  if (!/^[0-9a-fA-F]*$/.test(h) || h.length % 2) throw new Error('public key must be hex')
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** Raw 897-byte Falcon-512 public key (strips the 0xFB blob prefix). Mirrors fd-pl `falcon_raw_pub`. */
export function falconRawPub(pkHex: string): Uint8Array {
  const b = hexToBytes(pkHex)
  if (b.length === 897) return b
  if (b.length === 898 && b[0] === 0xfb) return b.slice(1)
  throw new Error('not a Falcon-512 public key')
}

/** `PayToKey.key_hash`: lowercase sha256 hex of the raw public key (fd-pl `key_commit_hash`). */
export async function keyCommitHash(pkHex: string): Promise<string> {
  const raw = falconRawPub(pkHex)
  const d = await crypto.subtle.digest('SHA-256', raw as unknown as ArrayBuffer)
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('')
}

/**
 * True when the node refused `pay_to_key` only because it is not live yet
 * (2.9.64 nodes cannot decode it; 2.9.65 refuses it before the key-bind height).
 * Then a plain Pay is correct: first-seen enrollment still applies there.
 */
export function isPayToKeyUnsupported(msg: string): boolean {
  const m = (msg || '').toLowerCase()
  return (
    m.includes('pay_to_key: not active') ||
    (m.includes('pay_to_key') && (m.includes('unknown variant') || m.includes('unknown'))) ||
    m.includes('unknown variant `pay_to_key`')
  )
}

/** True when the destination already has a key, so a plain Pay is the right top-up. */
export function isDestinationKeyBound(msg: string): boolean {
  return (msg || '').toLowerCase().includes('destination already has a key')
}

/** Is `dest` this hot wallet's own linked vault (the vault record on this device)? */
export function isOwnLinkedVault(
  dest: string,
  hotAccount: string,
  vault: { accountName?: string; payoutAddress?: string; publicKey?: string } | null | undefined,
  linkedName: string | null,
): boolean {
  const d = dest.trim().toLowerCase()
  if (!d || !vault?.accountName || !vault.publicKey || !linkedName) return false
  return (
    d === vault.accountName.toLowerCase() &&
    d === linkedName.toLowerCase() &&
    (vault.payoutAddress || '').trim().toLowerCase() === hotAccount.trim().toLowerCase()
  )
}
