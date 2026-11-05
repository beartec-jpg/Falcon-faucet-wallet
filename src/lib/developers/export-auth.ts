// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
// Bearer-token check for the gateway key export. Token: FALCON_CLOUD_EXPORT_TOKEN (>= 32 chars).
import { createHash, timingSafeEqual } from 'crypto'

export function exportToken(): string | null {
  const t = process.env.FALCON_CLOUD_EXPORT_TOKEN
  return t && t.length >= 32 ? t : null
}

export function isExportAuthorized(authHeader: string | null, token: string | null): boolean {
  if (!token || !authHeader?.startsWith('Bearer ')) return false
  const a = createHash('sha256').update(authHeader.slice(7).trim()).digest()
  const b = createHash('sha256').update(token).digest()
  return timingSafeEqual(a, b)
}
