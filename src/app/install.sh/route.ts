/**
 * https://falcon-ledger.com/install.sh: serves install-falcon-node.sh from the LATEST PUBLISHED release of
 * beartec-jpg/falcon-pl-releases (the same file that is listed in that release's SHA256SUMS).
 * Before a release is published it serves a stub that explains and exits non-zero, so
 * `curl … | bash` never runs anything half-built.
 */
import { RELEASES_REPO } from '@/lib/pl-validators'

export const runtime = 'nodejs'
export const revalidate = 300

const STUB = `#!/usr/bin/env bash
echo "Falcon PL node binaries are not published yet." >&2
echo "Follow https://falcon-ledger.com/validator for the release (public testnet 2300)." >&2
exit 1
`

export async function GET() {
  const url = `https://github.com/${RELEASES_REPO}/releases/latest/download/install-falcon-node.sh`
  let text = STUB
  let source = 'stub'
  try {
    const r = await fetch(url, { redirect: 'follow', next: { revalidate: 300 } })
    if (r.ok) {
      const t = await r.text()
      if (t.startsWith('#!/usr/bin/env bash') && t.includes('Falcon PL')) {
        text = t
        source = 'release'
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
