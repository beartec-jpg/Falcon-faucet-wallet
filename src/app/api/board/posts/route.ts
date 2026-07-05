import { NextRequest, NextResponse } from 'next/server'
import { isOriginAllowed } from '@/lib/origin'
import { getSql, isDbConfigured } from '@/lib/db'
import {
  buildBoardSignMessage,
  isValidBoardAddress,
  verifyBoardSignature,
} from '@/lib/board-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

function err(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status })
}

interface PostRow {
  id: string
  parent_id: string | null
  author_address: string
  body: string
  created_at: string
}

export async function GET(req: NextRequest) {
  if (!isDbConfigured()) {
    return err('Message board database is not configured', 503)
  }

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
  )
  const cursor = req.nextUrl.searchParams.get('cursor')

  const sql = getSql()

  const topLevel = (cursor
    ? await sql`
        SELECT id, parent_id, author_address, body, created_at
        FROM board_posts
        WHERE parent_id IS NULL AND NOT is_deleted AND created_at < ${cursor}::timestamptz
        ORDER BY created_at DESC
        LIMIT ${limit}
      `
    : await sql`
        SELECT id, parent_id, author_address, body, created_at
        FROM board_posts
        WHERE parent_id IS NULL AND NOT is_deleted
        ORDER BY created_at DESC
        LIMIT ${limit}
      `) as PostRow[]

  if (!topLevel.length) {
    return NextResponse.json({ posts: [], nextCursor: null })
  }

  const ids = topLevel.map(p => p.id)
  const replies = await sql`
    SELECT id, parent_id, author_address, body, created_at
    FROM board_posts
    WHERE parent_id = ANY(${ids}::uuid[]) AND NOT is_deleted
    ORDER BY created_at ASC
  ` as PostRow[]

  const repliesByParent = new Map<string, PostRow[]>()
  for (const r of replies) {
    if (!r.parent_id) continue
    const list = repliesByParent.get(r.parent_id) ?? []
    list.push(r)
    repliesByParent.set(r.parent_id, list)
  }

  const posts = topLevel.map(p => ({
    id: p.id,
    authorAddress: p.author_address,
    body: p.body,
    createdAt: p.created_at,
    replies: (repliesByParent.get(p.id) ?? []).map(r => ({
      id: r.id,
      parentId: r.parent_id,
      authorAddress: r.author_address,
      body: r.body,
      createdAt: r.created_at,
    })),
  }))

  const last = topLevel[topLevel.length - 1]
  const nextCursor = topLevel.length === limit ? last.created_at : null

  return NextResponse.json({ posts, nextCursor })
}

export async function POST(req: NextRequest) {
  if (!isOriginAllowed(req)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
  }
  if (!isDbConfigured()) {
    return err('Message board database is not configured', 503)
  }

  let challengeId: string
  let signature: string
  let publicKey: string
  let authorAddress: string

  try {
    const json = await req.json()
    challengeId = String(json.challengeId ?? '').trim()
    signature = String(json.signature ?? '').trim()
    publicKey = String(json.publicKey ?? '').trim()
    authorAddress = String(json.address ?? '').trim()
  } catch {
    return err('Invalid JSON body')
  }

  if (!challengeId || !signature || !publicKey) {
    return err('challengeId, signature, and publicKey are required')
  }
  if (!isValidBoardAddress(authorAddress)) {
    return err('Invalid Falcon address')
  }

  const sql = getSql()

  const challenges = await sql`
    SELECT id, author_address, nonce, parent_id, body, expires_at, consumed_at
    FROM board_challenges
    WHERE id = ${challengeId}::uuid
    LIMIT 1
  `

  if (!challenges.length) return err('Challenge not found', 404)
  const ch = challenges[0]

  if (ch.consumed_at) return err('Challenge already used', 409)
  if (new Date(ch.expires_at).getTime() < Date.now()) return err('Challenge expired', 410)
  if (ch.author_address !== authorAddress) return err('Address does not match challenge', 403)

  const expires = Math.floor(new Date(ch.expires_at).getTime() / 1000)
  const message = buildBoardSignMessage({
    author: ch.author_address,
    nonce: String(ch.nonce),
    expires,
    parentId: ch.parent_id ? String(ch.parent_id) : null,
    body: ch.body,
  })

  const valid = await verifyBoardSignature(message, signature, publicKey, authorAddress)
  if (!valid) return err('Invalid Falcon signature', 401)

  const inserted = await sql`
    INSERT INTO board_posts (parent_id, author_address, body)
    VALUES (${ch.parent_id}::uuid, ${ch.author_address}, ${ch.body})
    RETURNING id, parent_id, author_address, body, created_at
  `

  await sql`
    UPDATE board_challenges
    SET consumed_at = now()
    WHERE id = ${challengeId}::uuid
  `

  const post = inserted[0]
  return NextResponse.json({
    post: {
      id: post.id,
      parentId: post.parent_id,
      authorAddress: post.author_address,
      body: post.body,
      createdAt: post.created_at,
    },
  })
}