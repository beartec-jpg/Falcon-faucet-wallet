/** Falcon PL white paper — content for /whitepaper (v4.1, August 2026) */

export const WHITEPAPER_VERSION = '4.1'
export const WHITEPAPER_DATE = 'August 2026'

export interface WhitepaperDownload {
  title: string
  description: string
  href: string
  filename: string
  format?: string
}

/** PDFs live in repo Docs/ — served from public/Docs/. */
export const WHITEPAPER_DOWNLOADS: WhitepaperDownload[] = [
  {
    title: 'Falcon PL — Implementation read-up',
    description:
      'Start-to-finish: DAG diversion, Falcon Consensus, 2200 soak (lag ≠ fork), 2300 beta, 500 vs 30 TPS.',
    href: '/Docs/FALCON-PL-IMPLEMENTATION-READUP.md',
    filename: 'FALCON-PL-IMPLEMENTATION-READUP.md',
    format: 'MD',
  },
  {
    title: 'Testnet E2E Report',
    description: 'End-to-end verification notes for the Falcon testnet stack.',
    href: '/Docs/FALCON-TESTNET-E2E-REPORT.pdf',
    filename: 'FALCON-TESTNET-E2E-REPORT.pdf',
  },
  {
    title: 'Security Report — Wallet',
    description: 'Passkey wallet: send, receive, backup, and restore.',
    href: '/Docs/FALCON-SECURITY-REPORT-wallet-send-receive-backup-restore.pdf',
    filename: 'FALCON-SECURITY-REPORT-wallet-send-receive-backup-restore.pdf',
  },
  {
    title: 'Security Report — Bridge, Pool, AMM & Orders',
    description: 'Bridge, AMM, swap, and limit-order security review.',
    href: '/Docs/FALCON-SECURITY-REPORT-bridge-pool-amm-swap-orders.pdf',
    filename: 'FALCON-SECURITY-REPORT-bridge-pool-amm-swap-orders.pdf',
  },
  {
    title: 'Lending Implementation Report',
    description: 'Vault, borrow/repay, collateral, and liquidation E2E (July 2026).',
    href: '/Docs/FALCON-LENDING-IMPLEMENTATION-REPORT.pdf',
    filename: 'FALCON-LENDING-IMPLEMENTATION-REPORT.pdf',
  },
  {
    title: 'Vault & Cold Signer Report',
    description: 'Air-gapped vault custody and multi-part QR cold signing.',
    href: '/Docs/FALCON-VAULT-COLD-SIGNER-IMPLEMENTATION-REPORT.pdf',
    filename: 'FALCON-VAULT-COLD-SIGNER-IMPLEMENTATION-REPORT.pdf',
  },
  {
    title: 'Multi-Chain Wallet & Bridge Report',
    description: 'Falcon, Bitcoin, Ethereum, and BNB wallets and lock-mint bridges.',
    href: '/Docs/FALCON-MULTICHAIN-WALLET-BRIDGE-REPORT.pdf',
    filename: 'FALCON-MULTICHAIN-WALLET-BRIDGE-REPORT.pdf',
  },
]

export type WhitepaperBlock =
  | { type: 'p'; text: string }
  | { type: 'lead'; text: string }
  | { type: 'bullets'; items: string[] }
  | { type: 'callout'; title?: string; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'stats'; items: { label: string; value: string }[] }
  | { type: 'code'; text: string }

export interface WhitepaperSection {
  id: string
  number?: string
  title: string
  blocks: WhitepaperBlock[]
}

/**
 * Structured white paper body.
 * Vision: FPL is the centre of a participation ledger — Falcon Consensus +
 * Falcon-512 — with a keyless treasury and PoPL economics.
 */
