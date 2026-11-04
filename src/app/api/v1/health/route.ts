// Copyright (c) BEARTEC. All Rights Reserved.
// Proprietary and confidential. See LICENSE. Not licensed under any OSI licence.
// GET /v1/health — Falcon PL explorer API v1 (see /v1/openapi.json).
import { health } from '@/lib/explorer-api/handlers'
import { apiOptions } from '@/lib/explorer-api/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = (req: Request) => health(req)
export const HEAD = GET
export const OPTIONS = () => apiOptions()
