/**
 * Extended ripple-binary-codec definitions for qXRP transaction types absent from
 * upstream definitions.json (ClaimLPReward, ClaimReward, validator txs, …).
 */

import baseEnums from 'ripple-binary-codec/src/enums/definitions.json'
import { XrplDefinitions, coreTypes, type XrplDefinitionsBase } from 'ripple-binary-codec'

type FieldEntry = [string, Record<string, unknown>]
type TxFormatEntry = { name: string; optionality: number }

const QXRP_FIELDS: FieldEntry[] = [
  [
    'ConsensusKey',
    {
      isSerialized: true,
      isSigningField: true,
      isVLEncoded: true,
      nth: 35,
      type: 'Blob',
    },
  ],
  [
    'BondedAmount',
    {
      isSerialized: true,
      isSigningField: true,
      isVLEncoded: false,
      nth: 33,
      type: 'Amount',
    },
  ],
  [
    'Collateral',
    {
      isSerialized: true,
      isSigningField: true,
      isVLEncoded: false,
      nth: 37,
      type: 'Amount',
    },
  ],
  [
    'SlashTarget',
    {
      isSerialized: true,
      isSigningField: true,
      isVLEncoded: false,
      nth: 27,
      type: 'AccountID',
    },
  ],
  [
    'SlashOffense',
    {
      isSerialized: true,
      isSigningField: true,
      isVLEncoded: false,
      nth: 85,
      type: 'UInt32',
    },
  ],
  [
    'SlashEvidence1',
    {
      isSerialized: true,
      isSigningField: true,
      isVLEncoded: true,
      nth: 32,
      type: 'Blob',
    },
  ],
  [
    'SlashEvidence2',
    {
      isSerialized: true,
      isSigningField: true,
      isVLEncoded: true,
      nth: 33,
      type: 'Blob',
    },
  ],
  [
    'ProposalID',
    {
      isSerialized: true,
      isSigningField: true,
      isVLEncoded: false,
      nth: 41,
      type: 'Hash256',
    },
  ],
  [
    'ProposalType',
    {
      isSerialized: true,
      isSigningField: true,
      isVLEncoded: false,
      nth: 86,
      type: 'UInt32',
    },
  ],
  [
    'ProposalValue',
    {
      isSerialized: true,
      isSigningField: true,
      isVLEncoded: false,
      nth: 87,
      type: 'UInt32',
    },
  ],
  // AccountNames (sfName VL #36, sfNameStatus UInt32 #94, sfAccountName Hash256 #42)
  [
    'Name',
    {
      isSerialized: true,
      isSigningField: true,
      isVLEncoded: true,
      nth: 36,
      type: 'Blob',
    },
  ],
  [
    'NameStatus',
    {
      isSerialized: true,
      isSigningField: true,
      isVLEncoded: false,
      nth: 94,
      type: 'UInt32',
    },
  ],
  [
    'AccountName',
    {
      isSerialized: true,
      isSigningField: true,
      isVLEncoded: false,
      nth: 42,
      type: 'Hash256',
    },
  ],
  // ── Bitcoin SPV light client (BitcoinSPVBridge) ─────────────────────────
  // UInt32
  ['BtcChainId', { isSerialized: true, isSigningField: true, isVLEncoded: false, nth: 95, type: 'UInt32' }],
  ['BtcAnchorHeight', { isSerialized: true, isSigningField: true, isVLEncoded: false, nth: 96, type: 'UInt32' }],
  ['BtcTipHeight', { isSerialized: true, isSigningField: true, isVLEncoded: false, nth: 97, type: 'UInt32' }],
  ['BtcMinConfirmations', { isSerialized: true, isSigningField: true, isVLEncoded: false, nth: 98, type: 'UInt32' }],
  ['BtcPaused', { isSerialized: true, isSigningField: true, isVLEncoded: false, nth: 99, type: 'UInt32' }],
  ['BtcHeight', { isSerialized: true, isSigningField: true, isVLEncoded: false, nth: 100, type: 'UInt32' }],
  ['BtcVout', { isSerialized: true, isSigningField: true, isVLEncoded: false, nth: 101, type: 'UInt32' }],
  ['BtcDepositStatus', { isSerialized: true, isSigningField: true, isVLEncoded: false, nth: 102, type: 'UInt32' }],
  ['BtcTxIndex', { isSerialized: true, isSigningField: true, isVLEncoded: false, nth: 103, type: 'UInt32' }],
  ['BtcWithdrawStatus', { isSerialized: true, isSigningField: true, isVLEncoded: false, nth: 104, type: 'UInt32' }],
  ['BtcChallengeEndLedger', { isSerialized: true, isSigningField: true, isVLEncoded: false, nth: 105, type: 'UInt32' }],
  ['BtcWithdrawSeq', { isSerialized: true, isSigningField: true, isVLEncoded: false, nth: 106, type: 'UInt32' }],
  // UInt64
  ['BtcMintCap', { isSerialized: true, isSigningField: true, isVLEncoded: false, nth: 34, type: 'UInt64' }],
  ['BtcTotalMinted', { isSerialized: true, isSigningField: true, isVLEncoded: false, nth: 35, type: 'UInt64' }],
  ['BtcAmount', { isSerialized: true, isSigningField: true, isVLEncoded: false, nth: 36, type: 'UInt64' }],
  ['BtcWithdrawAmount', { isSerialized: true, isSigningField: true, isVLEncoded: false, nth: 37, type: 'UInt64' }],
  // Hash256 / UINT256
  ['BtcBridgeID', { isSerialized: true, isSigningField: true, isVLEncoded: false, nth: 43, type: 'Hash256' }],
  ['BtcAnchorHash', { isSerialized: true, isSigningField: true, isVLEncoded: false, nth: 44, type: 'Hash256' }],
  ['BtcTipHash', { isSerialized: true, isSigningField: true, isVLEncoded: false, nth: 45, type: 'Hash256' }],
  ['BtcTipWork', { isSerialized: true, isSigningField: true, isVLEncoded: false, nth: 46, type: 'Hash256' }],
  ['BtcWatchScriptHash', { isSerialized: true, isSigningField: true, isVLEncoded: false, nth: 47, type: 'Hash256' }],
  ['BtcBlockHash', { isSerialized: true, isSigningField: true, isVLEncoded: false, nth: 48, type: 'Hash256' }],
  ['BtcChainWork', { isSerialized: true, isSigningField: true, isVLEncoded: false, nth: 49, type: 'Hash256' }],
  ['BtcPrevBlockHash', { isSerialized: true, isSigningField: true, isVLEncoded: false, nth: 50, type: 'Hash256' }],
  ['BtcMerkleRoot', { isSerialized: true, isSigningField: true, isVLEncoded: false, nth: 51, type: 'Hash256' }],
  ['BtcTxID', { isSerialized: true, isSigningField: true, isVLEncoded: false, nth: 52, type: 'Hash256' }],
  ['BtcAnchorWork', { isSerialized: true, isSigningField: true, isVLEncoded: false, nth: 53, type: 'Hash256' }],
  ['BtcBurnCommit', { isSerialized: true, isSigningField: true, isVLEncoded: false, nth: 54, type: 'Hash256' }],
  ['BtcWithdrawID', { isSerialized: true, isSigningField: true, isVLEncoded: false, nth: 55, type: 'Hash256' }],
  // Blob / VL
  ['BtcHeaderBytes', { isSerialized: true, isSigningField: true, isVLEncoded: true, nth: 37, type: 'Blob' }],
  ['BtcHeaders', { isSerialized: true, isSigningField: true, isVLEncoded: true, nth: 38, type: 'Blob' }],
  ['BtcRawTx', { isSerialized: true, isSigningField: true, isVLEncoded: true, nth: 39, type: 'Blob' }],
  ['BtcMerkleProof', { isSerialized: true, isSigningField: true, isVLEncoded: true, nth: 40, type: 'Blob' }],
  ['BtcPayoutScript', { isSerialized: true, isSigningField: true, isVLEncoded: true, nth: 41, type: 'Blob' }],
  ['BtcBurnPreimage', { isSerialized: true, isSigningField: true, isVLEncoded: true, nth: 42, type: 'Blob' }],
  ['BtcVaultScript', { isSerialized: true, isSigningField: true, isVLEncoded: true, nth: 43, type: 'Blob' }],
]

