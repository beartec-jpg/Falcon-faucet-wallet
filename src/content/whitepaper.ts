// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
/** Falcon PL white paper — technical system paper for /whitepaper (v5.0) */

export const WHITEPAPER_VERSION = '5.2'
export const WHITEPAPER_DATE = '3 November 2026'

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
    title: 'Falcon PL — Implementation notes',
    description: 'Engineering companion: measured throughput, soak history, and operator runbooks.',
    href: '/Docs/FALCON-PL-IMPLEMENTATION-READUP.md',
    filename: 'FALCON-PL-IMPLEMENTATION-READUP.md',
    format: 'MD',
  },
  {
    title: 'Historical (1001) — Testnet E2E Report',
    description: 'Falcon Ledger 1001 lock-mint stack. Not 2300 dest-lock.',
    href: '/Docs/FALCON-TESTNET-E2E-REPORT.pdf',
    filename: 'FALCON-TESTNET-E2E-REPORT.pdf',
  },
  {
    title: 'Historical (1001) — Security Report — Wallet',
    description: 'Passkey wallet on the 1001 fork. Not 2300 dest-lock.',
    href: '/Docs/FALCON-SECURITY-REPORT-wallet-send-receive-backup-restore.pdf',
    filename: 'FALCON-SECURITY-REPORT-wallet-send-receive-backup-restore.pdf',
  },
  {
    title: 'Historical (1001) — Security Report — Bridge, Pool, AMM & Orders',
    description: 'Custodial lock-mint bridge on 1001. Not FalconBridge dest-lock.',
    href: '/Docs/FALCON-SECURITY-REPORT-bridge-pool-amm-swap-orders.pdf',
    filename: 'FALCON-SECURITY-REPORT-bridge-pool-amm-swap-orders.pdf',
  },
  {
    title: 'Historical (1001) — Lending Implementation Report',
    description: '1001 lending E2E.',
    href: '/Docs/FALCON-LENDING-IMPLEMENTATION-REPORT.pdf',
    filename: 'FALCON-LENDING-IMPLEMENTATION-REPORT.pdf',
  },
  {
    title: 'Historical (1001) — Vault & Cold Signer Report',
    description: '1001 vault / cold signer.',
    href: '/Docs/FALCON-VAULT-COLD-SIGNER-IMPLEMENTATION-REPORT.pdf',
    filename: 'FALCON-VAULT-COLD-SIGNER-IMPLEMENTATION-REPORT.pdf',
  },
  {
    title: 'Historical (1001) — Multi-Chain Wallet & Bridge Report',
    description: '1001 lock-mint multi-chain. Not FROST / Groth16 dest-lock.',
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
 * Technical system paper. Describes the machine: model, ledger, consensus,
 * validator lifecycle, cryptography, incentives, markets, and attack surfaces.
 * Changelog and soak notes belong in the implementation appendix, not here.
 */
export const WHITEPAPER_SECTIONS: WhitepaperSection[] = [
  {
    id: 'abstract',
    title: 'Abstract',
    blocks: [
      {
        type: 'lead',
        text: 'Falcon PL is a quantum-safe **participation ledger**. Settlement is a single hash-linked chain: one parent, one height, one hash. **Falcon Consensus** elects a packer from bonded seats, requires a 4-of-6 committee certificate to commit, and passes a silent packer’s turn to the next committee seat so the height can still close. Every transaction, vote, and seal is **Falcon-512**. The native unit **FPL** pays security, liquidity, collateral, and rail work under one set of rules.',
      },
      {
        type: 'p',
        text: 'This paper specifies the system. It covers the ledger and roles, the agreement protocol, how a validator joins and leaves, the cryptographic binding, the supply and epoch economy, native markets and rails, and the attack surfaces those pieces create — with the defence that sits on each one. It is a description of the protocol, not a changelog.',
      },
    ],
  },
  {
    id: 'introduction',
    number: '1',
    title: 'Introduction',
    blocks: [
      {
        type: 'p',
        text: 'A ledger that people will still trust in twenty years has to settle one history, pay the people who actually run it, and survive a world where classical signatures fail. Many fast chains leave validators unpaid, park most of the supply with a company, or plan to “add post-quantum later.” A certificate DAG can gossip well and still fail the operator test: there is no single tip a wallet can name.',
      },
      {
        type: 'p',
        text: 'Falcon PL takes the other shape. The chain is ordered. Participation is the product. **FPL** is the unit that measures who packed, who checked, who provided liquidity, who watched a rail, and who may claim at epoch payday. Signatures are Falcon-512 from height 1. Ninety-eight percent of supply sits in a keyless protocol treasury and leaves only through published emission rules.',
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
        type: 'callout',
        title: 'Names',
        text: '**Falcon-512** is the signature scheme. **Falcon Consensus** is the agreement protocol. **Falcon PL** is the chain. Proof of Participation & Liquidity (PoPL) is the **reward** layer — who is paid at epoch — not the algorithm that chooses the next ledger.',
      },
    ],
  },
  {
    id: 'model',
    number: '2',
    title: 'System model',
    blocks: [
      {
        type: 'p',
        text: 'Honest seats share one parent hash, one height, and one state root. Time is loosely synchronised: pack and progress timeouts are wall-clock, but the lottery seed is the committed tip, not a clock. The public wire is a persistent peer mesh. Admin mutations do not travel on that wire.',
      },
      {
        type: 'table',
        headers: ['Role', 'Job', 'History kept'],
        rows: [
          ['Validator', 'Pack when elected, vote on every height, refuse to pack while lagging', 'Last 128 ledgers'],
          ['Hub', 'Gossip bodies, votes, and catch-up; do not invent history', 'Recent tail'],
          ['Archive', 'Serve join snapshots and residual history', 'Long tail (up to the chain cap)'],
        ],
      },
      {
        type: 'p',
        text: 'A seat is eligible for the lottery only if it is bonded, not jailed, and not benched as inactive (20 missed own turns; 2300 from height 420,000). A fresh mesh pong is permission to pack, not a lottery filter. Bond is a slash target and the entry ticket; from height 420,000 on 2300 every eligible seat has equal lottery odds. It is not an interest rate. The committee at each height is six frozen seats: one packer and five checkers. A ledger becomes *the* ledger when **four of those six** have signed it. Confirmation beyond that is a separate hard quorum of the bonded set and does not replace the certificate.',
      },
      {
        type: 'bullets',
        items: [
          'Adversary: any number of unbonded peers, plus a minority of bonded stake that may go silent, lie, or double-sign.',
          'Network: partial synchrony for liveness (progress timeout). Safety does not wait on a clock — it waits on a 4-of-6 certificate.',
          'Crypto: every security-critical object is Falcon-512. There is no classical signing path for accounts, votes, or seals.',
          'This paper describes the protocol as implemented. It is not a published BFT theorem.',
        ],
      },
    ],
  },
  {
    id: 'ledger',
    number: '3',
    title: 'Ledger and state',
    blocks: [
      {
        type: 'p',
        text: 'State is an account map plus protocol objects (bonds, epoch pots, pools, loans, rail tips). A ledger is a signed body of transactions that takes one state root to the next. Height increases by one. The parent hash is the previous body hash. The next header carries the parent’s 4-of-6 certificate, so uniqueness is on the chain, not only in peer memory.',
      },
      {
        type: 'code',
        text: 'ledger_n+1.parent      = hash(ledger_n)\nledger_n+1.parent_cert = QC_4of6(ledger_n)\nledger_n+1.state_root  = apply(state_n, txs)',
      },
      {
        type: 'p',
        text: 'Transactions are sequenced per account. The mempool is gossiped and size-capped (50,000 by default), kept in arrival order, and holds at most 64 pending transactions per account (sequence window 64). A transaction that fails permanently at pack is evicted and its id refused for 6 hours at the same tip; 2.10.4 adds disallowed sends to that class. An idle chain does not seal. Before height 755,000 empty bodies were rejected; from 755,000 (2.10.0) a packer that has just evicted permanently failing transactions and has nothing applicable may seal an empty fallback block so the height closes. Fees escalate with mempool utilisation (1× / 2× / 4× / 8× / 16× the base minimum at 25 / 50 / 75 / 90% full). From height 420,000 on 2300, 50% of each fee is burned, 30% goes to the proposer, and 20% enters the validator pot at epoch settle.',
      },
      {
        type: 'table',
        headers: ['Object', 'Rule'],
        rows: [
          ['Accounts', 'Falcon-512 identity; sequence number; multi-asset balances'],
          ['Bond', 'On-chain lock; genesis seats 1,000 FPL; new seats need ApproveValidator admission and ≥ 50,000 FPL (2300, from 420,000); 14-day unbond'],
          ['Mempool', 'Capped (50,000); reject when full; arrival order; ≤ 64 pending per account; permanent failures evicted; fee tier from utilisation'],
          ['Ledger cap', 'Packer-side, not a verify rule: `--max-txs` (128 on the core seats; 0 in the public profile = 400 safety cap) and a ~1 MB body budget; pack budget 1,000 ms'],
          ['Header time', '`sealed_at` ≥ parent and ≤ parent + 60 s; from 420,000 a checker also refuses a stamp > 5 s ahead of its clock (a 1 s step is always allowed)'],
          ['Public mint', 'Epoch settlement only — not a user transaction'],
        ],
      },
    ],
  },
  {
    id: 'consensus',
    number: '4',
    title: 'Falcon Consensus',
    blocks: [
      {
        type: 'lead',
        text: 'Falcon Consensus is a bonded-committee protocol. Stake seats a deterministic lottery. A small frozen committee commits the block. A 4-of-6 round change passes a silent packer’s turn to the next seat. Post-quantum signatures bind every vote and seal.',
      },
      {
        type: 'p',
        text: 'At each height the eligible set is the bonded, non-jailed seats. The lottery seed is a hash of network id, height, committed tip seed, previous packer, and the eligible set (id and bond). Integer reduction ranks packers: weighted by bond before height 420,000 on 2300, equal weight from 420,000. Honest nodes that share a tip compute the same ranking. Mesh pongs are pack **permission**, not election: an offline seat stays in the draw until it is benched as inactive, and its round is passed by view-change.',
      },
      {
        type: 'code',
        text: 'eligible = bonded ∧ ¬jailed\nseed     = H(network_id ‖ height ‖ tip_hash ‖ skips ‖ eligible)\nrank     = lottery(seed, weights)        # same tip ⇒ same #1, #2, …\ncommittee = freeze(first 6 of rank)      # frozen at tip commit\nproposer = committee[round mod 6]\ncommit   = 4 distinct committee signatures in one round\nround++  = 4-of-6 ViewChange after round timeout',
      },
      {
        type: 'p',
        text: 'The round’s proposer packs applicable mempool transactions under a 1,000 ms budget and proposes a body. In round 0 it waits until 2.5 s after the height opened (`--min-block-interval-ms 2500`, capped at one live pack window of 3.3 s) unless its mempool already holds a full block; later rounds do not wait. Every full node verifies parent, height, packer identity, Falcon-512 seal, transaction signatures, and the resulting state root. Soft votes pipeline the body; the height commits when four committee members have signed in one round. From height 369,998 on 2300 (Phase 2) OK votes are scoped to (height, round) (`pl-ok:v2`); heights 371,037–374,999 were signed with the legacy `pl-ok:v1` payload during a pause, and round-scoped votes resumed at 375,000. The next ledger records that certificate as `parent_cert`. Height 1 has no parent certificate.',
      },
      {
        type: 'table',
        headers: ['Step', 'What happens'],
        rows: [
          ['Propose', 'Ranked packer seals a non-empty body under the pack budget'],
          ['Verify', 'Every seat checks parent, packer, sigs, and state root'],
          ['Commit', '4 of the frozen 6 — packer counts — form the ledger certificate'],
          ['Confirm', 'Hard quorum ceil(n × 0.6) of bonded seats; flag only, not the commit rule'],
          ['Round change', 'Round-0 silence timeout 6.6 s (2 × live pack window), +50% per round up to round 4; 3,000 ms when the proposer is offline or lagging. Timers run only while there is work'],
          ['Lock', 'A seat that OK’d body A re-votes A in later rounds unless round r proves A cannot reach 4 of 6'],
          ['Slash', 'Two different hashes from one seat in one (height, round) → full bond, unbonding and escrow seized into the validator reward pot; jail. Unjail costs 1,000 × 2^jail_count FPL'],
        ],
      },
      {
        type: 'p',
        text: 'If the proposer is silent, the committee votes a round change (same 4-of-6 bar) and the next seat in the frozen committee proposes. View-change does not redraw the committee; it walks the order, so a dead packer cannot pin the height. A pending body that survives 3 round advances is dropped and the round’s proposer seals fresh. Conflicting live proposals keep the first valid body; the chain does not rewind the tip to resolve them.',
      },
    ],
  },
  {
    id: 'lifecycle',
    number: '5',
    title: 'Validator lifecycle',
    blocks: [
      {
        type: 'p',
        text: 'Users never join consensus. Operators do. The registry grows only through genesis and confirmed **Bond** transactions. A Hello must not invent a lottery seat. A joiner must not pack while it is behind the mesh tip.',
      },
      {
        type: 'code',
        text: '1. Generate a Falcon-512 identity.\n2. Obtain ApproveValidator admission, fund the account and submit Bond\n   (≥ 50,000 FPL for new seats on 2300).\n3. Wait until that Bond is packed — the registry now includes the seat.\n4. Start the node with --join against published seeds.\n5. If tip = 0 or lag ≥ 2,048: pull a join-snap from an archive\n   (tip state + 128 ledgers). Snapshots are not a live feed.\n6. Close the residual gap with certified NeedLedgers.\n7. Pong at the mesh tip. Only then may the seat pack.\n8. To leave: RequestUnbond → 14-day cooldown → CompleteUnbond.',
      },
      {
        type: 'p',
        text: 'Catch-up is two stages on purpose. A join-snap is a point-in-time copy of tip state plus a short certified tail, served only by nodes that advertise the archive role. Residual ledgers after that snap apply without re-verifying every historical Falcon signature; **live packing still verifies every transaction**. Light validators keep 128 ledgers in memory. They follow gossip. They are not fed the tip by the archive after they are live.',
      },
      {
        type: 'table',
        headers: ['Situation', 'Protocol response'],
        rows: [
          ['New seat, tip 0', 'Join-snap, then residual'],
          ['Restart, lag ≥ 2,048', 'Join-snap again, then residual'],
          ['Restart, small lag', 'Residual NeedLedgers only'],
          ['Joiner still behind', 'Refuse to pack; skip if the lottery still picks it'],
          ['Bond not yet packed', 'Seat is not in the registry — Hello cannot add it'],
          ['Unbonding', 'Out of the lottery immediately; funds locked 14 days'],
        ],
      },
    ],
  },
  {
    id: 'crypto',
    number: '6',
    title: 'Cryptography',
    blocks: [
      {
        type: 'p',
        text: 'Classical signatures (ECDSA, Ed25519) will not remain adequate for multi-decade financial infrastructure. Falcon PL uses Falcon-512 lattice signatures — NIST-aligned, hash-and-sign — for account transactions, consensus votes, and ledger seals, from genesis, not as a later migration.',
      },
      {
        type: 'bullets',
        items: [
          'Domain-separated payloads for LedgerOk (round-scoped `pl-ok:v2` on 2300 from 369,998), SkipPacker, ViewChange, and OnlineSetVote.',
          'Implementation: Falcon-512 detached signatures via `pqcrypto-falcon` 0.3. An account tx is checked against the account’s on-chain key when it has one. From height 520,000 on 2300 Merkle batch bodies carry every sender signature and key, and receivers re-check them.',
          'Voter identity must match the key. Empty, unknown, jailed, or unbonded voters do not count.',
          'Local, deterministic verification. No external signing service on the consensus path.',
          'Public binaries refuse development HMAC keys unless `--allow-dev-crypto` is set.',
          'Admin commands ride a unix socket (mode 0600), not the public TCP wire.',
        ],
      },
    ],
  },
  {
    id: 'token',
    number: '7',
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
        text: 'Treasury funds leave only through protocol epoch emission. There is no human withdrawal key. Emission follows Continuous Inflationary Decline: a declining share of remaining treasury (first claimable epoch 30 bps). The epoch is **7 days**. Pre-public testnet **2300** pays from **epoch 1**. Mainnet keeps a bootstrap: epochs 1–7 emit nothing, first claim at epoch 8. Claims are pull-based.',
      },
      {
        type: 'table',
        headers: ['Epoch slice', 'Share', 'Who'],
        rows: [
          ['Validators', '55% + unfilled remainder', 'Bonded pack / check work'],
          ['Watchers', '5%', 'Rail work × presence'],
          ['AMM LPs', '20%', 'Active pool share; 0.5% cap per account'],
          ['Lending LPs', '20%', 'Active supply share; 0.5% cap per account'],
          ['Fees (from 420,000)', '50% burned, 30% proposer, 20% pot', 'Validator pot'],
        ],
      },
    ],
  },
  {
    id: 'popl',
    number: '8',
    title: 'Proof of Participation & Liquidity',
    blocks: [
      {
        type: 'p',
        text: 'PoPL is how the protocol pays useful work. It is not how the protocol chooses the next ledger. Lottery win alone does not pay. Empty seals do not exist. An idle bond earns nothing.',
      },
      {
        type: 'table',
        headers: ['Actor', 'What counts', 'Pay rule'],
        rows: [
          ['Packer', 'Transactions actually sealed', '50% of the validator pot, pro-rata (40% / 10% split below from 420,000)'],
          ['Checker', 'Qualifying OK votes on accepted ledgers', '40% of the validator pot; 10% is a presence floor'],
          ['Watcher', 'Accepted rail header or deposit', '`work × (slots / 168)`, then cap'],
          ['AMM / lend LP', 'Active liquidity share', 'Pro-rata inside the 20% bucket, 0.5% cap'],
        ],
      },
      {
        type: 'code',
        text: 'presence_i = slots_active_i / 168\nweight_i   = work_i × presence_i          # 0 if work_i = 0\npay_i      = min(cap, pot × weight_i / Σ weight)',
      },
      {
        type: 'p',
        text: 'A watcher heartbeat fills the current presence slot and adds **zero** work. Opening a tab is not a job. Self-written credit is not in the public transaction set. Unfilled LP and watcher remainder returns to the validator pot.',
      },
    ],
  },
  {
    id: 'markets',
    number: '9',
    title: 'Markets and rails',
    blocks: [
      {
        type: 'p',
        text: 'Native FPL sits beside represented assets from hardcoded rails. On public testnet **2300**, ETH and USDC enter through a **dest-lock** Ethereum contract with no owner and no admin withdraw. BTC enters a BitVM2 instance (NUMS key-path dead). Peg-out is a claimer dest-lock Kickoff, then the user’s Bitcoin key after CSV. Setup n-of-n is used once to presign Challenge/abort, then those secrets are wiped. Live Kickoff is not FROST and not a federated operator withdraw key. After Kickoff, only dest CHECKSIG (CSV) or a published abort can spend the claim. This paper does not claim an external audit.',
      },
      {
        type: 'table',
        headers: ['Rail (2300 testnet)', 'Role'],
        rows: [
          ['Falcon PL', 'Settlement, FPL, lending, AMM, rewards'],
          ['Bitcoin testnet', 'BitVM2 instance + dest-lock Kickoff (FBTC); no FROST'],
          ['Ethereum Sepolia', 'FalconDestLock: dest-lock Kickoff + dest take (no live n-of-n)'],
          ['BNB', 'Protocol rail exists; not a public dest-lock product'],
          ['XRP', 'Classic XRPL FXRP corridor — not 1001, not dest-lock'],
        ],
      },
      {
        type: 'p',
        text: 'From height 800,000 on 2300 (2.10.4) the ledger also runs a limit order book for `<ASSET>-FPL` pairs: `PlaceLimitOrder` / `CancelOrder` escrow inside the order, matching runs in transaction apply on every seat with price-time priority, and each swap takes the better of book and AMM. A per-ledger hook fills orders the AMM price has crossed and expires old ones. Supported rails are genesis- or governance-listed. Arbitrary user-added bridges are not a day-one path. Public mint of native FPL remains epoch settlement only. Live addresses and the trust model: portal `docs/BRIDGES-2300.md` and Falcon-PL `docs/BRIDGES_2300_STATUS.md`.',
      },
    ],
  },
  {
    id: 'attacks',
    number: '10',
    title: 'Attack surfaces',
    blocks: [
      {
        type: 'lead',
        text: 'Every mechanism above creates a surface. This section lists the surfaces the protocol is designed against, and the rule that answers each one.',
      },
      {
        type: 'table',
        headers: ['Surface', 'Defence'],
        rows: [
          [
            'Sybil lottery seats',
            'Registry grows only via genesis and packed Bond txs. Hello advertises keys and tip; it cannot create a seat.',
          ],
          [
            'Equivocation (two hashes at one height)',
            'Two OKs for different hashes in one (height, round): seize the full bond into the reward pot and jail. Unjail cost doubles per jail.',
          ],
          [
            'Silent or dead packer',
            'Round timeout, then 4-of-6 ViewChange. The next seat in the frozen committee proposes, so one seat cannot pin the height.',
          ],
          [
            'Lagging joiner elected packer',
            'Refuse to pack while behind tip. Live-but-lagging winners are skippable. Packing requires a mesh pong.',
          ],
          [
            'Empty-seal farming',
            'An idle chain does not seal. Empty fallback blocks (from 755,000) follow only a permanent-failure eviction. No qualifying work and no fees means zero claims.',
          ],
          [
            'Unbond and run (nothing at stake)',
            'RequestUnbond removes the seat from the lottery immediately. Funds unlock only after 14 days.',
          ],
          [
            'Long-range rewrite',
            'Each ledger carries parent hash plus the parent’s 4-of-6 certificate. Catch-up does not rewind a live tip.',
          ],
          [
            'Poisoned history / fake snap',
            'Join-snaps come only from advertised archives. Residual apply is certified. Live packing still verifies every tx.',
          ],
          [
            'Forged or unsigned votes',
            'Falcon-512 over a domain-separated payload. Unknown, jailed, unbonded, or mismatched voter ids are dropped.',
          ],
          [
            'Native mint / self-credit',
            '`CreditAsset` is admin-only on a locked public wire. `WatcherCredit` is disabled. Work is rail header or deposit.',
          ],
          [
            'Mempool flood',
            'Hard cap; 64 pending per account. Fee tier 1×–16× from utilisation. Submits below the suggested minimum are rejected. Permanent failures are evicted and not re-admitted at the same tip.',
          ],
          [
            'Eclipse of a joiner',
            'Published seeds plus archive ads. A partitioned joiner cannot pack. It cannot invent a competing certified tip.',
          ],
          [
            'Admin on the public port',
            'State-mutating operator messages are refused on TCP. Admin is a local unix socket, mode 0600.',
          ],
          [
            'Quantum break of accounts or QC',
            'No classical signing path for txs, votes, seals, or peer identity. Falcon-512 from height 1.',
          ],
          [
            'Committee collusion',
            'Commit is 4 of a frozen 6. Confirmation still needs ceil(n × 0.6) of bonded stake. Bond is slashable.',
          ],
          [
            'False rail mint',
            'Hardcoded rails. ETH/USDC mint follows an on-chain Deposit and sampled LC header. BTC mint follows a Bitcoin SPV proof vs the rail tip. Watchers cannot write their own work.',
          ],
          [
            'Admin drain of bridged ETH/USDC',
            'FalconBridge has no owner and no open withdraw. take() is dest-locked. Auto-mint is liveness only.',
          ],
          [
            'Stranger spend of BTC claim',
            'After Kickoff, ELSE is dest CHECKSIG + CSV; IF is abort only after a valid FPL challenge. Kickoff is claimer CHECKSIG on the instance (setup keys already wiped).',
          ],
        ],
      },
      {
        type: 'p',
        text: 'What the protocol does **not** claim: a formal safety proof under asynchrony, immunity to a majority of bonded stake, or that the current JSON-TCP mesh is a finished peer-discovery layer. Those are engineering and research tasks, not hidden by this list.',
      },
    ],
  },
  {
    id: 'performance',
    number: '11',
    title: 'Performance envelope',
    blocks: [
      {
        type: 'p',
        text: 'The pack budget is a **maximum** packing window (1,000 ms), not a fixed close clock. The round-0 packer waits 2.5 s after the height opens unless a full block is waiting, so a busy chain closes a height every few seconds. When there is no work, the chain does not mint empty height. Figures below are measured unless marked projected.',
      },
      {
        type: 'table',
        headers: ['Bound', 'Value', 'Meaning'],
        rows: [
          ['Pack budget', '1,000 ms', 'Upper bound to assemble one body'],
          ['Progress timeout', '3,000 ms', 'Silence before skip / view-change'],
          ['Min block gap', '2,500 ms', 'Round-0 pacing; waived when a full block is waiting'],
          ['Transactions / ledger', '128 core seats; 400 default cap', 'Packer-side cap plus ~1 MB body budget'],
          ['Mempool', '50,000', 'Reject when full'],
          ['Measured soak', '20 tx/s for ~15 h', 'Over 1 million transactions, modest hardware (October 2026)'],
          ['Measured block time', '~5.3 s average', 'Testnet 2300 chain height data, around 3 November 2026'],
          ['Measured block time', '~7.8 s', 'Live sample, 3 Nov 2026 20:36–20:42 GMT: 40 blocks in 311 s, read from falcon-fpl.com/v1/health'],
        ],
      },
      {
        type: 'p',
        text: 'Verify cost, committee fan-out, and host memory dominate before the signature scheme itself becomes a law of nature. Resource exhaustion (RAM) is a capacity limit, not a second history. Any throughput above the measured soak is projected, not measured, and is not used as a product number.',
      },
    ],
  },
  {
    id: 'governance',
    number: '12',
    title: 'Governance',
    blocks: [
      {
        type: 'p',
        text: 'Bonded validators may propose bounded parameter changes. Hard rules — supply cap, keyless treasury, and core consensus safety — are not available for casual amendment. Class B money-rule changes take an amendment and notice of at least one epoch.',
      },
      {
        type: 'p',
        text: 'The live pre-public beta is network **2300**. It is a genesis of this protocol, not a mainnet, and not a cash market. Mainnet follows a published ceremony, freeze pin, and external audit.',
      },
    ],
  },
  {
    id: 'summary-table',
    number: '13',
    title: 'At a glance',
    blocks: [
      {
        type: 'table',
        headers: ['Item', 'Detail'],
        rows: [
          ['Chain', 'Falcon PL (Falcon Participation Ledger)'],
          ['Token', 'FPL — 200B hard cap, 98% keyless treasury'],
          ['Consensus', 'Falcon Consensus — lottery committee of 6, 4-of-6 commit, round-change failover'],
          ['Signatures', 'Falcon-512 on txs, votes, and seals'],
          ['Join', 'Bond → archive join-snap → certified residual → pong at tip'],
          ['Leave', 'Unbond, 14-day lock, out of lottery immediately'],
          ['Rewards', 'PoPL — pack, check, watch, provide liquidity'],
          ['Markets', 'AMM, collateralised lending, hardcoded rails'],
          ['Public mint', 'Epoch settlement only'],
        ],
      },
    ],
  },
]
