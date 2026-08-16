/** Falcon PL white paper — technical system paper for /whitepaper (v5.0) */

export const WHITEPAPER_VERSION = '5.0'
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
    title: 'Falcon PL — Implementation notes',
    description: 'Engineering companion: measured throughput, soak history, and operator runbooks.',
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
    description: 'Vault, borrow/repay, collateral, and liquidation E2E.',
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
        text: 'Falcon PL is a quantum-safe **participation ledger**. Settlement is a single hash-linked chain: one parent, one height, one hash. **Falcon Consensus** elects a packer from bonded seats, requires a 4-of-6 committee certificate to commit, and skips a silent packer so the height can still close. Every transaction, vote, and seal is **Falcon-512**. The native unit **FPL** pays security, liquidity, collateral, and rail work under one set of rules.',
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
        text: 'A seat is eligible for the lottery only if it is bonded, not jailed, and answering the mesh liveness channel. Bond is a slash target and a lottery ticket. It is not an interest rate. The committee at each height is six frozen seats: one packer and five checkers. A ledger becomes *the* ledger when **four of those six** have signed it. Confirmation beyond that is a separate hard quorum of the bonded set and does not replace the certificate.',
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
        text: 'Transactions are sequenced per account. The mempool is gossiped and size-capped. Empty bodies are rejected: a packer who has nothing applicable must not seal. Fees escalate with mempool utilisation (1× / 2× / 4× / 8× / 16× the base minimum). Half of each fee is burned; the rest enters the validator pot at epoch settle.',
      },
      {
        type: 'table',
        headers: ['Object', 'Rule'],
        rows: [
          ['Accounts', 'Falcon-512 identity; sequence number; multi-asset balances'],
          ['Bond', 'On-chain lock; min 1,000 FPL; 14-day unbond'],
          ['Mempool', 'Capped; reject when full; fee tier from utilisation'],
          ['Ledger cap', '128 transactions; pack budget 1,000 ms'],
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
        text: 'Falcon Consensus is a bonded-committee protocol. Stake seats a deterministic lottery. A small frozen committee commits the block. A skip certificate walks a dead packer. Post-quantum signatures bind every vote and seal.',
      },
      {
        type: 'p',
        text: 'At each height the eligible set is the bonded, non-jailed seats. The lottery seed is a hash of network id, height, committed tip, certified skips, and the eligible set. Integer reduction against total bond ranks packers. Honest nodes that share a tip compute the same ranking. Mesh pongs are pack **permission**, not election: an offline bonded seat is not selected.',
      },
      {
        type: 'code',
        text: 'eligible = bonded ∧ ¬jailed\nseed     = H(network_id ‖ height ‖ tip_hash ‖ skips ‖ eligible)\nrank     = lottery(seed, bonds)          # same tip ⇒ same #1, #2, …\ncommittee = freeze(packer #1 + 5 checkers)\ncommit   = 4 distinct committee signatures\nskip     = 4-of-6 after progress timeout, then next rank packs',
      },
      {
        type: 'p',
        text: 'The winner packs applicable mempool transactions under a 1,000 ms budget and proposes a non-empty body. Every full node verifies parent, height, packer identity, Falcon-512 seal, transaction signatures, and the resulting state root. Soft votes pipeline the body; the height commits when four committee members have signed. The next ledger records that certificate as `parent_cert`. Height 1 has no parent certificate.',
      },
      {
        type: 'table',
        headers: ['Step', 'What happens'],
        rows: [
          ['Propose', 'Ranked packer seals a non-empty body under the pack budget'],
          ['Verify', 'Every seat checks parent, packer, sigs, and state root'],
          ['Commit', '4 of the frozen 6 — packer counts — form the ledger certificate'],
          ['Confirm', 'Hard quorum ceil(n × 0.6) of bonded seats; flag only, not the commit rule'],
          ['Skip', 'After pack budget + grace, committee may vote view-change on silence'],
          ['Slash', 'Two different hashes at one height from one seat → jail and slash'],
        ],
      },
      {
        type: 'p',
        text: 'If the winner is silent, the committee issues a skip (same 4-of-6 bar). View-change redraws the committee from the new view seed so a dead packer cannot pin the height. The same packer cannot reseal a second body at that height. Conflicting live proposals keep the first valid body; the chain does not rewind the tip to resolve them.',
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
        text: '1. Generate a Falcon-512 identity.\n2. Fund the account and submit Bond (≥ 1,000 FPL).\n3. Wait until that Bond is packed — the registry now includes the seat.\n4. Start the node with --join against published seeds.\n5. If tip = 0 or lag ≥ 2,048: pull a join-snap from an archive\n   (tip state + 128 ledgers). Snapshots are not a live feed.\n6. Close the residual gap with certified NeedLedgers.\n7. Pong at the mesh tip. Only then is the seat lottery-eligible.\n8. To leave: RequestUnbond → 14-day cooldown → CompleteUnbond.',
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
          'Domain-separated payloads for LedgerOk, SkipPacker, ViewChange, and OnlineSetVote.',
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
        text: 'Treasury funds leave only through protocol epoch emission. There is no human withdrawal key. Emission follows Continuous Inflationary Decline: a declining share of remaining treasury (first claimable epoch 30 bps). On public parameters the epoch is **7 days**. Epochs 1–7 emit nothing so the mesh can stabilise. Claims are pull-based.',
      },
      {
        type: 'table',
        headers: ['Epoch slice', 'Share', 'Who'],
        rows: [
          ['Validators', '55% + unfilled remainder', 'Bonded pack / check work'],
          ['Watchers', '5%', 'Rail work × presence'],
          ['AMM LPs', '20%', 'Active pool share; 0.5% cap per account'],
          ['Lending LPs', '20%', 'Active supply share; 0.5% cap per account'],
          ['Fee remainder', '50% of fees after burn', 'Validator pot'],
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
          ['Packer', 'Transactions actually sealed', 'Half the validator pot, pro-rata'],
          ['Checker', 'Qualifying OK votes on accepted ledgers', 'Other half of the validator pot'],
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
        text: 'Native FPL sits beside represented assets from hardcoded rails. Value enters by lock-on-source, mint-on-Falcon, against protocol headers and deposits — not a federated mint authority as the end state. Once on the ledger, capital can sit in pools, supply lending markets, serve as collateral, or trade against FPL and stables.',
      },
      {
        type: 'table',
        headers: ['Rail', 'Role'],
        rows: [
          ['Falcon PL', 'Settlement, FPL, lending, AMM, rewards'],
          ['Bitcoin', 'Primary SPV-style rail into wrapped BTC markets'],
          ['Ethereum', 'ETH corridor, same proof shape'],
          ['BNB', 'BNB corridor, same proof shape'],
        ],
      },
      {
        type: 'p',
        text: 'Supported rails are genesis- or governance-listed. Arbitrary user-added bridges are not a day-one path. Public mint of native FPL remains epoch settlement only.',
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
            'Packer or checker: slash the bond and jail. The same packer cannot reseal after view-change.',
          ],
          [
            'Silent or dead packer',
            'Progress timeout, then 4-of-6 skip. View-change redraws the committee so one seat cannot pin the height.',
          ],
          [
            'Lagging joiner elected packer',
            'Refuse to pack while behind tip. Live-but-lagging winners are skippable. Lottery requires a mesh pong.',
          ],
          [
            'Empty-seal farming',
            'Empty bodies are rejected. No qualifying work and no fees means zero claims.',
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
            'Hard cap. Fee tier 1×–16× from utilisation. Submits below the suggested minimum are rejected.',
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
            'Hardcoded rails. Mint follows an accepted header and deposit proof. Watchers cannot write their own work.',
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
        text: 'The pack budget is a **maximum** packing window (1,000 ms), not a fixed close clock. A ledger holds at most 128 transactions. When there is work and the committee is live, the tip can advance in a few hundred milliseconds. When there is no work, the chain does not mint empty height.',
      },
      {
        type: 'table',
        headers: ['Bound', 'Value', 'Meaning'],
        rows: [
          ['Pack budget', '1,000 ms', 'Upper bound to assemble one body'],
          ['Progress timeout', '3,000 ms', 'Silence before skip / view-change'],
          ['Transactions / ledger', '128', 'Hard cap on one body'],
          ['Mempool', '50,000', 'Reject when full'],
          ['Measured keep-up', '500 tx/s', 'Submit path stayed current under Falcon-512'],
        ],
      },
      {
        type: 'p',
        text: 'Verify cost, committee fan-out, and host memory dominate before the signature scheme itself becomes a law of nature. Resource exhaustion (RAM) is a capacity limit, not a second history. Throughput claims above a measured keep-up are envelopes and are not used as product numbers.',
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
          ['Consensus', 'Falcon Consensus — lottery packer, 4-of-6 commit, skip failover'],
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
