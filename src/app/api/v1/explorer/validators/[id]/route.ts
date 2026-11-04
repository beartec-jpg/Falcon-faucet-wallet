// Copyright (c) BEARTEC. All Rights Reserved.
// Proprietary and confidential. See LICENSE. Not licensed under any OSI licence.
// GET /v1/explorer/validators/[id] — Falcon PL explorer API v1 (see /v1/openapi.json).
import { getValidator } from '@/lib/explorer-api/handlers'
import { apiOptions } from '@/lib/explorer-api/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export const GET = async (req: Request, ctx: Ctx) => getValidator(req, (await ctx.params).id)
export const HEAD = GET
export const OPTIONS = () => apiOptions()
