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
  LoanCollateralDeposit: [
    { name: 'LoanID', optionality: 0 },
    { name: 'Collateral', optionality: 0 },
  ],
  VaultClaimCollateral: [
    { name: 'LoanBrokerID', optionality: 0 },
    { name: 'Amount', optionality: 1 },
  ],
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