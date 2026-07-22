/** Falcon Ledger whitepaper content — single source for /whitepaper */

import { LENDING_REPORT_SECTIONS } from '@/content/lending-report'

export const WHITEPAPER_VERSION = '2.6'
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
      'Pre-genesis E2E run (historical). Current issuer and ledger refs: docs/TESTNET-E2E-REPORT.md and public/config/testnet-stables.json.',
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
  {
    title: 'Lending Implementation Report',
    description:
      'Full lending implementation and coordinator E2E verification (July 2026): XLS-66 vault/broker/loan protocol, permissionless borrow/repay, HF liquidation via AMM price shock, HF monitor daemon, portal /lend APIs, tx hashes, and operations guide.',
    href: '/Docs/FALCON-LENDING-IMPLEMENTATION-REPORT.pdf',
    filename: 'FALCON-LENDING-IMPLEMENTATION-REPORT.pdf',
  },
]

export const WHITEPAPER_SECTIONS: { id: string; title: string; body: string }[] = [
  {
    id: 'summary',
    title: 'Executive Summary',
    body: `Falcon Ledger is a quantum-resistant payment protocol forked from the XRP Ledger. It keeps RPCA consensus and sub-second finality and replaces everything that made XRP a compromised bet: the company-controlled supply, the zero validator incentives, the company-gated grants and governance, and the classical cryptography that a quantum computer will eventually break.

**Falcon signatures, everywhere, from genesis.** Falcon-512 lattice signatures are the standard signature scheme for validator identities and all transactions, built in at the protocol level from genesis — not retrofitted later. Every wallet is created with Falcon keys, every transaction is signed and verified with Falcon. This chain is built to be secure in 2026 and in 2046.

**Fixed supply.** 200 billion qXRP. Hard cap. No exceptions. 98% of the supply is locked in a protocol treasury with no private key. It is released only by on-chain consensus rules — one epoch at a time, according to a declining CID emission schedule, to validators and lending/AMM liquidity providers who participate in the network. **Every bonded validator** who earns a composite score is paid a **percentage of the validator pot proportional to that score** (EMA-smoothed performance). Fees burn. The supply shrinks. No company can dump on you, and no foundation decides who gets a grant.

**No exchange required.** Falcon Ledger ships with a built-in DEX and AMM. The launch target is an in-wallet experience — faucet, wallet, and swaps — that lets a validator convert qXRP rewards to USDC and USDT on-chain from day one of mainnet, with no centralized exchange in the loop.

**Human names, still self-custody.** Optional on-ledger Account Names map a readable handle (e.g. \`alice.bob\`) to an \`r…\` address with a 100 qXRP bond — payments always settle to the cryptographic address.`,
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
| Incentives | Validators earn rewards every epoch (CID + fluid scoring) |
| Cryptography | Falcon-512 as the standard signature scheme for all keys and transactions |
| Governance | Bonded validator supermajority on-chain |
| Fees | Burn + validator split, no dead-end fee destruction |
| Liquidity | Built-in DEX/AMM for in-wallet qXRP↔USDC/USDT swaps |
| Identity UX | Optional Account Names (\`alice.bob\` → \`r…\`) with bonded claim |

The consensus model is unchanged. RPCA stays. Finality stays sub-second. Fees stay low. The economic and cryptographic layers are replaced entirely.`,
  },
  {
    id: 'testnet',
    title: 'Live Testnet (Network 1001)',
    body: `The public Falcon Ledger testnet runs today with Network ID **1001**.

| Item | Value |
|------|-------|
| Public RPC | \`http://46.224.0.140:6005\` |
| Fleet build | \`qxrp/xrpld:cid-popl\` @ \`ba4eb1093\` (6/6 validators) |
| Faucet | \`rwzhiWW4GYK2sQVR5Lw4iDpYLANB5krJXY\` — 2,000 FALCON per drip (rate-limited) |
| F-USDC issuer | \`rsJoDhjVV78jr6huHxKjtT8uG8RGeGmd1N\` (currency \`QUC\`) |
| Minimum validator bond | 1,000 FALCON |
| Epoch length | 172,800 ledgers (~7 days) — first reward epoch at ledger 172,800 |
| Validator quorum | 5 of 6 validators |

**Protocol (live / freeze-ready):** Falcon-512 account creation and transaction signing; Falcon validator consensus (\`validation_falcon_secret\`, Falcon hex UNL; classical \`node_seed\` banned); validator register/bond/unbond; CID epoch emission (first unlock epoch 8); **fluid composite scoring** (relative latency, EMA smooth; **all bonded paid ∝ score**); ClaimReward / ClaimLPReward; double-sign slashing; on-chain governance; AMM; **SingleAssetVault**, **LendingProtocol**, **LendingCollateral**, **LendingPermissionless**; **AccountNames** (\`NameSet\` / \`NameUnbond\` / \`NameRelease\`) on mainnet freeze pin.

**Portal (live):** Passkey wallet, FALCON + F-USDC P2P (QR scan), instant AMM swap, DEX limit orders, FALCON/F-USDC liquidity pool, Sepolia USDC ↔ F-USDC bridge (passkey EVM wallet; multi-sig lock proven on Sepolia 2-of-3; **F-USDC trust line required on Bridge tab before Bridge In**), **lending** (supply, borrow, repay, withdraw, claim rewards at \`/lend\`), explorer, rewards, and validator onboarding.

**Docs:** Current network parameters in \`public/config/testnet-stables.json\`. The bundled E2E PDF reflects a pre-genesis run; see \`docs/TESTNET-E2E-REPORT.md\` for the latest markdown report.`,
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
- **P2P overlay identity** — peer identity is Falcon (\`validation_falcon_secret\` by default, or optional separate \`node_falcon_secret\`). Classical \`node_seed\` is **disabled**; config refuses to start if present.

There is no hybrid mode for consensus, accounts, or peer identity — the protocol is Falcon-native for every security-critical path including P2P handshakes.

### 4.4 Design principles
- Quantum resistance is a protocol requirement, not an optional feature.
- Falcon is the only signing scheme for account, validator, and P2P identity.
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

**Emission (CID model):** Continuous Inflationary Decline — per-epoch rate declines smoothly (no multi-year halving steps). Year-1 average ≈ 12% of remaining treasury; year-5 ≈ 4.5%; long-term floor ≈ 1.5%/year (~3 bps per epoch). Bootstrap: epochs **1–7** schedule zero claimable emission; first unlock at **epoch 8**.

**PoPL split:** Validators, lending vault LPs, and AMM LPs share each epoch's emission. LP allocation is **participation-based** (distinct active providers add allocation, capped); **validators receive the remainder proportional to each bonded validator's composite score** (\`pay = pot × score / sum(scores)\`). Vault LP shares are proportional to MPT holdings.

**Fees:** 40%–70% burned; remainder to active validators. Burn fraction adjusts from on-chain treasury fill and fee volume signals.`,
  },
  {
    id: 'pop',
    title: '6. Proof of Participation',
    body: `Validators earn treasury emission proportional to a **fluid, smoothed** on-chain composite. Signals are independent and continuous — not a shared flat demerit.

\`\`\`
rawScore = (uptime×40 + voteAccuracy×30 + latency×15 + consistency×10) / 100
rawSlashed = rawScore × slashMultiplier / 10_000
composite = EMA(rawSlashed, previous)   // 35% new window / 65% history
\`\`\`

| Signal | Weight | Measurement (256-ledger window) |
|--------|--------|----------------------------------|
| Uptime | 40% | Presence: any trusted full validation / 256 |
| Vote accuracy | 30% | Correct (canonical-hash) votes / votes cast |
| Latency | 15% | Continuous vs **earliest correct signer** (−1 bps per 10 ms lag) |
| Consistency | 10% | Penalizes max consecutive absence streak |
| Slash multiplier | after blend | Multiplicative; then EMA with prior composite |

**Pay ∝ score (all bonded):** Every bonded validator is scored from observed full validations (including joiners not yet on the bootstrap UNL when their validations are relayed). There is **no top-K wipe** — composites stay on all bonds. Aggregate score is the sum of composites. Each epoch:

\`\`\`
your_share = validator_pot × your_composite / sum(all_composites)
\`\`\`

Better score → larger % of the pot; idle/low scores earn little or nothing below the floor. **UNL** (who closes ledgers) is separate from pay — bootstrap UNL is operator-published; open/rotating UNL is a future amendment.

- **Minimum bond:** 1,000 qXRP
- **Minimum score for rewards:** 5% composite (\`kMIN_COMPOSITE_SCORE_BPS\`)
- **Unbonding:** ~30 days (262,800 ledgers at mainnet cadence)
- **Claiming:** Pull-based via \`ClaimReward\` each epoch (pool hard-capped)
- **Cadence:** re-scored every flag interval (256 ledgers)

**Slashing (today):** Double-sign → 100% bond burn + forced unbond (pure burn path; re-proven on mainnet dress rehearsal). Absence and invalid-vote offenses are defined but return \`temDISABLED\` until detection is production-ready.

**Lending / AMM LPs:** Active vault and AMM providers count toward the PoPL participation basket and may claim via \`ClaimLPReward\` / \`ClaimAmmLpReward\` when allocated.`,
  },
  {
    id: 'names',
    title: '7. Account Names (Human Addresses)',
    body: `Falcon wallets remain \`r…\` AccountIDs under Falcon-512 keys. On top of that, the protocol supports optional **Account Names** — a bonded, on-ledger map from a human-readable name to an account.

| Rule | Value |
|------|-------|
| Bond | **100 qXRP** locked while the name is held |
| Ownership | **One** active or releasing name per account |
| Claim | \`NameSet\` — name free, account funded, no existing name |
| Release start | \`NameUnbond\` — status → releasing; name reserved to owner |
| Cooldown | **1 epoch** (172,800 ledgers on mainnet) after unbond |
| Finalize | \`NameRelease\` — bond returned, object deleted, name free |
| While releasing | Name-routed resolution **rejects**; raw \`r…\` payments still work |
| Format | Normalized lowercase ASCII (e.g. \`scott.reynolds\`, \`alice.bob\`) |

Duplicate claims and second names fail with \`tecDUPLICATE\`. Releasing before the cooldown fails with \`tecTOO_SOON\`. Payments always settle to AccountIDs — names are resolve-only UX, not a separate key system.

**Economics:** 100 qXRP opportunity cost while holding; unbonding frees the name after one epoch so squatters cannot lock handles forever without capital. Amendment: \`AccountNames\` (enabled on the mainnet freeze pin; private-net smoke 14/14 including NameSet/unbond).`,
  },
  {
    id: 'governance',
    title: '8. On-Chain Governance',
    body: `Bonded validators propose parameter changes via \`GovernanceProposal\`. Voting runs 7 days; each vote is weighted by composite score at submission. Passing requires >67% of aggregate score. Governable parameters include fee burn fraction within 40%–70% bounds. Supply cap, treasury lock, and RPCA rules are immutable.`,
  },
  {
    id: 'liquidity',
    title: '9. Faucet, Wallet, and Built-In Liquidity',
    body: `This portal (falcon-ledger.com) provides a full testnet financial stack:

| Area | Features |
|------|----------|
| **Faucet** | Rate-limited FALCON drip for new wallets |
| **Wallet** | Passkey-secured Falcon-512 accounts; send/receive FALCON and F-USDC; QR scan; validator deploy one-liner |
| **Swap** | Instant AMM swap (FALCON ↔ F-USDC); DEX limit orders (crossing + post-only passive); live order book |
| **Pool** | Add/remove liquidity in the FALCON/F-USDC AMM; LP share and withdrawal estimates |
| **Bridge** | Sepolia USDC ↔ F-USDC via lock contract + relay; passkey Sepolia wallet; **trust line step on Bridge tab**; send ETH/USDC to any \`0x\` |
| **Lend** | Live at \`/lend\`: \`VaultDeposit\`, permissionless \`LoanSet\` (FALCON collateral, 150% HF, 1–52 PoPL epochs), \`LoanCollateralDeposit\`, \`LoanPay\`, \`VaultWithdraw\`, \`ClaimLPReward\`; \`LoanManage\` liquidation; LP yield via F-USDC interest + FALCON epoch emissions |
| **Explorer** | Ledger and transaction lookup |

**Asset labels:** F-USDC is the Falcon-ledger IOU (\`QUC\` from issuer \`rsJoDhj…\`). Sepolia USDC is the EVM ERC-20 used only in the Bridge tab. They are bridged, not interchangeable.

Mainnet target: swap qXRP validator rewards to USDC/USDT entirely on-chain without a centralized exchange.`,
  },
  {
    id: 'comparison',
    title: '10. Falcon Ledger vs XRP',
    body: `| | XRP | Falcon Ledger |
|--|-----|---------------|
| Supply control | Ripple controls ~40–44B (escrow + operational) | Protocol treasury, no private key |
| Validator rewards | None | Paid every epoch on-chain |
| Scoring | N/A | Fluid EMA; all bonded paid ∝ score |
| Transaction crypto | ed25519/secp256k1 | Falcon-512 |
| Validator consensus crypto | ed25519/secp256k1 | Falcon-512 |
| P2P identity | Classical seeds | Falcon-only (\`node_seed\` banned) |
| Human addresses | None | Optional Account Names (100 qXRP bond) |
| Lending / vault LPs | None | Participation-based LP emission share |
| Escrow unlocks | Monthly Ripple releases | None — CID protocol emission only |
| Governance | Off-chain / company-led | On-chain bonded supermajority |
| Fee model | Burned only | Burn + validator share |
| Slashing | None | Cryptographic proof on-chain |`,
  },
  {
    id: 'milestones',
    title: '11. Milestones',
    body: `### Completed — protocol
- Direct fork of XRPL reference implementation (replay-protected)
- Falcon-512 for accounts, consensus, and P2P (\`node_seed\` banned)
- Protocol treasury, CID epoch emission (first unlock epoch 8), PoPL LP/AMM split
- Fluid composite scoring: relative latency, EMA (35/65); all bonded paid ∝ score
- Validator register, bond, unbond, ClaimReward / ClaimLPReward / ClaimAmmLpReward
- Double-sign slashing (100% bond pure burn; re-proven on dress rehearsal)
- Account Names — \`NameSet\` / \`NameUnbond\` / \`NameRelease\` (freeze-pin smoke PASS)
- On-chain governance proposals and voting
- AMM + SingleAssetVault + LendingProtocol (permissionless path)
- USDC bridge multi-sig lock — Sepolia 2-of-3 e2e PASS; ETH mainnet redeploy pending
- Drop conservation invariant; sustained testnet load (850k+ payments, 71+ hours)
- Mainnet protocol freeze pin \`mainnet-v1\` @ \`1789d2fb4\` (private-net smoke 14/14)

### Completed — portal (July 2026)
- Passkey wallet with client-side Falcon-512 signing and PWA install
- FALCON + F-USDC peer-to-peer transfers (QR scanner on send)
- Instant AMM swap and DEX limit orders (crossing default, post-only passive)
- FALCON/F-USDC liquidity pool (deposit, partial withdraw)
- Sepolia USDC ↔ F-USDC bridge (passkey EVM wallet, trust-line gate, bridge in/out, send out)
- Lending live: \`SingleAssetVault\` + \`LendingProtocol\` + \`LendingCollateral\` + \`LendingPermissionless\`; full \`/lend\` supply/borrow/repay/claim/liquidation; duration picker + \`LoanCollateralDeposit\`; multi-loan Positions (see lending sections below)
- Coordinator lending E2E verified: borrow/repay, add collateral, HF liquidation (\`FALCON-LENDING-IMPLEMENTATION-REPORT.pdf\`)
- Full Falcon validator consensus fleet (\`validation_falcon_secret\`, Falcon hex UNL)
- Comprehensive E2E test documentation (\`docs/TESTNET-E2E-REPORT.md\`)

### In progress (July 2026)
- Portal Account Names UX (claim / release / send-by-name)
- Live APY from epoch emission data in lend overview
- Absence / invalid-vote slashing enablement (still \`temDISABLED\`)
- Mainnet ceremony: registry image digest, genesis keys, network id **1026** go-live
- ETH mainnet multi-sig lock with cold owners (Circle USDC)
- Additional stablecoin pairs (USDT) and deeper liquidity
- External audit of freeze scope`,
  },
  {
    id: 'technical',
    title: '12. Technical Summary',
    body: `| Component | Detail |
|-----------|--------|
| Chain name | Falcon Ledger |
| Token | qXRP |
| Testnet network ID | 1001 |
| Mainnet network ID | 1026 (ceremony pack) |
| Consensus | RPCA (XRP Ledger) |
| Account / tx signatures | Falcon-512 |
| Validator / P2P signatures | Falcon-512 (\`node_seed\` refused) |
| Total supply | 200,000,000,000 qXRP |
| Treasury | 196B qXRP (98%), no private key |
| Emission | CID continuous decline; first unlock epoch 8 |
| Scoring | Fluid EMA (35/65); all bonded paid ∝ score; relative latency |
| Min validator bond | 1,000 qXRP |
| Account name bond | 100 qXRP; 1/account; 1-epoch release cooldown |
| Governance threshold | 67% aggregate composite score |
| Freeze pin | \`qxrp/xrpld:mainnet-v1\` @ \`1789d2fb4\` |
| liboqs pin | v0.12.0 (\`f4b96220…\`) |`,
  },
  ...LENDING_REPORT_SECTIONS,
]