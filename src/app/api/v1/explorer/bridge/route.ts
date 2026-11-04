// Copyright (c) BEARTEC. All Rights Reserved.
// Proprietary and confidential. See LICENSE. Not licensed under any OSI licence.
// GET /v1/explorer/bridge — Falcon PL explorer API v1 (see /v1/openapi.json).
import { getBridge } from '@/lib/explorer-api/handlers'
import { apiOptions } from '@/lib/explorer-api/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = (req: Request) => getBridge(req)
export const HEAD = GET
export const OPTIONS = () => apiOptions()
