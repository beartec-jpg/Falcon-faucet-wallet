/** Audit C-1 (Falcon PL 2.9.65): the chain refuses a first key that nothing commits to. */
export function isKeyBindRefusal(msg: string): boolean {
  return /key bind: account has no key/i.test(msg)
}

export const KEY_BIND_HELP =
  'This account has no key on record yet, and the key in this browser is not the one it was set up for, so the network will not let this wallet spend from it. Check that the wallet selected is the one you created this account with. If the account was funded with a plain payment, ask the faucet/operator to re-send to your key (pay-to-key).'

const KEY_MISMATCH_HELP =
  'The network has a different key on record for this account than the one in this browser. If this account name is also your validator/node name, rewards must be claimed with the node key for now (operator tools), not the browser wallet. Otherwise make sure you unlocked the wallet that created this account. Nothing was sent.'

const NOT_FOUND_HELP =
  'Your wallet account could not be loaded from the network. It may be new and not funded yet, or the network may be busy or paused. Check your balance on the Wallet page and try again in a few minutes. Nothing was sent.'

const UNKNOWN_KEY_HELP =
  'The network has not seen this wallet key yet. Make a small payment (or claim) from this wallet first so the network learns your key, then try again.'

/**
 * Turn raw node refusals into a plain message with a next step. Unknown
 * messages pass through unchanged. The raw text is kept at the end so it can
 * be quoted when reporting a problem.
 */
export function explainTxError(raw: string): string {
  const msg = String(raw || '').trim()
  if (!msg) return msg
  let help: string | null = null
  if (isKeyBindRefusal(msg)) help = KEY_BIND_HELP
  else if (/key mismatch|sender key does not match account/i.test(msg)) help = KEY_MISMATCH_HELP
  else if (/unknown key/i.test(msg)) help = UNKNOWN_KEY_HELP
  else if (/(wallet|account) (information |info )?not found|actNotFound|Failed to refresh account/i.test(msg))
    help = NOT_FOUND_HELP
  if (!help || msg === help) return msg
  return `${help} (Network said: ${msg})`
}
