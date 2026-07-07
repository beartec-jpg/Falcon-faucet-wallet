/** Falcon Ledger whitepaper content — single source for /whitepaper */

export const WHITEPAPER_VERSION = '2.2'
export const WHITEPAPER_DATE = 'July 2026'

export interface WhitepaperDownload {
  title: string
  description: string
  href: string
  filename: string
}

/** PDFs live in repo Docs/ — copied to public/Docs/ on install/build. */
export const WHITEPAPER_DOWNLOADS: WhitepaperDownload[] = [
  {
    title: 'Testnet E2E Report',
    description:
      'Comprehensive end-to-end test documentation: wallet, P2P, bridge, pool, DEX, and on-ledger references.',
    href: '/Docs/FALCON-TESTNET-E2E-REPORT.pdf',
    filename: 'FALCON-TESTNET-E2E-REPORT.pdf',
  },
  {
    title: 'Security Report — Wallet',
    description:
      'Security review of passkey wallet flows: send, receive, backup, and restore.',
    href: '/Docs/FALCON-SECURITY-REPORT-wallet-send-receive-backup-restore.pdf',
    filename: 'FALCON-SECURITY-REPORT-wallet-send-receive-backup-restore.pdf',
  },
  {
    title: 'Security Report — Bridge, Pool, AMM, Swap Orders',
    description:
      'Third-party security and functionality audit of bridge in/out, AMM pool deposit/withdraw, instant swap, and DEX limit orders.',
    href: '/Docs/FALCON-SECURITY-REPORT-bridge-pool-amm-swap-orders.pdf',
    filename: 'FALCON-SECURITY-REPORT-bridge-pool-amm-swap-orders.pdf',
  },
]