export const WHITEPAPER_SECTIONS: WhitepaperSection[] = [
  {
    id: 'abstract',
    title: 'Abstract',
    blocks: [
      {
        type: 'lead',
        text: 'Falcon PL is a quantum-safe **participation ledger**. One token — **FPL** — coordinates security, liquidity, collateral, and rewards. Settlement is an ordered hash-linked ledger: one parent, one height, one hash. Agreement is **Falcon Consensus**. Signatures are **Falcon-512** from the first block.',
      },
      {
        type: 'p',
        text: 'We left a Narwhal-style DAG research line because a wallet needs one tip, not two layers of certificates. The economic design is a 200B hard cap, 98% keyless treasury, CID-style epoch emission, and Proof of Participation & Liquidity. The engine is new. Bonded seats join a packer lottery, seal non-empty ledgers, and everyone verifies. An earlier Falcon testnet hit an intake wall near **30 tx/s**. Falcon PL kept up through **500 tx/s** on the same signature family — **16.7×**, or **+1,567%**.',
      },
    ],
  },
  {
    id: 'vision',
    number: '1',
    title: 'Vision: FPL at the centre',
    blocks: [
      {
        type: 'p',
        text: 'Most chains treat participation as a side quest: a bridge here, a wrapper there, validators unpaid. Falcon PL treats participation as the product. **FPL** is the unit that measures who packed, who checked, who provided liquidity, who watched a rail, and who may claim at epoch payday.',
      },
      {
        type: 'callout',
        title: 'Why not a DAG',
        text: 'The first research line here was a Narwhal-style certificate DAG. It was archived. A wallet and a faucet need one tip hash, not two layers of certificates. Falcon PL is an ordered ledger: one parent, one height, one hash.',
      },
      {
        type: 'stats',
        items: [
          { label: 'Product', value: 'Falcon PL' },
          { label: 'Token', value: 'FPL' },
          { label: 'Agreement', value: 'Falcon Consensus' },
          { label: 'Crypto', value: 'Falcon-512' },
        ],
      },
      {
        type: 'p',
        text: 'Native FPL sits alongside bridged representations from connected rails — BTC, ETH, BNB, and later corridors — for pools, lending, and settlement. Hold, swap, provide liquidity, and borrow under one product surface.',
      },
    ],
  },
  {
    id: 'problem',
    number: '2',
    title: 'The problem we solve',
    blocks: [
      {
        type: 'bullets',
        items: [
          'Fragmented liquidity — capital trapped on separate chains and apps.',
          'Company-controlled supply on many “fast” ledgers, with large escrow overhangs.',
          'Validators unpaid on several high-speed networks, so security depends on goodwill.',
          'Classical signatures that will not age well against quantum-capable attackers.',
          'A research DAG that could not give operators a single tip to point at.',
          'An earlier Falcon testnet that hit an intake wall near 30 tx/s (HTTP 503 / fee escalate).',
        ],
      },
      {
        type: 'p',
        text: 'Falcon PL addresses these together: a keyless majority treasury, on-chain rewards for real participation, Falcon-512 on every security-critical path, native AMM and lending, and an ordered ledger that kept up through 500 tx/s in the August 2026 load campaign.',
      },
    ],
  },
  {
    id: 'architecture',
    number: '3',
    title: 'Architecture overview',
    blocks: [
      {
        type: 'lead',
        text: 'Falcon Consensus is the agreement protocol of this chain. Bonded seats, a packer lottery, committee quorum, and skip failover — purpose-built for Falcon-512 and a single tip. It is not a familiar fork of another ledger.',
      },
      {
        type: 'table',
        headers: ['Layer', 'Role'],
        rows: [
          ['Settlement', 'Ordered hash-linked ledgers — one parent, one height, one hash'],
          ['Falcon Consensus', 'Bond lottery elects a packer; everyone verifies; 4-of-6 committee commit'],
          ['Liveness', 'Silent packer is skipped; no empty seals; double-sign is slash and jail'],
          ['Security', 'Falcon-512 for txs, votes, and seals (no classical signing paths)'],
          ['Supply', '200B hard cap · 98% keyless treasury · 2% public bootstrap'],
          ['Incentives', 'PoPL — validators, watchers, AMM LPs, and lend LPs paid by epoch'],
          ['Markets', 'Built-in AMM, collateralised lending & borrowing'],
          ['Rails', 'Hardcoded SPV-style corridors (BTC first); work is on-chain, not self-credit'],
        ],
      },
      {
        type: 'p',
        text: 'Bonded, non-jailed seats form the lottery. Each height elects ranked packers. The winner seals a **non-empty** ledger under a time budget. Soft and hard OK advance the tip. A silent packer is skipped so the next rank can seal. Two different hashes at one height from one packer is slash and jail.',
      },
      {
        type: 'code',
        text: 'bond → lottery → pack (no empty seals) → Falcon-512 verify → soft/hard OK → tip',
      },
      {
        type: 'callout',
        title: 'What this is',
        text: 'Falcon Consensus sits in the bonded-committee family: stake seats the lottery, a quorum commits the block, post-quantum signatures bind every vote and seal. Proof of Participation & Liquidity is the **reward** layer — who gets paid at epoch — not the agreement algorithm.',
      },
    ],
  },
  {
    id: 'throughput',
    number: '4',
    title: 'Throughput vs the earlier Falcon testnet',
    blocks: [
      {
        type: 'lead',
        text: 'Same Falcon-512 family. Different engine. The old ~30 tx/s figure was an API wall on an earlier Falcon testnet, not a law of the signatures.',
      },
      {
        type: 'stats',
        items: [
          { label: 'Old wall', value: '~30 TPS' },
          { label: 'PL keep-up', value: '500 TPS' },
          { label: 'Multiple', value: '16.7×' },
          { label: 'Above 30', value: '+1,567%' },
        ],
      },
      {
        type: 'table',
        headers: ['Run', 'Result', 'vs 30 TPS'],
        rows: [
          ['Earlier Falcon testnet (May 2026)', '~30 TPS then HTTP 503 / fee escalate; ~3–3.5 s close', 'Baseline'],
          ['PL endurance ~4.3 h', '20→50→80→150 tx/s, ~885k submit / 0 err', '5× at the 150 spike (+400%)'],
          ['PL break ramp', 'Clean keep-up 200–500 TPS', '6.7×–16.7× (+567% to +1,567%)'],
          ['PL soft wall', '600–800 TPS lag / backlog, still sealing', '20–27×'],
          ['PL hard wall', '~900 TPS host OOM (RAM), not a fork', 'Resource limit'],
          ['11-val private soak (2200)', '25 TPS by choice — agree + catch-up, not a max', 'Chosen soak'],
        ],
      },
      {
        type: 'callout',
        title: 'Do not quote 640 TPS',
        text: 'A full 128-tx ledger every 0.2 s would be 640 TPS if QC stayed instant. That is an envelope, not a measurement. We measured 500 TPS keep-up. The 11-val soak at 25 TPS proved multi-host agree under Falcon-512, not the ceiling.',
      },
      {
        type: 'p',
        text: 'After the 2.9 fork-class fixes, the long private soak did not split history. Core seats stayed on one tip and one hash. What looked like breakage was validators too slow on small iron, join-snap holes we closed, and a dead seat still winning the lottery. That is catch-up and liveness — not two chains.',
      },
    ],
  },
  {
    id: 'multichain',
    number: '5',
    title: 'Rails, lending & liquidity',
    blocks: [
      {
        type: 'lead',
        text: 'FPL coordinates a lending and liquidity network that can grow onto hardcoded rails — BTC first — without a federated mint authority as the end state.',
      },
      {
        type: 'p',
        text: 'Value enters through protocol rail headers and deposits (lock on the source chain, mint a represented asset on Falcon PL). Once on the ledger, capital can sit in pools, supply lending markets, serve as collateral, or trade against FPL and stables — under rules anyone can inspect.',
      },
      {
        type: 'table',
        headers: ['Rail', 'Role on the network'],
        rows: [
          ['Falcon PL', 'Settlement hub · FPL · lending · AMM · rewards'],
          ['Bitcoin', 'Primary SPV-style rail into wrapped BTC markets'],
          ['Ethereum', 'ETH corridor (same proof shape)'],
          ['BNB', 'BNB corridor (same proof shape)'],
        ],
      },
      {
        type: 'p',
        text: 'Public mint of native FPL is epoch settlement only. A signed `CreditAsset` cannot inflate FPL on a locked public wire. Watcher pay is `work × presence`. Heartbeats fill presence slots. Work is an accepted rail header or deposit — not a self-written credit.',
      },
    ],
  },
  {
    id: 'token',
    number: '6',
    title: 'The FPL token',
    blocks: [
      {
        type: 'stats',
        items: [
          { label: 'Hard cap', value: '200B' },
          { label: 'Protocol treasury', value: '98%' },
          { label: 'Public bootstrap', value: '2%' },
          { label: 'Emission', value: 'CID epochs' },
        ],
      },
      {
        type: 'table',
        headers: ['Allocation', 'Share', 'Purpose'],
        rows: [
          ['Keyless protocol treasury', '98%', 'Epoch emission to validators, watchers, and LPs only'],
          ['Community airdrop', '1%', 'Public launch distribution'],
          ['Faucet', '0.5%', 'Onboarding and testing'],
          ['Builder pot', '0.5%', 'Core work, audits, growth contributions'],
        ],
      },
      {
        type: 'p',
        text: 'Emission follows Continuous Inflationary Decline (CID): a declining share of remaining treasury (first claimable epoch 30 bps). On public parameters the epoch is **7 days**. Epochs 1–7 emit nothing so the mesh can stabilise. Fees burn 50%; the remainder enters the validator pot. AMM and lend each take 20% of epoch emit; watchers 5%; validators 55% plus unfilled remainder.',
      },
      {
        type: 'p',
        text: 'FPL is not only a fee token. It is the unit that scores participation, aligns long-term security with market activity, and anchors rail liquidity into one economic system.',
      },
    ],
  },
  {
    id: 'popl',
    number: '7',
    title: 'Proof of Participation & Liquidity',
    blocks: [
      {
        type: 'p',
        text: 'PoPL pays the people who make the network useful: validators who pack and check, watchers who do verifiable rail work, and liquidity providers who keep markets and lending viable.',
      },
      {
        type: 'bullets',
        items: [
          'Validators: bonded seats. Pack work and check work split the validator pot evenly.',
          'No empty seals — no farming tip spam. No fees and no qualifying work means zero claims.',
          'Watchers: weight = work × (slots / 168). A tab with no rail work still pays zero.',
          'Liquidity providers: AMM and lend LPs, 0.5% cap per account; unfilled remainder → validator pot.',
          'Minimum bond 1,000 FPL and a 14-day unbond on public parameters.',
        ],
      },
      {
        type: 'code',
        text: 'weight_i = work_i × slots_i / 168\npay_i    = min(cap, pot × weight_i / Σ weight)',
      },
      {
        type: 'p',
        text: 'Double-signing is slashable. The goal is simple: real participation, real rewards, accountable security.',
      },
    ],
  },
  {
    id: 'security',
    number: '8',
    title: 'Quantum security',
    blocks: [
      {
        type: 'p',
        text: 'Classical signatures such as ECDSA and Ed25519 will not remain adequate for multi-decade financial infrastructure. Falcon PL uses Falcon-512 lattice signatures for account transactions, consensus votes, and ledger seals — from genesis, not as a later migration.',
      },
      {
        type: 'bullets',
        items: [
          'NIST-aligned post-quantum design (Falcon family).',
          'No classical signing paths for accounts, consensus, or peer identity.',
          'Local, deterministic verification — no external signing service.',
          'Public binaries refuse hmac-dev unless `--allow-dev-crypto`.',
        ],
      },
    ],
  },
  {
    id: 'product',
    number: '9',
    title: 'What you can use today',
    blocks: [
      {
        type: 'p',
        text: 'The portal is one surface. Pre-public beta **2300** is the Falcon PL mesh — the chain this paper describes.',
      },
      {
        type: 'table',
        headers: ['Surface', 'What it does'],
        rows: [
          ['Falcon PL 2300', '5-val multi-host beta · 7-day epoch · Falcon Consensus 2.9.30'],
          ['Faucet', 'Testnet FPL drip · watcher start / real test (2300)'],
          ['Wallet', 'Passkey accounts; multi-chain keys; send/receive'],
          ['Bridge / swap / lend', 'Portal markets — bridged assets and vaults on the product surface'],
          ['Explorer / arcade', 'Ledgers, participation, community'],
        ],
      },
      {
        type: 'callout',
        title: 'Pre-public beta',
        text: '2300 assets have no cash value. Epochs 1–7 emit nothing. Watcher payday waits for epoch 8. This is not mainnet and not a published BFT theorem. Mainnet follows ceremony, audits, and freeze discipline.',
      },
    ],
  },
  {
    id: 'governance',
    number: '10',
    title: 'Governance & immutables',
    blocks: [
      {
        type: 'p',
        text: 'Bonded validators can propose bounded parameter changes. Hard rules — supply cap, keyless treasury, and core consensus safety — are not available for casual amendment. Class B money-rule changes take an amendment and notice of at least one epoch.',
      },
      {
        type: 'p',
        text: 'Network 2200 is the retired private soak (never flipped public). Network **2300** is the pre-public beta genesis — the only live Falcon PL chain.',
      },
    ],
  },
  {
    id: 'roadmap',
    number: '11',
    title: 'Roadmap principles',
    blocks: [
      {
        type: 'bullets',
        items: [
          'Keep 2300 soaking multi-host; prove skip of a dead packer on this genesis.',
          'Point pay and claim in the wallet at 2300 Falcon-512, not only the watcher overlay.',
          'Real BTC header verification before calling rails custodialess in public.',
          'External audit of freeze scope, bridges, and lending risk.',
          'Mainnet ceremony with published genesis, freeze pin, and transparent bootstrap wallets.',
        ],
      },
      {
        type: 'p',
        text: 'The north star does not change: FPL as the centre of a participation ledger — quantum-safe, keyless treasury, rewards for people who actually pack, check, watch, and provide liquidity.',
      },
    ],
  },
  {
    id: 'summary-table',
    number: '12',
    title: 'At a glance',
    blocks: [
      {
        type: 'table',
        headers: ['Item', 'Detail'],
        rows: [
          ['Chain', 'Falcon PL (Falcon Participation Ledger)'],
          ['Token', 'FPL (protocol unit; hard-capped supply)'],
          ['Consensus', 'Falcon Consensus — lottery packer, 4-of-6 commit'],
          ['Signatures', 'Falcon-512 (txs, votes, seals)'],
          ['Supply', '200B hard cap · 98% keyless treasury · 2% bootstrap'],
          ['Rewards', 'PoPL — validators, watchers, AMM and lend LPs'],
          ['Markets', 'AMM · collateralised lending · hardcoded rails'],
          ['Private soak', '2200 (stopped; never public)'],
          ['Pre-public beta', '2300 · 7-day epoch · first claim at epoch 8'],
          ['vs old 30 TPS wall', '500 TPS keep-up · 16.7× · +1,567%'],
        ],
      },
    ],
  },
]
