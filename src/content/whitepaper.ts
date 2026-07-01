/** Falcon Ledger whitepaper content — single source for /whitepaper */

export const WHITEPAPER_VERSION = '2.1'
export const WHITEPAPER_DATE = 'July 2026'

export const WHITEPAPER_SECTIONS: { id: string; title: string; body: string }[] = [
  {
    id: 'summary',
    title: 'Executive Summary',
    body: `Falcon Ledger is a quantum-resistant payment protocol forked from the XRP Ledger. It keeps RPCA consensus and sub-second finality, and replaces company-controlled supply, zero validator incentives, and classical cryptography with Falcon-512 post-quantum signatures, protocol-controlled treasury emission, and on-chain Proof-of-Participation rewards.

**Falcon signatures for authority.** Falcon-512 lattice signatures secure validator consensus messages, account transactions, and on-chain validator identity. Wallets on this testnet are Falcon-native: every account is created with a Falcon key pair, and every transaction is signed and verified with Falcon.

**Fixed supply — 200 billion qXRP.** 98% is locked in a protocol treasury with no private key, released only by on-chain epoch rules to qualifying validators. Fees burn and validators earn — no company escrow or monthly unlock schedule.

**No exchange required (mainnet target).** Built-in DEX and AMM enable in-wallet qXRP↔USDC/USDT swaps without a centralized exchange.`,
  },
  {
    id: 'testnet',
    title: 'Live Testnet (Network 1001)',
    body: `The public Falcon Ledger testnet runs today with Network ID **1001**.

| Item | Value |
|------|-------|
| Public RPC | \`http://46.224.0.140:6005\` |
| Faucet drip | 2,000 qXRP per request (rate-limited) |
| Minimum validator bond | 1,000 qXRP |
| Epoch length (testnet) | 100 ledgers (~6 min) for faster reward testing |
| Validator quorum | 3 of 4+ validators |

**What works today:** Falcon-512 account creation, Falcon-signed transactions, validator register/bond/unbond, epoch emission, composite scoring, ClaimReward, double-sign slashing, and on-chain governance.

**Rolling out now:** Full Falcon validator consensus — \`[validation_falcon_secret]\` replaces classical \`[validation_seed]\`, and the trusted validator list (UNL) uses Falcon public keys (hex) instead of classical \`n9…\` keys. This requires a coordinated fleet upgrade and re-bond (consensus-breaking).`,
  },
  {
    id: 'quantum',
    title: '4. Quantum Security — Falcon as Standard',
    body: `### 4.1 The threat
Shor's algorithm breaks ECDSA and ed25519 once cryptographically relevant quantum computers exist. Every classical public key exposed on-chain becomes attackable.

### 4.2 Falcon-512
Falcon-512 is a NIST-approved lattice-based signature scheme (NIST PQC). Validator and account keys use a \`0xFB\` prefix with 897 raw bytes (898 bytes on-wire). Signatures are verified locally and deterministically via liboqs — no external services in consensus paths.

### 4.3 Falcon-native authority (no classical signing paths)
Falcon Ledger does **not** use secp256k1 or ed25519 for:
- Account transaction signing
- Validator consensus proposals and validations
- On-chain validator register/bond/claim/governance transactions
- Trusted validator list (UNL) identity

**P2P overlay only:** Validators may configure a separate \`node_seed\` for peer-to-peer overlay identity and handshakes. This key does **not** sign consensus proposals, validations, or rewards — it is not part of validator authority or bonding.

### 4.4 Design principles
- Quantum resistance is a protocol requirement, not an optional feature.
- Falcon is the only signing scheme for account and validator authority.
- Consensus verification must never throw on malformed keys — invalid signatures return false.
- Secret material is zeroized with \`OPENSSL_cleanse\` / \`secureErase\`.`,
  },
  {
    id: 'tokenomics',
    title: '5. Tokenomics',
    body: `**Total supply:** 200,000,000,000 qXRP — hard cap, no additional issuance.

| Account | qXRP | Share | Purpose |
|---------|-----:|------:|---------|
| Genesis circulating | 4,000,000,000 | 2% | Bootstrap liquidity, development |
| Protocol treasury | 196,000,000,000 | 98% | Epoch emission only |

**Emission:** Halving schedule — initial 50 bps per epoch (0.50% of treasury), halving every 208 epochs (~4 years), floor 1 bps.

**Fees:** 40%–70% burned; remainder to active validators. Burn fraction adjusts from on-chain treasury fill and fee volume signals.`,
  },
  {
    id: 'pop',
    title: '6. Proof of Participation',
    body: `Validators earn treasury emission proportional to a composite on-chain score:

\`\`\`
composite = (uptime×40 + voteAccuracy×30 + latency×15 + consistency×10 + slashMultiplier×5) ÷ 100
\`\`\`

- **Minimum bond:** 1,000 qXRP
- **Minimum score for rewards:** 5% composite
- **Unbonding:** ~30 days (262,800 ledgers at mainnet cadence)
- **Claiming:** Pull-based via \`ClaimReward\` each epoch

**Slashing (today):** Double-sign → 100% bond burn + forced unbond. Absence and invalid-vote offenses are defined but return \`temDISABLED\` on testnet pending further testing.

**Latency score:** Currently hard-floored at neutral (5,000 bps) — real latency measurement is on the roadmap.`,
  },
  {
    id: 'governance',
    title: '7. On-Chain Governance',
    body: `Bonded validators propose parameter changes via \`GovernanceProposal\`. Voting runs 7 days; each vote is weighted by composite score at submission. Passing requires >67% of aggregate score. Governable parameters include fee burn fraction within 40%–70% bounds. Supply cap, treasury lock, and RPCA rules are immutable.`,
  },
  {
    id: 'liquidity',
    title: '8. Faucet, Wallet, and Built-In Liquidity',
    body: `This portal (q-xrp-faucet.vercel.app) provides:
- **Faucet** — fund new Falcon wallets
- **Wallet** — passkey-secured Falcon-512 accounts, send/receive, validator onboarding
- **Explorer** — ledger and transaction scan
- **Market** — DEX/AMM interface (requires configured stablecoin issuers on testnet)

Mainnet target: swap qXRP rewards to USDC/USDT entirely on-chain without a centralized exchange.`,
  },
  {
    id: 'comparison',
    title: '9. Falcon Ledger vs XRP',
    body: `| | XRP | Falcon Ledger |
|--|-----|---------------|
| Supply control | Company holds ~40B | Protocol treasury, no private key |
| Validator rewards | None | Paid every epoch on-chain |
| Transaction crypto | ed25519/secp256k1 | Falcon-512 |
| Validator consensus crypto | ed25519/secp256k1 | Falcon-512 (full rollout) |
| Escrow unlocks | Monthly Ripple releases | None — protocol emission only |
| Governance | Off-chain / company-led | On-chain bonded supermajority |
| Fee model | Burned only | Burn + validator share |
| Slashing | None | Cryptographic proof on-chain |`,
  },
  {
    id: 'milestones',
    title: '10. Milestones',
    body: `### Completed
- Direct fork of XRPL reference implementation (replay-protected)
- Falcon-512 transaction signing — accounts, faucet, and wallet (verified end-to-end on testnet)
- Protocol treasury, epoch emission, halving schedule
- Validator register, bond, unbond, composite scoring, ClaimReward
- Double-sign slashing (100% bond)
- On-chain governance proposals and voting
- Drop conservation invariant
- Sustained testnet load (850k+ payments, 71+ hours, zero consensus stalls)

### In progress (July 2026)
- Full Falcon validator consensus fleet upgrade (\`validation_falcon_secret\`, Falcon hex UNL)
- Built-in DEX/AMM stablecoin pairs on testnet
- Latency scoring and additional slashing offenses
- Mainnet genesis validator set and production audit packages`,
  },
  {
    id: 'technical',
    title: '11. Technical Summary',
    body: `| Component | Detail |
|-----------|--------|
| Chain name | Falcon Ledger |
| Token | qXRP |
| Testnet network ID | 1001 |
| Consensus | RPCA (XRP Ledger) |
| Account / tx signatures | Falcon-512 |
| Validator consensus signatures | Falcon-512 |
| Total supply | 200,000,000,000 qXRP |
| Treasury | 196B qXRP (98%), no private key |
| Min bond | 1,000 qXRP |
| Governance threshold | 67% aggregate composite score |
| liboqs pin | v0.12.0 (\`f4b96220…\`) |`,
  },
]