export type XrpAmount = string
export type IouAmount = { currency: string; issuer: string; value: string }
export type XrplAmount = XrpAmount | IouAmount