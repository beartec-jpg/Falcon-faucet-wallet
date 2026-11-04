// Copyright (c) BEARTEC. All Rights Reserved.
// Proprietary and confidential. See LICENSE. Not licensed under any OSI licence.
// GET /v1/openapi.json — OpenAPI 3.1 document for the explorer API v1.
import { apiJson, apiOptions, CACHE } from '@/lib/explorer-api/http'
import { openapi } from '@/lib/explorer-api/openapi'

export const runtime = 'nodejs'

export const GET = (req: Request) => apiJson(req, openapi, { cache: CACHE.static })
export const HEAD = GET
export const OPTIONS = () => apiOptions()