export const WHITEPAPER_SECTIONS: { id: string; title: string; body: string }[] = [
  {
    id: 'summary',
    title: 'Executive Summary',
    body: `Falcon Ledger is a quantum-resistant payment protocol forked from the XRP Ledger. It keeps RPCA consensus and sub-second finality and replaces everything that made XRP a compromised bet: the company-controlled supply, the zero validator incentives, the company-gated grants and governance, and the classical cryptography that a quantum computer will eventually break.

**Falcon signatures, everywhere, from genesis.** Falcon-512 lattice signatures are the standard signature scheme for validator identities and all transactions, built in at the protocol level from genesis — not retrofitted later. Every wallet is created with Falcon keys, every transaction is signed and verified with Falcon. This chain is built to be secure in 2026 and in 2046.

**Fixed supply.** 200 billion qXRP. Hard cap. No exceptions. 98% of the supply is locked in a protocol treasury with no private key. It is released only by on-chain consensus rules — one epoch at a time, according to a halving schedule, to the validators who keep the network alive. Validators get paid for doing the work. Fees burn. The supply shrinks. No company can dump on you, and no foundation decides who gets a grant.

**No exchange required.** Falcon Ledger ships with a built-in DEX and AMM. The launch target is an in-wallet experience — faucet, wallet, and swaps — that lets a validator convert qXRP rewards to USDC and USDT on-chain from day one of mainnet, with no centralized exchange in the loop.`,
  },
  {
    id: 'problem',
    title: '1. The Problem',
    body: `### 1.1 XRP Is Controlled by a Company
Ripple, Inc. created 100 billion XRP at genesis. The company received 80 billion XRP directly; the three co-founders (Chris Larsen, Jed McCaleb, and Arthur Britto) received the remaining 20 billion. In 2017, Ripple placed 55 billion XRP into a series of time-locked on-ledger escrow contracts to impose a transparent release schedule and cap monthly selling pressure.

As of mid-2026, approximately 36–38 billion XRP remains locked in those escrow accounts, with a further ~4–6 billion held in Ripple's operational wallets for business activities, grants, and market-making. Ripple's combined control — escrow plus operational — totals roughly 40–44 billion XRP, or around 40% of the 100-billion total supply.

The escrow mechanism releases up to 1 billion XRP per month. In practice, Ripple typically returns 700–800 million of that amount to new escrow contracts each cycle, so the net release reaching the open market runs closer to 200–400 million XRP per month. The schedule is on-chain and publicly verifiable, but the underlying reality does not change: Ripple remains the single largest holder of XRP by a wide margin, and every monthly unlock represents a latent supply overhang that the market must absorb or see returned to escrow.

Holders of XRP are permanently exposed to a counterparty that controls tens of billions of tokens in the same asset they are holding. That is a structural risk that no escrow timetable eliminates.

This is not decentralization. It is a company with a predictable vesting schedule that happens to run on a fast ledger.

### 1.2 Validators Have No Reason to Participate
Running an XRP Ledger validator costs money — hardware, bandwidth, operations. The protocol pays validators nothing. The incentive to run a validator is reputational at best, and non-existent at worst. The result is a validator set that skews heavily toward Ripple-affiliated entities and large institutions with indirect business reasons to keep the network running.

A network where most validators serve at the pleasure of one company is not a decentralized network.

### 1.3 Classical Cryptography Has an Expiry Date
ECDSA and ed25519 are secure today because factoring large integers and solving the discrete logarithm problem is computationally infeasible on classical hardware. Shor's algorithm solves both problems in polynomial time on a sufficiently large quantum computer.

NIST finalized its post-quantum cryptography standards in 2024. The timeline for cryptographically relevant quantum computers is measured in years, not decades. Financial infrastructure built today needs to be secure for 20 to 40 years. A payment chain that waits until quantum computers arrive to begin a migration will not survive it.

### 1.4 No On-Chain Governance, and Company-Gated Grants
Protocol changes on the XRP Ledger happen through Ripple's amendment process. Validators vote, but the proposals originate from and are largely controlled by Ripple. There is no on-chain mechanism for bonded participants to propose, debate, and ratify changes to economic parameters without relying on off-chain social coordination and a company's goodwill. Ecosystem funding, too, flows through company- and foundation-controlled grant programs that pick winners off-chain.

### 1.5 You Still Need an Exchange to Get Paid
Even where a chain pays participants, realizing that value usually means moving tokens to a centralized exchange — KYC, listing politics, withdrawal limits, and counterparty risk. The reward only matters if you can spend it.`,
  },
  {
    id: 'why-now',
    title: '2. Why Now',
    body: `- **NIST Post-Quantum Cryptography standards finalized in 2024:** ML-DSA (CRYSTALS-Dilithium) and Falcon-512 are the approved signature schemes.
- **The era of VC-controlled "decentralized" protocols is ending under regulatory scrutiny.** SEC actions against centralized token issuers are accelerating globally.
- **Bitcoin's halving model proved that predictable emission schedules build long-term holder confidence.** No equivalent model exists in the XRP ecosystem.
- **The validator incentive problem is unsolved in every ledger-based chain that does not issue a staking reward.** This problem has a known solution: pay validators on-chain, deterministically, from a protocol-controlled supply.
- **On-chain DEX/AMM liquidity and stablecoins are mature enough** to let a chain offer native swaps to USDC/USDT without depending on a centralized exchange.`,
  },
  {
    id: 'what-is',
    title: '3. What Falcon Ledger Is',
    body: `Falcon Ledger is a protocol, not a company product. It is a fork of the XRP Ledger with fundamental upgrades applied to the layers that XRP left broken:

| Layer | What Falcon Ledger Changes |
|-------|---------------------------|
| Supply | Protocol treasury replaces company wallet |
| Incentives | Validators earn rewards every epoch |
| Cryptography | Falcon-512 as the standard signature scheme for all keys and transactions |
| Governance | Bonded validator supermajority on-chain |
| Fees | Burn + validator split, no dead-end fee destruction |
| Liquidity | Built-in DEX/AMM for in-wallet qXRP↔USDC/USDT swaps |

The consensus model is unchanged. RPCA stays. Finality stays sub-second. Fees stay low. The economic and cryptographic layers are replaced entirely.`,
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

**Protocol (live):** Falcon-512 account creation, Falcon-signed transactions, validator register/bond/unbond, epoch emission, composite scoring, ClaimReward, double-sign slashing, and on-chain governance.

**Portal (live):** Passkey wallet, FALCON + F-USDC P2P (with QR scan), instant AMM swap, DEX limit orders, FALCON/F-USDC liquidity pool, Sepolia USDC ↔ F-USDC bridge (passkey EVM wallet), explorer, and validator onboarding. Full E2E test report: \`docs/TESTNET-E2E-REPORT.md\`.

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
    body: `This portal (falcon-ledger.com) provides a full testnet financial stack:

| Area | Features |
|------|----------|
| **Faucet** | Rate-limited FALCON drip for new wallets |
| **Wallet** | Passkey-secured Falcon-512 accounts; send/receive FALCON and F-USDC; QR scan; validator deploy one-liner |
| **Swap** | Instant AMM swap (FALCON ↔ F-USDC); DEX limit orders (crossing + post-only passive); live order book |
| **Pool** | Add/remove liquidity in the FALCON/F-USDC AMM; LP share and withdrawal estimates |
| **Bridge** | Sepolia USDC ↔ F-USDC via lock contract + relay; passkey Sepolia wallet; send ETH/USDC to any \`0x\` |
| **Explorer** | Ledger and transaction lookup |

**Asset labels:** F-USDC is the Falcon-ledger IOU (\`QUC\`). Sepolia USDC is the EVM ERC-20 used only in the Bridge tab. They are bridged, not interchangeable.

Mainnet target: swap qXRP validator rewards to USDC/USDT entirely on-chain without a centralized exchange.`,
  },
  {
    id: 'comparison',
    title: '9. Falcon Ledger vs XRP',
    body: `| | XRP | Falcon Ledger |
|--|-----|---------------|
| Supply control | Ripple controls ~40–44B (escrow + operational) | Protocol treasury, no private key |
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
    body: `### Completed — protocol
- Direct fork of XRPL reference implementation (replay-protected)
- Falcon-512 transaction signing — accounts, faucet, and wallet (verified end-to-end on testnet)
- Protocol treasury, epoch emission, halving schedule
- Validator register, bond, unbond, composite scoring, ClaimReward
- Double-sign slashing (100% bond)
- On-chain governance proposals and voting
- Drop conservation invariant
- Sustained testnet load (850k+ payments, 71+ hours, zero consensus stalls)

### Completed — portal (July 2026)
- Passkey wallet with client-side Falcon-512 signing and PWA install
- FALCON + F-USDC peer-to-peer transfers (QR scanner on send)
- Instant AMM swap and DEX limit orders (crossing default, post-only passive)
- FALCON/F-USDC liquidity pool (deposit, partial withdraw)
- Sepolia USDC ↔ F-USDC bridge (passkey EVM wallet, bridge in/out, send out)
- Comprehensive E2E test documentation (\`docs/TESTNET-E2E-REPORT.md\`)

### In progress (July 2026)
- Full Falcon validator consensus fleet upgrade (\`validation_falcon_secret\`, Falcon hex UNL)
- Latency scoring and additional slashing offenses
- Mainnet genesis validator set and production security audit
- Additional stablecoin pairs (USDT) and deeper testnet liquidity`,
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