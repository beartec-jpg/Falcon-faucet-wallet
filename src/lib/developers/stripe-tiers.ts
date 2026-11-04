// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
/**
 * Stripe-billed Falcon Cloud tiers (mirrors beartec-uk/Crypto shared/stripeTiers.ts).
 * Free has no Stripe product. Prices come from TIERS in ./content (the pricing page).
 * Checkout pins the exact price via env vars, falling back to the live price ids
 * created on the beartec.uk account (acct_1RzHcxFpNHlFwPZA) on 4 Nov 2026, so a
 * dashboard change to a product's default price can't silently change what is charged.
 */
import { TIERS } from './content'

export type PaidTierId = 'builder' | 'scale'

export interface PaidTierConfig {
  tier: PaidTierId
  name: string
  priceEnvVar: 'STRIPE_PRICE_FALCON_BUILDER' | 'STRIPE_PRICE_FALCON_SCALE'
  pinnedPriceId: string
  productId: string
  amountPence: number
}

const pence = (id: PaidTierId) => (TIERS.find((t) => t.id === id)?.priceGbpMonthly ?? 0) * 100

export const PAID_TIER_CONFIG: Record<PaidTierId, PaidTierConfig> = {
  builder: {
    tier: 'builder', name: 'Falcon Cloud Builder', priceEnvVar: 'STRIPE_PRICE_FALCON_BUILDER',
    pinnedPriceId: 'price_1UXyStFpNHlFwPZA59Apabgo', productId: 'prod_VZ6gq52IeeR7iB', amountPence: pence('builder'),
  },
  scale: {
    tier: 'scale', name: 'Falcon Cloud Scale', priceEnvVar: 'STRIPE_PRICE_FALCON_SCALE',
    pinnedPriceId: 'price_1UXySvFpNHlFwPZA2c5aGWN5', productId: 'prod_VZ6giyl5xH6nnv', amountPence: pence('scale'),
  },
}

export const PAID_TIER_IDS = Object.keys(PAID_TIER_CONFIG) as PaidTierId[]

/** Path of the Falcon PL Terms of Use (with the Falcon Cloud schedule). */
export const FALCON_TERMS_PATH = '/terms-of-use'

type Env = Record<string, string | undefined>

export function normalizePaidTier(tier: unknown): PaidTierId | null {
  if (typeof tier !== 'string') return null
  const t = tier.trim().toLowerCase()
  return t === 'builder' || t === 'scale' ? t : null
}

export function getPriceId(tier: unknown, env: Env = process.env): string | null {
  const t = normalizePaidTier(tier)
  if (!t) return null
  const v = env[PAID_TIER_CONFIG[t].priceEnvVar]?.trim()
  return v && v.startsWith('price_') ? v : PAID_TIER_CONFIG[t].pinnedPriceId
}

/** Tier for a Stripe subscription: pinned price id, then product id, then metadata.tier. */
export function tierFromSubscription(sub: any, env: Env = process.env): PaidTierId | null {
  for (const item of sub?.items?.data ?? []) {
    const price = item?.price
    for (const t of PAID_TIER_IDS) {
      if (price?.id && (price.id === getPriceId(t, env) || price.id === PAID_TIER_CONFIG[t].pinnedPriceId)) return t
      const prod = typeof price?.product === 'string' ? price.product : price?.product?.id
      if (prod === PAID_TIER_CONFIG[t].productId) return t
    }
  }
  return normalizePaidTier(sub?.metadata?.tier)
}
