# Wallet backup & recovery (no BIP-39 Falcon mnemonic)

## Why there is no 24-word Falcon phrase

Falcon-512 key generation in this wallet uses the liboqs / wasm path
(`_OQS_SIG_keypair`) with the library’s internal CSPRNG. That API does **not**
expose a seeded / deterministic keygen hook that would safely derive a Falcon
keypair from a BIP-39 seed without forking or reimplementing the PQC keygen.

Until such a hook exists and is audited, we **do not** invent a mnemonic → Falcon
mapping (that would be a new cryptographic design, not a standard).

ETH / BTC keys in the multi-chain backup already use their normal CSPRNG /
family-seed paths and are included in the encrypted backup file.

## What to do instead

1. On wallet create (and any re-export), download the **encrypted backup file**
   and choose a strong backup password.
2. **Keep a second copy** on a different device or offline medium.
3. Restore only via the in-app “Restore from backup” flow with that file + password.

Losing both the device wallet (passkey / local store) and every backup copy
means the Falcon account cannot be recovered.
