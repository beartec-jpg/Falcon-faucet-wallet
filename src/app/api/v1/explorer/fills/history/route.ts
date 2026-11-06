// Copyright (c) BEARTEC. All Rights Reserved.
// GET /v1/explorer/fills/history — durable fill index (not full archive).
import { listFillHistory } from '@/lib/explorer-api/handlers'
import { apiOptions } from '@/lib/explorer-api/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = (req: Request) => listFillHistory(req)
export const HEAD = GET
export const OPTIONS = () => apiOptions()
