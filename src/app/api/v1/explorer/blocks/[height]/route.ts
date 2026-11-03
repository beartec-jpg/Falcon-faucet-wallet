// Copyright (c) BEARTEC. All Rights Reserved.
// Proprietary and confidential. See LICENSE. Not licensed under any OSI licence.
// GET /v1/explorer/blocks/[height] — Falcon PL explorer API v1 (see /v1/openapi.json).
import { blockByHeight } from '@/lib/explorer-api/handlers'
import { apiOptions } from '@/lib/explorer-api/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ height: string }> }

export const GET = async (req: Request, ctx: Ctx) => blockByHeight(req, (await ctx.params).height)
export const HEAD = GET
export const OPTIONS = () => apiOptions()
