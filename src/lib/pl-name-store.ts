/**
 * Server-side name reservation store (single host file).
 * Vercel uses walletd over HTTP instead of this file.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import os from 'os'
import {
  activationFeeFpl,
  isProtocolName,
  NAME_RESERVE_MS,
  normalizePlName,
} from '@/lib/pl-names'

export type StoredName = {
  name: string
  publicKey: string
  credentialHash?: string
  reservedUntil: number
  activated: boolean
  fee: number
  externalAddrs?: Record<string, string>
}

export type NameView = {
  name: string
  available: boolean
  status: 'free' | 'reserved' | 'activated' | 'invalid' | 'reserved_word' | 'blocked'
  fee: number
  reservedUntil?: number
  publicKey?: string
  externalAddrs?: Record<string, string>
  error?: string
}

const STORE =
  process.env.FALCON_PL_NAME_STORE?.trim() ||
  path.join(os.homedir(), 'falcon-pl-public-testnet-2300/run/name-reservations.json')

function load(): StoredName[] {
  try {
    if (!existsSync(STORE)) return []
    const raw = JSON.parse(readFileSync(STORE, 'utf8')) as StoredName[]
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function save(rows: StoredName[]) {
  mkdirSync(path.dirname(STORE), { recursive: true })
  writeFileSync(STORE, JSON.stringify(rows, null, 2))
}

function live(rows: StoredName[], now = Date.now()): StoredName[] {
  return rows.filter((r) => r.activated || r.reservedUntil > now)
}

function sanitizeExternalAddrs(raw?: Record<string, string>): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    const chain = k.trim().toLowerCase()
    const addr = typeof v === 'string' ? v.trim() : ''
    if (chain && addr && addr.length <= 128) {
      out[chain] = addr
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export function viewName(raw: string, now = Date.now()): NameView {
  const trimmed = raw.trim().toLowerCase()
  if (isProtocolName(trimmed)) {
    return {
      name: trimmed,
      available: false,
      status: 'blocked',
      fee: 0,
      error: 'System name',
    }
  }
  const name = normalizePlName(raw)
  if (!name) {
    return {
      name: trimmed,
      available: false,
      status: 'invalid',
      fee: 0,
      error: 'Invalid name',
    }
  }
  const fee = activationFeeFpl(name)
  const rec = live(load(), now).find((r) => r.name === name)
  if (!rec) {
    return { name, available: true, status: 'free', fee }
  }
  if (rec.activated) {
    return {
      name,
      available: false,
      status: 'activated',
      fee: rec.fee,
      publicKey: rec.publicKey,
      externalAddrs: rec.externalAddrs,
    }
  }
  return {
    name,
    available: false,
    status: 'reserved',
    fee: rec.fee,
    reservedUntil: rec.reservedUntil,
    publicKey: rec.publicKey,
    externalAddrs: rec.externalAddrs,
  }
}

export function reserveName(opts: {
  name: string
  publicKey: string
  credentialHash?: string
  externalAddrs?: Record<string, string>
  now?: number
}): StoredName {
  const now = opts.now ?? Date.now()
  const name = normalizePlName(opts.name)
  if (!name) throw new Error('Invalid name')
  if (!opts.publicKey.trim()) throw new Error('public key required')
  let rows = live(load(), now)
  const existing = rows.find((r) => r.name === name)
  if (existing?.activated) throw new Error('Name already activated')
  if (existing && existing.publicKey !== opts.publicKey) {
    throw new Error('Name is reserved by another wallet')
  }
  if (existing && existing.publicKey === opts.publicKey) return existing
  if (opts.credentialHash && opts.credentialHash !== 'pending') {
    const held = rows.find(
      (r) => !r.activated && r.credentialHash && r.credentialHash === opts.credentialHash,
    )
    if (held && held.name !== name) {
      throw new Error(`This passkey already reserved ${held.name}`)
    }
  }
  const heldKey = rows.find((r) => !r.activated && r.publicKey === opts.publicKey)
  if (heldKey && heldKey.name !== name) {
    throw new Error(`This key already reserved ${heldKey.name}`)
  }
  const cleanAddrs = sanitizeExternalAddrs(opts.externalAddrs)
  const rec: StoredName = {
    name,
    publicKey: opts.publicKey,
    credentialHash: opts.credentialHash,
    reservedUntil: now + NAME_RESERVE_MS,
    activated: false,
    fee: activationFeeFpl(name),
    ...(cleanAddrs ? { externalAddrs: cleanAddrs } : {}),
  }
  rows = rows.filter((r) => r.name !== name)
  rows.push(rec)
  save(rows)
  return rec
}

export function activateName(
  nameRaw: string,
  publicKey: string,
  now = Date.now(),
  externalAddrs?: Record<string, string>,
): StoredName {
  const name = normalizePlName(nameRaw)
  if (!name) throw new Error('Invalid name')
  const rows = live(load(), now)
  const rec = rows.find((r) => r.name === name)
  const mergedAddrs = sanitizeExternalAddrs({
    ...(rec?.externalAddrs ?? {}),
    ...(externalAddrs ?? {}),
  })
  if (rec?.activated) {
    if (rec.publicKey !== publicKey) throw new Error('Name already activated')
    if (mergedAddrs) {
      const updated: StoredName = { ...rec, externalAddrs: mergedAddrs }
      save(rows.filter((r) => r.name !== name).concat(updated))
      return updated
    }
    return rec
  }
  if (rec && rec.publicKey !== publicKey) throw new Error('Name is reserved by another wallet')
  const next: StoredName = {
    name,
    publicKey,
    credentialHash: rec?.credentialHash,
    reservedUntil: 0,
    activated: true,
    fee: rec?.fee ?? activationFeeFpl(name),
    ...(mergedAddrs ? { externalAddrs: mergedAddrs } : {}),
  }
  save(rows.filter((r) => r.name !== name).concat(next))
  return next
}

export function setNameAddrs(
  nameRaw: string,
  publicKey: string,
  externalAddrs: Record<string, string>,
  now = Date.now(),
): StoredName {
  const name = normalizePlName(nameRaw)
  if (!name) throw new Error('Invalid name')
  if (!publicKey.trim()) throw new Error('public key required')
  const rows = live(load(), now)
  const rec = rows.find((r) => r.name === name)
  if (rec && rec.publicKey && rec.publicKey !== publicKey) {
    throw new Error('Name is owned by another wallet')
  }
  const mergedAddrs = sanitizeExternalAddrs({
    ...(rec?.externalAddrs ?? {}),
    ...(externalAddrs ?? {}),
  })
  const next: StoredName = {
    name,
    publicKey,
    credentialHash: rec?.credentialHash,
    reservedUntil: rec?.reservedUntil ?? 0,
    activated: rec?.activated ?? true,
    fee: rec?.fee ?? activationFeeFpl(name),
    ...(mergedAddrs ? { externalAddrs: mergedAddrs } : {}),
  }
  save(rows.filter((r) => r.name !== name).concat(next))
  return next
}

/** Public key on file for a live (reserved or activated) name, or null. */
export function nameKeyOnFile(raw: string, now = Date.now()): string | null {
  const name = normalizePlName(raw)
  if (!name) return null
  const rec = live(load(), now).find((r) => r.name === name)
  return rec?.publicKey?.trim() || null
}
