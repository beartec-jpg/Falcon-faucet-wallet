import { NextRequest, NextResponse } from 'next/server'
import { isOriginAllowed } from '@/lib/origin'
import { getSql, isDbConfigured } from '@/lib/db'
import {
  BOARD_BODY_MAX,
  BOARD_CHALLENGE_TTL_SEC,
  BOARD_POSTS_PER_HOUR,
} from '@/lib/board-constants'
import {
  buildBoardSignMessage,
  isValidBoardAddress,
  normalizeBoardBody,
} from '@/lib/board-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function err(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status })
}

export async function POST(req: NextRequest) {
  if (!isOriginAllowed(req)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
  }
  if (!isDbConfigured()) {
    return err('Message board database is not configured', 503)
  }

  let authorAddress: string
  let body: string
  let parentId: string | null = null

  try {
    const json = await req.json()
    authorAddress = String(json.address ?? '').trim()
    body = String(json.body ?? '')
    if (json.parentId != null && json.parentId !== '') {
      parentId = String(json.parentId).trim()
    }
  } catch {
    return err('Invalid JSON body')
  }

  if (!isValidBoardAddress(authorAddress)) {
    return err('Invalid Falcon address')
  }

  const normalized = normalizeBoardBody(body)
  if (!normalized) return err('Message cannot be empty')
  if (normalized.length > BOARD_BODY_MAX) {
    return err(`Message too long (max ${BOARD_BODY_MAX} characters)`)
  }

  const sql = getSql()

  if (parentId) {
    const parents = await sql`
      SELECT id FROM board_posts
      WHERE id = ${parentId}::uuid AND parent_id IS NULL AND NOT is_deleted
      LIMIT 1
    `
    if (!parents.length) {
      return err('Parent post not found')
    }
  }

  const recent = await sql`
    SELECT COUNT(*)::int AS count FROM board_posts
    WHERE author_address = ${authorAddress}
      AND created_at > now() - interval '1 hour'
  `
  if ((recent[0]?.count ?? 0) >= BOARD_POSTS_PER_HOUR) {
    return err('Rate limit: max 10 posts per hour per wallet', 429)
  }

  const expires = Math.floor(Date.now() / 1000) + BOARD_CHALLENGE_TTL_SEC
  const expiresAt = new Date(expires * 1000).toISOString()

  const rows = await sql`
    INSERT INTO board_challenges (author_address, parent_id, body, expires_at)
    VALUES (
      ${authorAddress},
      ${parentId}::uuid,
      ${normalized},
      ${expiresAt}::timestamptz
    )
    RETURNING id, nonce, expires_at
  `

  const row = rows[0]
  const nonce = String(row.nonce)
  const message = buildBoardSignMessage({
    author: authorAddress,
    nonce,
    expires,
    parentId,
    body: normalized,
  })

  return NextResponse.json({
    challengeId: row.id,
    nonce,
    message,
    expires,
    expiresAt: row.expires_at,
  })
}