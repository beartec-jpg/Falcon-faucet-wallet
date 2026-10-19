import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FEEDBACK_CONFIG } from '@/config/feedback'
import { FEEDBACK_IMAGES_DDL } from '@/lib/feedback-store'

describe('feedback schema DDL', () => {
  it('images DDL inlines the size limit (DDL cannot take bind params)', () => {
    expect(FEEDBACK_IMAGES_DDL).toContain(`CHECK (size <= ${FEEDBACK_CONFIG.imageMaxBytes})`)
    expect(FEEDBACK_IMAGES_DDL).not.toMatch(/\$\d/)
  })
  it('no tagged-template DDL in ensure() interpolates values', () => {
    const src = readFileSync('src/lib/feedback-store.ts', 'utf8')
    const ensure = src.slice(src.indexOf('async function ensure()'), src.indexOf('const iso ='))
    for (const m of ensure.matchAll(/sql`([^`]*)`/g)) expect(m[1]).not.toContain('${')
  })
})
