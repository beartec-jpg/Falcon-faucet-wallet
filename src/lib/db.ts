import { neon, type NeonQueryFunction } from '@neondatabase/serverless'

let sql: NeonQueryFunction<false, false> | null = null

export function isDbConfigured(): boolean {
  return !!(process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim())
}

export function getSql(): NeonQueryFunction<false, false> {
  if (!sql) {
    const url = process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim()
    if (!url) {
      throw new Error('DATABASE_URL is not configured')
    }
    sql = neon(url)
  }
  return sql
}