// Copyright (c) BEARTEC. All Rights Reserved.
import { getFillHistoryCoverage } from '@/lib/explorer-api/handlers'
import { apiOptions } from '@/lib/explorer-api/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = (req: Request) => getFillHistoryCoverage(req)
export const HEAD = GET
export const OPTIONS = () => apiOptions()
