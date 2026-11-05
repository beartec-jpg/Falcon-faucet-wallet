// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
// Pure rules for Falcon Cloud key lifecycle (Stripe status -> key enabled) and Free self-serve limits.
import { createHash } from 'crypto'

/** Subscription statuses whose keys must stop working. `null` = leave unchanged (e.g. `incomplete`). */
export function keyDisabledForStatus(status: string | null | undefined): boolean | null {
  switch (status) {
    case 'active':
    case 'trialing':
      return false
    case 'canceled':
    case 'unpaid':
    case 'past_due':
    case 'incomplete_expired':
    case 'paused':
      return true
    default:
      return null
  }
}

export const FREE_KEYS_PER_IP_PER_DAY = 3
export const FREE_KEYS_PER_DAY_TOTAL = 500

export function freeMintAllowed(c: { ip: number; total: number }): 'ok' | 'ip' | 'total' {
  if (c.ip >= FREE_KEYS_PER_IP_PER_DAY) return 'ip'
  if (c.total >= FREE_KEYS_PER_DAY_TOTAL) return 'total'
  return 'ok'
}

/** Salted hash so we never store raw IPs. */
export function hashIp(ip: string, salt: string): string {
  return createHash('sha256').update(`falcon-cloud-free:v1:${salt}:${ip}`).digest('hex')
}
