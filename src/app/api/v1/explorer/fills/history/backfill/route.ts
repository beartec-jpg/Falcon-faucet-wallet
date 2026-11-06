// Copyright (c) BEARTEC. All Rights Reserved.
// POST /v1/explorer/fills/history/backfill — ingest node RECENT_FILLS into durable index.
import { backfillFillHistory } from '@/lib/explorer-api/handlers'
import { apiOptions } from '@/lib/explorer-api/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = (req: Request) => backfillFillHistory(req)
export const OPTIONS = () => apiOptions()
