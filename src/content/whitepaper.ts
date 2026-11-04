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
        text: 'Honest seats share one parent hash, one height, and one state root. Time is loosely synchronised: pack and progress timeouts are wall-clock, but the lottery seed is the committed tip, not a clock. The public wire is a persistent peer mesh. Headers gossip and bodies are pulled. Votes, bodies and catch-up use separate lanes, with byte-capped queues. Since 2.10.3 a line over 64 KB goes to 2.10.3+ peers as ordered pieces of up to 48 KB (limits: 2,048 pieces, 48 MB, 8 streams, 30 s); older peers get one line. A Hello must name a compatible release (2.9.x, or ≥ 2.9.60 after the Gloas height); 2.10.x advertises `2.9.100` on the wire for that reason. Admin mutations do not travel on that wire.',
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
          ['Ledger cap', 'Packer-side, not a verify rule: `--max-txs 0` on every live seat (core seats and the public profile), which selects the 400-tx safety cap (`PACK_DEFAULT_MAX_TXS`; `--max-txs N` > 0 overrides), plus a ~1 MB body budget; pack budget 4,000 ms on the core seats, 1,000 ms in the public profile'],
          ['Header time', '`sealed_at` ≥ parent and ≤ parent + 60 s; from 420,000 a checker also refuses a stamp > 5 s ahead of its clock (a 1 s step is always allowed)'],
          ['Public mint', 'Epoch settlement only — not a user transaction'],
        ],
      },
      {
        type: 'table',
        headers: ['Commitment', 'Construction (as implemented)'],
        rows: [
          ['State root', 'SHA-256 of the canonical serialisation of the full state: accounts, DeFi, bridge, validator fields, claimables, and (once used) v2 validator, presence, catch-up and seat-payout maps. Not a Merkle tree, so there are no state inclusion proofs. Since 2.9.58 the large ETH exec-header map’s JSON is cached and a root already computed for identical bytes is reused. Since 2.9.59 the stage-time hash runs outside the node lock, using `ring` SHA-256 (measured: 207 MB in 0.80 s vs 1.43 s with `sha2` on a seat without SHA-NI)'],
          ['Tx root', 'SHA-256 of the comma-joined tx ids, in the ledger header `pl-ledger:v3` with height, parent, packer, state root, skips and parent-cert hash'],
          ['Merkle batch', 'Binary SHA-256 tree (leaf tag 0, node tag 1, odd node paired with itself) over tx payloads, plus a second tree over the sender signatures. The packer signs `payload_root|sig_root` once. From 520,000 every sender signature and key stays in the body and receivers re-check them. A key already stored on the account is left off the body'],
          ['Packing', 'Per-tx row undo instead of a state clone per candidate (2.9.49). Body sized by estimate: ~5 KB for a first-seen key, ~2.3 KB otherwise, up to the ~1 MB budget'],
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
        text: 'At each height the eligible set is the bonded, non-jailed, non-inactive seats (from 420,000 a v2 seat also needs ≥ 50,000 FPL). The lottery seed is SHA-256 of a tag, the network id, the open height, the committed tip seed, the previous packer, and the eligible set as `id:bond` sorted by id. The tip seed on 2300 is signature-free: SHA-256 of the tip’s parent hash, height and v4 header message (tx root, state root, skips, parent-cert hash, claim root, current-committee root), not the packer’s signature. Skips are not a direct seed input: seat n is drawn from `pick|seed|rank:n` with the seats already drawn excluded. Integer reduction (first 64 bits of the pick hash mod total weight) ranks packers: weighted by bond before height 420,000 on 2300, equal weight from 420,000. Honest nodes that share a tip compute the same ranking. Mesh pongs are pack **permission**, not election: an offline seat stays in the draw until it is benched as inactive, and its round is passed by view-change.',
      },
      {
        type: 'code',
        text: 'eligible = bonded ∧ ¬jailed ∧ ¬inactive          # sorted by id\ntip_seed = SHA256("fpl-seed-v2|" ‖ tip.parent_hash ‖ tip.height ‖ header_msg_v4(tip))\nseed     = SHA256("lottery|v8|" ‖ network_id ‖ height ‖ tip_seed ‖ "prev:" ‖ prev_packer ‖ "set:" ‖ id:bond,…)\npick_n   = SHA256("pick|" ‖ seed ‖ "|rank:" ‖ n)[0..64 bits] mod Σweight   # earlier picks excluded; weight 1 each from 420,000\ncommittee = freeze(first 6 of rank)      # frozen at tip commit\nproposer = committee[round mod 6]\ncommit   = 4 distinct committee signatures in one round\nround++  = 4-of-6 ViewChange after round timeout',
      },
      {
        type: 'p',
        text: 'The round’s proposer packs applicable mempool transactions under its pack budget (4,000 ms on the core seats, 1,000 ms in the public install profile) and proposes a body. In round 0 it waits until 2.5 s after this seat committed the previous block and opened the height (its own clock, not the block’s sealed_at) (`--min-block-interval-ms 2500`, capped at one live pack window, pack budget + 2.3 s: 6.3 s on the core seats, 3.3 s in the public profile) unless its mempool already holds a full block; later rounds do not wait. Every full node verifies parent, height, packer identity, Falcon-512 seal, transaction signatures, and the resulting state root. Soft votes pipeline the body; the height commits when four committee members have signed in one round. From height 369,998 on 2300 (Phase 2) OK votes are scoped to (height, round) (`pl-ok:v2`); heights 371,037–374,999 were signed with the legacy `pl-ok:v1` payload during a pause, and round-scoped votes resumed at 375,000. The next ledger records that certificate as `parent_cert`. Height 1 has no parent certificate.',
      },
      {
        type: 'table',
        headers: ['Step', 'What happens'],
        rows: [
          ['Propose', 'Ranked packer seals a non-empty body under the pack budget'],
          ['Verify', 'Every seat checks parent, packer, sigs, and state root'],
          ['Commit', '4 of the frozen 6 — packer counts — form the ledger certificate'],
          ['Confirm', 'Hard quorum ceil(n × 0.6) of bonded seats; flag only, not the commit rule'],
          ['Round change', 'Silence timeout 2 × live pack window (12.6 s core seats, 6.6 s public profile), +50% per round up to round 4; the progress timeout (9,000 / 3,000 ms) when the proposer is offline or lagging. With a body in hand: 4 × progress timeout, same backoff. Timers run only while there is work'],
          ['Cert recovery', 'A seat that committed the tip without its certificate rebuilds it from the sealing committee’s signed OKs seen on the wire; cert holders answer a peer’s recert vote. A cert-less seat may vote a round change only after 2 × proposal timeout without progress'],
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
        text: 'Catch-up is two stages on purpose. A join-snap is a point-in-time copy of tip state plus a short certified tail, served only by nodes that advertise the archive role. Residual ledgers after that snap are certified, and since 2.9.66 catch-up re-checks every transaction signature by default, as the live path does (Merkle batch bodies via the batch proof). A weak box may opt out with `FPL_CATCHUP_SKIP_TX_SIG=1` when a parent certificate is present. A seat more than 256 behind may pull a snapshot. Archives publish a new join pin at most every 10 minutes and keep the newest 6 for at least 30 minutes, fetchable by hash. A joiner resumes kept chunks by SHA-256 and skips a source that is too slow (snapshot projected over 8 min, or a `NeedLedgers` peer that moves the tip nowhere in 10 s). Light validators keep 128 ledgers in memory. They follow gossip. They are not fed the tip by the archive after they are live.',
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
          'Key binding on 2300: from 470,000 the sender key is recorded on the account. From 571,000 an account’s first key binds only if the id is that key’s classic address or a funder committed its hash with `PayToKey`. From 692,000 sender verification, key binding and consensus signatures read only on-chain keys and the seat registry, never a node-local key ring. Seat keys and account keys are separate.',
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
        text: 'Treasury funds leave only through protocol epoch emission. There is no human withdrawal key. Emission follows Continuous Inflationary Decline: a declining share of remaining treasury (first claimable epoch 30 bps). The epoch is **7 days**. From the bridge height the operator bucket is carved first; the 55 / 5 / 20 / 20 split applies to the rest, so the effective shares are 5 + 52.25 + 4.75 + 19 + 19 = 100%. Before 692,000 there was no carve and the split was 55 / 5 / 20 / 20. Pre-public testnet **2300** pays from **epoch 1**. Mainnet keeps a bootstrap: epochs 1–7 emit nothing, first claim at epoch 8. Claims are pull-based.',
      },
      {
        type: 'table',
        headers: ['Epoch slice', 'Share', 'Who'],
        rows: [
          ['Bridge operators (from 692,000)', '5% off the top', 'Liveness, watching, proven payouts; any undistributed part returns to the treasury'],
          ['Validators', '52.25% (55% of the remaining 95%) + unfilled remainder', 'Bonded pack / check work: 50% proposer, 40% votes, 10% floor'],
          ['Watchers', '4.75% (5% of 95%)', 'Rail work × presence; cap 0.05% of the post-carve emission per account'],
          ['AMM LPs', '19% (20% of 95%)', 'Active pool share; cap 0.5% of the post-carve emission per account'],
          ['Lending LPs', '19% (20% of 95%)', 'Active supply share; same cap'],
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
        text: 'A seat that misses 20 own turns is benched. From 441,000 a miss counts only when the seat was within 256 blocks of the tip. A seat with less than half an epoch’s presence gets no floor weight, and a seat back from jail must post 20 consecutive packs or certificate votes before it earns again. From 692,000 validator pay accrues to a per-seat bucket: `SetSeatPayout` names a payout account and `ClaimSeat` moves the bucket, both signed by the seat key (`<validator>#seat`). A watcher heartbeat fills the current presence slot and adds **zero** work. Opening a tab is not a job. Self-written credit is not in the public transaction set. Unfilled LP and watcher remainder returns to the validator pot.',
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
          ['Bitcoin testnet4', '`BTC4` rail from 692,000: `Btc4PegIn` mint against operator-bound graphs, BitVM2 withdraw claims refunded after 43,200 ledgers still awaiting peg-out. From 775,000 a competing header branch accumulates and replaces a lighter pending fork. From 800,000 `AssetPay` moves BTC4 and BTC4 lend prices are per 1 BTC4 (1e8 sats)'],
          ['Ethereum Sepolia', 'Tested non-custodial. FalconQcBridgeV3 (lead): peg-out proven against Falcon-512 committee signatures, plus deposits and refunds; FalconDestLock (dest-lock Kickoff + dest take, no live n-of-n) is legacy: after the V3 cutoff, V1/V2/DestLock deposits no longer mint. Light client follows Gloas from 409,134. Exec headers kept for a 50,400-block (~7-day) window. From 414,000 `EthV3Deposit` mints within 3 days of LC time or refunds the sender'],
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
    id: 'bridge-operators',
    title: 'Bridge operators and watchers',
    blocks: [
      {
        type: 'p',
        text: '**Bridge operators** (BitVM2, `operator_registry.rs`) are outside parties that front BTC withdrawals with their own BTC. They are then reimbursed from the locked deposit through the presigned peg-out graph (Take1/Take2). The BTC4 rail is **trust-minimised**: Falcon holds no BTC and no keys, and operators have no keys or votes over funds. BTC moves only through presigned graphs. On 2300 the `Operator*` transactions are refused below the bridge height (692,000). The three registered operators (`fpl-op-falcon1`, `fpl-op-falcon2`, `fpl-op-brain`, each bonded 5,000 FPL) are currently run by BEARTEC. Outside operators can join: any account can send `OperatorRegister` with its own BTC x-only key and a bond of at least 5,000 FPL (`min_bond`, 100% slashable on a proven bad payout).',
      },
      {
        type: 'table',
        headers: ['Operator rule', 'Value in code (preset B, default)'],
        rows: [
          ['Register', '`OperatorRegister` with a BTC x-only graph key and an FPL bond of at least 5,000 FPL; one registration per account and per BTC key'],
          ['Duties', 'Hourly `OperatorHeartbeat` (liveness plus free BTC capacity), `OperatorGraphBind` per deposit (immutable), watch all claims, front payouts (fee ≤ 0.30% of the amount)'],
          ['Slashing', 'Permissionless `OperatorSlash`: a BitVM2 Disprove of the operator’s bound graph, SPV-included on the BTC rail. Slash = 100% of the current bond; 50% goes to a registered disproving operator and the rest is burned. Jail 26 epochs; removed after 2 disproves'],
          ['Unbond', '`OperatorUnbond`: the bond stays slashable for a 2-epoch cooldown, then returns at epoch settle'],
          ['Reward', '5% of epoch emission off the top: 25% liveness (≥ 151 of 168 hourly slots), 25% watching, 50% proven payouts; per-operator cap 25% of the bucket'],
        ],
      },
      {
        type: 'p',
        text: '**Watchers** are ordinary funded accounts, not validator keys. They feed the rails and police the bridge. Header submitters post signed Bitcoin headers (`RailHeader`) and Ethereum light-client and execution headers. SPV deposits (`RailDeposit`) mint against the rail tip. Each accepted header that advances the rail tip, or wins a reorg, counts as +1 work and marks the current hourly presence slot. A pending-fork header marks presence only, and so does a `WatcherHeartbeat` (zero work). `WatcherCredit` is refused on the public wire. The permissionless BitVM2 challenger watches instance Kickoffs: an honest Kickoff pays the dest-lock output to an open burn and returns change to the instance. For anything else it broadcasts the presigned abort or a Challenge on Bitcoin. From the bridge height a BitVM2 claim is challenged on Bitcoin (Challenge → Assert → Disprove, then `OperatorSlash`), not with a ledger `RailChallenge`.',
      },
      {
        type: 'p',
        text: 'The code sets no watcher bond; each submission is a signed, fee-paying transaction. A watcher’s pay weight is `work × slots / 168`. The watcher pot is 5% of the emission left after the operator carve (4.75% of the total), with a per-account cap of 0.05% of that post-carve emission. Watchers cannot credit themselves, and a mint needs a proof against a header the ledger already accepted. A false Kickoff can therefore be aborted or challenged by anyone watching.',
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
        text: 'The pack budget is a **maximum** packing window (4,000 ms on the core seats, 1,000 ms in the public profile), not a fixed close clock. The round-0 packer waits until 2.5 s after this seat committed the previous block and opened the height (its own clock, not the block’s sealed_at) unless a full block is waiting, so a busy chain closes a height every few seconds. When there is no work, the chain does not mint empty height. Block time is not a fixed interval. (a) Under load the round-0 proposer waits until 2.5 s after this seat committed the previous block and opened the height (its own clock, not the block’s sealed_at), unless its mempool already holds a full block (400 txs) or the height is past a skip or round change; then it seals at once, so busy heights close as fast as pack, gossip and 4-of-6 votes allow. (b) When traffic is quiet a proposer with no applicable transaction does not seal: no clock, timeout or heartbeat makes a block. A lone transaction arriving later than 2.5 s after this seat committed the previous block and opened the height (its own clock, not the block’s sealed_at) is sealed straight away, so one transaction a minute gives roughly one block a minute. The only empty block (from 755,000) is a fallback: a proposer that has just evicted permanently failing transactions at that height and has nothing else applicable may seal it once, so the height closes. (c) The block gaps below are dated examples, not a specification. Figures below are measured unless marked projected.',
      },
      {
        type: 'table',
        headers: ['Bound', 'Value', 'Meaning'],
        rows: [
          ['Pack budget', '4,000 ms core seats; 1,000 ms public profile', 'Upper bound to assemble one body'],
          ['Progress timeout', '9,000 ms core seats; 3,000 ms public profile', 'Round timeout when the proposer is offline or lagging; ×4 = proposal timeout with a body in hand'],
          ['Min block gap', '2,500 ms', 'Round-0 pacing: the packer waits until 2.5 s after this seat committed the previous block and opened the height (its own clock, not the block’s sealed_at); waived when the seat’s mempool holds 400 txs (a full block) or after a skip or round change'],
          ['Transactions / ledger', '400 on every live seat', '`--max-txs 0` = 400-tx safety cap, packer-side, plus ~1 MB body budget. Largest block in heights 706,466–796,393: 330 txs'],
          ['Mempool', '50,000', 'Reject when full'],
          ['Cumulative (3 Nov 2026)', '27,835,801 txs in 796,352 ledgers', 'v1 archive counters at 20:58 GMT, chain age 79 d 22 h: about 4.0 tx/s averaged over the whole chain. Not continuous: the chain nearly halted from 21 Sep to 6 Oct 2026 (about 6,200 heights in 15 days) and stalled for about 4.4 h on 21–22 Oct'],
          ['Measured sustained', '~16.8 tx/s for 10.9 days', '10 Oct 09:51 – 21 Oct 06:56 UTC: 15.81 million txs sealed, from v1/falcon-node snapshot counters. Load came mostly from Falcon’s own load generator offering 20 tx/s; its accepted submissions averaged 19.4 tx/s (median 19.8) on 13–15 Oct'],
          ['After 21 Oct', '~4–11 tx/s', 'Daily averages from 22 Oct to 3 Nov. Blocks still had room (mean 55–81 txs, max 330, cap 400) and the mempool stayed small (median 60–165), but rounds slowed from ~18 to 4–8 blocks a minute. The load generator sat at its own in-flight limit (20 wallets × 16), and from 23 to 29 Oct one of its target seats (v11) refused connections. Since this was client-side throttling plus slower rounds, it is not a full-block limit. The slowdown began on 16 Oct, before the 21 Oct outage'],
          ['Measured soak', '20 tx/s for ~15 h', 'Over 1 million transactions, modest hardware (October 2026)'],
          ['Measured burst', '98.1 tx/s for 88 s', 'Testnet 2300, 13 Oct 2026 06:55–06:57 UTC, heights 501,209–501,232: 24 blocks, 8,634 txs, 400-tx per-block cap, Merkle batches: each body carried every sender’s Falcon-512 signature, verified by receivers, plus the packer’s single signature over `payload_root|sig_root`. This was before 520,000, so keeping those signatures was the packer’s choice, not yet a validity rule (stripped bodies below 520,000 still verify). Seven validators/hubs and two lite nodes on 2–12-core hosts; 120 wallets offering 200 tx/s into one hub. Short burst, not a sustained rate (Falcon-PL docs/ops/THROUGHPUT-2300-IMPLEMENTATION.md)'],
          ['Block gap, heavy load (example)', '~4.1 s mean, ~3.8 s median', '13 Oct 07:10 – 21 Oct 06:56 UTC, heights 501,458–668,144, load generator offering 20 tx/s; median of 30 s samples. 10 Oct 09:51 – 21 Oct 06:56 by snapshot heights: 4.07 s mean'],
          ['Block gap, lighter load (example)', '~7.9 s mean, ~7.5 s median', '2 Nov 21:00 – 3 Nov 21:00 UTC, heights 785,465–796,362, about 10 tx/s offered; median of 30 s samples. Live sample 3 Nov 20:36–20:42 GMT: 40 blocks in 311 s (7.8 s)'],
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