const QXRP_TRANSACTION_TYPES: Record<string, number> = {
  ValidatorRegister: 85,
  ValidatorBond: 86,
  ValidatorUnbond: 87,
  ClaimReward: 88,
  ValidatorSlash: 89,
  ReleaseBond: 90,
  GovernanceProposal: 91,
  GovernanceVote: 92,
  ClaimLPReward: 93,
  ClaimAmmLpReward: 94,
  NameSet: 95,
  NameUnbond: 96,
  NameRelease: 97,
  BTCBridgeActivate: 98,
  BTCHeaderSubmit: 99,
  BTCDepositClaim: 110,
  BTCBridgeBurn: 111,
  BTCWithdrawFinalize: 112,
  LoanCollateralDeposit: 83,
  VaultClaimCollateral: 79,
}

const QXRP_TRANSACTION_FORMATS: Record<string, TxFormatEntry[]> = {
  ValidatorRegister: [
    { name: 'PublicKey', optionality: 0 },
    { name: 'ConsensusKey', optionality: 0 },
  ],
  ValidatorBond: [
    { name: 'ConsensusKey', optionality: 0 },
    { name: 'BondedAmount', optionality: 0 },
  ],
  ValidatorUnbond: [{ name: 'ConsensusKey', optionality: 0 }],
  ClaimReward: [{ name: 'ConsensusKey', optionality: 0 }],
  ValidatorSlash: [
    { name: 'SlashTarget', optionality: 0 },
    { name: 'SlashOffense', optionality: 0 },
    { name: 'SlashEvidence1', optionality: 1 },
    { name: 'SlashEvidence2', optionality: 1 },
  ],
  ReleaseBond: [{ name: 'SlashTarget', optionality: 0 }],
  GovernanceProposal: [
    { name: 'ConsensusKey', optionality: 0 },
    { name: 'ProposalType', optionality: 0 },
    { name: 'ProposalValue', optionality: 0 },
  ],
  GovernanceVote: [
    { name: 'ConsensusKey', optionality: 0 },
    { name: 'ProposalID', optionality: 0 },
    { name: 'VoteWeight', optionality: 0 },
  ],
  ClaimLPReward: [{ name: 'VaultID', optionality: 0 }],
  ClaimAmmLpReward: [
    { name: 'Asset', optionality: 0 },
    { name: 'Asset2', optionality: 0 },
  ],
  LoanCollateralDeposit: [
    { name: 'LoanID', optionality: 0 },
    { name: 'Collateral', optionality: 0 },
  ],
  VaultClaimCollateral: [
    { name: 'LoanBrokerID', optionality: 0 },
    { name: 'Amount', optionality: 1 },
  ],
  NameSet: [{ name: 'Name', optionality: 0 }],
  NameUnbond: [{ name: 'Name', optionality: 1 }],
  NameRelease: [{ name: 'Name', optionality: 0 }],
  BTCBridgeActivate: [
    { name: 'BtcChainId', optionality: 0 },
    { name: 'BtcAnchorHash', optionality: 0 },
    { name: 'BtcAnchorHeight', optionality: 0 },
    { name: 'BtcAnchorWork', optionality: 0 },
    { name: 'BtcMinConfirmations', optionality: 0 },
    { name: 'BtcWatchScriptHash', optionality: 0 },
    { name: 'BtcMintCap', optionality: 0 },
    { name: 'BtcHeaderBytes', optionality: 0 },
  ],
  BTCHeaderSubmit: [{ name: 'BtcHeaders', optionality: 0 }],
  BTCDepositClaim: [
    { name: 'Destination', optionality: 0 },
    { name: 'BtcRawTx', optionality: 0 },
    { name: 'BtcMerkleProof', optionality: 0 },
    { name: 'BtcTxIndex', optionality: 0 },
    { name: 'BtcBlockHash', optionality: 0 },
    { name: 'BtcVout', optionality: 0 },
    { name: 'BtcVaultScript', optionality: 1 },
  ],
  BTCBridgeBurn: [
    { name: 'BtcWithdrawAmount', optionality: 0 },
    { name: 'BtcPayoutScript', optionality: 0 },
    { name: 'BtcBurnPreimage', optionality: 0 },
  ],
  BTCWithdrawFinalize: [{ name: 'BtcWithdrawSeq', optionality: 0 }],
}

let cached: XrplDefinitionsBase | null = null

/** Singleton codec definitions including qXRP amendments. */
export function getFalconCodecDefinitions(): XrplDefinitionsBase {
  if (!cached) {
    const enums = structuredClone(baseEnums) as typeof baseEnums & {
      TRANSACTION_TYPES: Record<string, number>
      TRANSACTION_FORMATS: Record<string, TxFormatEntry[]>
      FIELDS: FieldEntry[]
    }

    Object.assign(enums.TRANSACTION_TYPES, QXRP_TRANSACTION_TYPES)
    Object.assign(enums.TRANSACTION_FORMATS, QXRP_TRANSACTION_FORMATS)

    const existing = new Set(enums.FIELDS.map(([name]) => name))
    for (const field of QXRP_FIELDS) {
      if (!existing.has(field[0])) {
        enums.FIELDS.push(field)
        existing.add(field[0])
      }
    }

    cached = new XrplDefinitions(enums, coreTypes)
  }
  return cached
}