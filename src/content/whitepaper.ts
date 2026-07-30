/** Falcon Ledger white paper — content for /whitepaper (v3, July 2026) */

export const WHITEPAPER_VERSION = '3.0'
export const WHITEPAPER_DATE = 'July 2026'

export interface WhitepaperDownload {
  title: string
  description: string
  href: string
  filename: string
}

/** PDFs live in repo Docs/ — served from public/Docs/. */
export const WHITEPAPER_DOWNLOADS: WhitepaperDownload[] = [
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
    description: 'Falcon, Ethereum, BNB, Bitcoin wallets and lock-mint bridges.',
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
 * Vision: FALCON is the centre of a multi-chain lending & liquidity network
 * (Falcon + Ethereum + BNB Chain + Bitcoin + expandable corridors).
 */
export const WHITEPAPER_SECTIONS: WhitepaperSection[] = [
  {
    id: 'abstract',
    title: 'Abstract',
    blocks: [
      {
        type: 'lead',
        text: 'Falcon Ledger is a quantum-safe settlement layer built so that one token — FALCON — can coordinate liquidity, collateral, and rewards across a multi-chain lending network. The network is designed around five rails today, with architecture that can add more chains without redesigning the core.',
      },
      {
        type: 'p',
        text: 'The ledger keeps the speed and low fees of an XRP Ledger–style consensus path, replaces classical signatures with Falcon-512 from the first block, and places 98% of supply in a keyless protocol treasury. Participants who secure the chain, supply liquidity, or lend capital are paid by protocol rules — not by company promises.',
      },
    ],
  },
  {
    id: 'vision',
    number: '1',
    title: 'Vision: FALCON at the centre',
    blocks: [
      {
        type: 'p',
        text: 'Most chains treat multi-chain as a side quest: a bridge here, a wrapper there. Falcon treats multi-chain as the product. FALCON is the unit that measures participation, backs borrowing where the protocol allows, rewards validators and liquidity providers, and ties external value into one hub.',
      },
      {
        type: 'callout',
        title: 'Network rails (expandable)',
        text: 'Five rails form the launch map: Falcon Ledger (hub), Ethereum, BNB Smart Chain, Bitcoin, and further corridors as bridges and demand come online. Assets move onto Falcon as IOUs for lending, pools, and settlement — then can move back out when routes support it.',
      },
      {
        type: 'stats',
        items: [
          { label: 'Hub chain', value: 'Falcon Ledger' },
          { label: 'External rails', value: 'ETH · BNB · BTC + more' },
          { label: 'Core asset', value: 'FALCON' },
          { label: 'Model', value: 'Lend · Pool · Bridge' },
        ],
      },
      {
        type: 'p',
        text: 'On Falcon, bridged forms such as F-USDC, FETH, FBNB, and FBTC sit alongside native FALCON. Users hold, swap, provide liquidity, and borrow under one passkey-secured experience — without jumping between disconnected apps for every chain.',
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
          'Rewards that still force users through centralised exchanges to become useful.',
        ],
      },
      {
        type: 'p',
        text: 'Falcon addresses these together: multi-chain connectivity, a keyless majority treasury, on-chain rewards for real participation, Falcon-512 everywhere security-critical paths run, and native DEX/AMM plus lending so value can move without leaving the protocol stack.',
      },
    ],
  },
  {
    id: 'architecture',
    number: '3',
    title: 'Architecture overview',
    blocks: [
      {
        type: 'table',
        headers: ['Layer', 'Role'],
        rows: [
          ['Settlement hub', 'Falcon Ledger — RPCA consensus, sub-second finality, low fees'],
          ['Security', 'Falcon-512 for accounts, validators, and P2P identity (no classical signing paths)'],
          ['Supply', '200B hard cap · 98% keyless treasury · 2% public bootstrap'],
          ['Incentives', 'Proof of Participation & Liquidity (PoPL) — validators + LPs paid by epoch'],
          ['Markets', 'Built-in AMM, DEX orders, collateralised lending & borrowing'],
          ['Multi-chain', 'Lock-mint bridges + multi-key wallet under one passkey'],
          ['Growth', 'New chains and assets added as bridge routes without forking the hub'],
        ],
      },
      {
        type: 'p',
        text: 'The consensus model remains familiar and battle-tested. The economic and cryptographic layers are rebuilt for long-term fairness and post-quantum security.',
      },
    ],
  },
  {
    id: 'multichain',
    number: '4',
    title: 'Multi-chain lending & liquidity',
    blocks: [
      {
        type: 'lead',
        text: 'FALCON coordinates a decentralised lending and liquidity network that spans multiple chains and is built to grow.',
      },
      {
        type: 'p',
        text: 'Value enters Falcon through permissionless-style bridge corridors (lock on the source chain, mint a represented asset on Falcon). Once on Falcon, capital can sit in liquidity pools, supply lending vaults, serve as collateral, or trade against FALCON and stable representations — under protocol rules users can inspect on-chain.',
      },
      {
        type: 'table',
        headers: ['Rail', 'Role on the network', 'Status direction'],
        rows: [
          ['Falcon Ledger', 'Settlement hub · FALCON · lending · AMM · rewards', 'Live testnet'],
          ['Ethereum', 'USDC and ETH corridors into F-USDC / FETH', 'Live testnet routes'],
          ['BNB Smart Chain', 'BNB corridor into FBNB', 'Live testnet bridge-in'],
          ['Bitcoin', 'BTC corridor into FBTC', 'Bringing native path live'],
          ['Additional chains', 'Same hub model as demand and audits allow', 'Expandable by design'],
        ],
      },
      {
        type: 'callout',
        title: 'One wallet, many domains',
        text: 'A single passkey can protect Falcon keys (r…), a shared EVM key for Ethereum and BNB networks, and Bitcoin keys — so multi-chain is operationally one product, not five separate wallets.',
      },
      {
        type: 'p',
        text: 'Lending on Falcon is protocol-native: supply liquidity to vaults, borrow against eligible collateral with health factors, repay, and claim participation rewards. Liquidations and risk parameters are designed for transparent, on-chain operation rather than off-chain manager discretion.',
      },
    ],
  },
  {
    id: 'token',
    number: '5',
    title: 'The FALCON token',
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
          ['Keyless protocol treasury', '98%', 'Epoch emission to validators and liquidity participants only'],
          ['Community airdrop', '1%', 'Public launch distribution'],
          ['Faucet', '0.5%', 'Onboarding and testing'],
          ['Builder pot', '0.5%', 'Core work, audits, growth contributions'],
        ],
      },
      {
        type: 'p',
        text: 'Emission follows Continuous Inflationary Decline (CID): a smooth, declining schedule rather than abrupt multi-year cliffs. Early epochs may schedule zero claimable emission so the network can stabilise; unlocks then follow the published curve. Fees partially burn; the remainder supports active validators.',
      },
      {
        type: 'p',
        text: 'FALCON is not only a “gas token.” It is the unit that scores participation, aligns long-term security with market activity, and anchors multi-chain liquidity into one economic system.',
      },
    ],
  },
  {
    id: 'popl',
    number: '6',
    title: 'Proof of Participation & Liquidity',
    blocks: [
      {
        type: 'p',
        text: 'PoPL pays the people who make the network useful: validators who secure consensus, and liquidity providers who keep markets and lending viable.',
      },
      {
        type: 'bullets',
        items: [
          'Validators: bonded operators scored on uptime, vote accuracy, latency, and consistency (smoothed over time).',
          'Pay is proportional to score across all bonded validators — no empty promises of “everyone earns the same.”',
          'Liquidity providers: vault and AMM participants share epoch allocation when they are actively contributing.',
          'Minimum bond and unbonding delays reduce hit-and-run security and gaming.',
        ],
      },
      {
        type: 'code',
        text: 'validator_share = pot × your_composite / sum(all_composites)',
      },
      {
        type: 'p',
        text: 'Double-signing is slashable. Further offence types are defined at the protocol layer as detection matures. The goal is simple: real participation, real rewards, accountable security.',
      },
    ],
  },
  {
    id: 'security',
    number: '7',
    title: 'Quantum security',
    blocks: [
      {
        type: 'p',
        text: 'Classical signatures such as ECDSA and Ed25519 will not remain adequate for multi-decade financial infrastructure. Falcon Ledger uses Falcon-512 lattice signatures as the standard scheme for account transactions, validator consensus, and peer identity — from genesis, not as a later migration project.',
      },
      {
        type: 'bullets',
        items: [
          'NIST-aligned post-quantum design (Falcon family).',
          'No classical signing paths for accounts, consensus, or P2P identity.',
          'Local, deterministic verification in consensus — no external signing service.',
        ],
      },
    ],
  },
  {
    id: 'product',
    number: '8',
    title: 'What you can use today',
    blocks: [
      {
        type: 'p',
        text: 'The public portal is a single surface for testnet finance — not a pile of disconnected tools.',
      },
      {
        type: 'table',
        headers: ['Surface', 'What it does'],
        rows: [
          ['Wallet', 'Passkey Falcon accounts; multi-chain keys; send/receive'],
          ['Bridge', 'Move value onto Falcon (and out where routes allow)'],
          ['Swap & orders', 'AMM swaps and DEX limit orders'],
          ['Pools', 'Provide liquidity; earn protocol recognition'],
          ['Lend', 'Supply, borrow, repay, manage health factor'],
          ['Faucet', 'Rate-limited testnet FALCON for onboarding'],
          ['Explorer', 'Ledgers and transactions'],
          ['Arcade / community', 'Participation and engagement surfaces'],
        ],
      },
      {
        type: 'callout',
        title: 'Testnet first',
        text: 'Live parameters and issuer addresses are published in portal config and technical reports. Testnet assets have no real-world cash value. Mainnet follows ceremony, audits, and freeze discipline.',
      },
    ],
  },
  {
    id: 'governance',
    number: '9',
    title: 'Governance & immutables',
    blocks: [
      {
        type: 'p',
        text: 'Bonded validators can propose bounded parameter changes. Voting weight follows participation scores. A supermajority is required to pass. Hard rules — supply cap, keyless treasury design, and core consensus safety — are not available for casual amendment.',
      },
      {
        type: 'p',
        text: 'Optional account names provide human-readable handles with a bond and release cooldown, while settlement always remains to cryptographic addresses.',
      },
    ],
  },
  {
    id: 'roadmap',
    number: '10',
    title: 'Roadmap principles',
    blocks: [
      {
        type: 'bullets',
        items: [
          'Deepen multi-chain corridors (in and out) with audited lock and custody paths.',
          'Grow lending markets and LP depth around FALCON and bridged assets.',
          'Expand the chain set only when operational and security bars are met.',
          'Mainnet ceremony with published genesis, freeze pin, and transparent bootstrap wallets.',
          'External audits of freeze scope, bridges, and lending risk parameters.',
        ],
      },
      {
        type: 'p',
        text: 'The north star does not change: FALCON as the centre of a decentralised lending and liquidity network that starts multi-chain and is allowed to grow.',
      },
    ],
  },
  {
    id: 'summary-table',
    number: '11',
    title: 'At a glance',
    blocks: [
      {
        type: 'table',
        headers: ['Item', 'Detail'],
        rows: [
          ['Chain', 'Falcon Ledger'],
          ['Token', 'FALCON (protocol unit; hard-capped supply)'],
          ['Consensus', 'RPCA-style, low latency'],
          ['Signatures', 'Falcon-512 (accounts, validators, P2P)'],
          ['Supply', '200B hard cap · 98% keyless treasury · 2% bootstrap'],
          ['Rewards', 'PoPL — validators and liquidity participants'],
          ['Markets', 'AMM · DEX · collateralised lending'],
          ['Multi-chain', 'Ethereum · BNB Chain · Bitcoin · expandable'],
          ['Testnet ID', '1001'],
          ['Mainnet ID', '1026 (ceremony pack)'],
        ],
      },
    ],
  },
]
