import type { LedgerTransaction, SelectionMeta, SelectionMethod } from './types'
import { TOOL_VERSION } from './types'

function mulberry32(seed: number) {
  return function next() {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashSeed(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function selectRandom(
  transactions: LedgerTransaction[],
  size: number,
  seed = `${Date.now()}`,
): { selected: LedgerTransaction[]; meta: SelectionMeta } {
  const rng = mulberry32(hashSeed(seed))
  const copy = [...transactions]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  const selected = copy.slice(0, size)
  return {
    selected,
    meta: {
      method: 'random',
      seed,
      rngAlgorithm: 'mulberry32',
      timestamp: new Date().toISOString(),
      toolVersion: TOOL_VERSION,
    },
  }
}

export function selectSystematic(
  transactions: LedgerTransaction[],
  size: number,
  seed = `${Date.now()}`,
): { selected: LedgerTransaction[]; meta: SelectionMeta } {
  const n = transactions.length
  if (size >= n) {
    return {
      selected: [...transactions],
      meta: {
        method: 'systematic',
        seed,
        interval: 1,
        randomStart: 0,
        sortBasis: 'ledger order',
        timestamp: new Date().toISOString(),
        toolVersion: TOOL_VERSION,
      },
    }
  }

  const interval = n / size
  const rng = mulberry32(hashSeed(seed))
  const start = Math.floor(rng() * interval)
  const selected: LedgerTransaction[] = []
  const used = new Set<number>()

  for (let i = 0; i < size; i++) {
    let index = Math.floor(start + i * interval) % n
    let guard = 0
    while (used.has(index) && guard < n) {
      index = (index + 1) % n
      guard += 1
    }
    used.add(index)
    selected.push(transactions[index])
  }

  return {
    selected,
    meta: {
      method: 'systematic',
      seed,
      interval: Number(interval.toFixed(4)),
      randomStart: start,
      sortBasis: 'ledger order',
      timestamp: new Date().toISOString(),
      toolVersion: TOOL_VERSION,
    },
  }
}

export function selectBlock(
  transactions: LedgerTransaction[],
  size: number,
  startIndex: number,
): { selected: LedgerTransaction[]; meta: SelectionMeta } {
  const n = transactions.length
  const start = Math.max(0, Math.min(startIndex, Math.max(0, n - size)))
  const selected = transactions.slice(start, start + size)
  return {
    selected,
    meta: {
      method: 'block',
      blockStart: start,
      rationale: 'Continuous block selected by auditor.',
      timestamp: new Date().toISOString(),
      toolVersion: TOOL_VERSION,
    },
  }
}

export function selectHaphazard(
  transactions: LedgerTransaction[],
  ids: string[],
): { selected: LedgerTransaction[]; meta: SelectionMeta } {
  const map = new Map(transactions.map((t) => [t.id, t]))
  const selected = ids
    .map((id) => map.get(id))
    .filter((t): t is LedgerTransaction => Boolean(t))

  return {
    selected,
    meta: {
      method: 'haphazard',
      biasConfirmed: true,
      timestamp: new Date().toISOString(),
      toolVersion: TOOL_VERSION,
    },
  }
}

export function methodLabel(method: SelectionMethod): string {
  switch (method) {
    case 'random':
      return 'Random'
    case 'systematic':
      return 'Systematic'
    case 'haphazard':
      return 'Haphazard / Manual'
    case 'block':
      return 'Block'
  }
}
