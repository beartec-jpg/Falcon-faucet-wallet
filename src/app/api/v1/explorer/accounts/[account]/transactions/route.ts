// Copyright (c) BEARTEC. All Rights Reserved.
// Proprietary and confidential. See LICENSE. Not licensed under any OSI licence.
// GET /v1/explorer/accounts/[account]/transactions — Falcon PL explorer API v1 (see /v1/openapi.json).
import { getAccountTxs } from '@/lib/explorer-api/handlers'
import { apiOptions } from '@/lib/explorer-api/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ account: string }> }

export const GET = async (req: Request, ctx: Ctx) => getAccountTxs(req, (await ctx.params).account)
export const HEAD = GET
export const OPTIONS = () => apiOptions()
