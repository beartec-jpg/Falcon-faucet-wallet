// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
/**
 * https://falcon-fpl.com/install-operator.sh: serves install-operator.sh from the NEWEST published
 * `operator-v*` release of beartec-jpg/falcon-pl-releases. Operator kits are published as
 * NOT-Latest releases (the Latest release is the node release that /install.sh serves), so this
 * looks up releases by tag prefix instead of /releases/latest. Without a match it serves a stub
 * that exits non-zero.
 */
import { RELEASES_REPO } from '@/lib/pl-validators'

export const runtime = 'nodejs'
export const revalidate = 300

const STUB = `#!/usr/bin/env bash
echo "Falcon PL operator kit is not published yet." >&2
echo "See https://falcon-fpl.com/validator (public testnet 2300)." >&2
exit 1
`

type Rel = { tag_name?: string; draft?: boolean }

export async function GET() {
  let text = STUB
  let source = 'stub'
  try {
    const lr = await fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases?per_page=50`, {
      headers: { accept: 'application/vnd.github+json' },
      next: { revalidate: 300 },
    })
    if (lr.ok) {
      const rels = (await lr.json()) as Rel[]
      const tag = rels.find((r) => !r.draft && (r.tag_name || '').startsWith('operator-v'))?.tag_name
      if (tag) {
        const r = await fetch(`https://github.com/${RELEASES_REPO}/releases/download/${tag}/install-operator.sh`, {
          redirect: 'follow',
          next: { revalidate: 300 },
        })
        if (r.ok) {
          const t = await r.text()
          if (t.startsWith('#!/usr/bin/env bash') && t.includes('Falcon PL')) {
            text = t
            source = `release:${tag}`
          }
        }
      }
    }
  } catch {
    /* stub */
  }
  return new Response(text, {
    status: 200,
    headers: {
      'content-type': 'text/x-shellscript; charset=utf-8',
      'cache-control': 'public, s-maxage=300, stale-while-revalidate=600',
      'x-falcon-installer-source': source,
    },
  })
}
