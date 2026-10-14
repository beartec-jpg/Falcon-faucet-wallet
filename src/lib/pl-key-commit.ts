/** Audit C-1 (Falcon PL 2.9.65): the chain refuses a first key that nothing commits to. */
export function isKeyBindRefusal(msg: string): boolean {
  return /key bind: account has no key/i.test(msg)
}

export const KEY_BIND_HELP =
  'This account was funded without your key on record, so the network will not let a new key spend it. Ask the faucet/operator to re-fund it to your key (pay-to-key).'
