import type { LedgerTransaction, SelectionMeta, SelectionMethod } from './types'
import { TOOL_VERSION } from './types'
import { hashExtractedData } from './hash'

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

function baseMeta(
  method: SelectionMethod,
  selected: LedgerTransaction[],
  population: LedgerTransaction[],
  extra: Partial<SelectionMeta> = {},
): SelectionMeta {
  return {
    method,
    timestamp: new Date().toISOString(),
    toolVersion: TOOL_VERSION,
    dataHash: hashExtractedData(population),
    selectedIds: selected.map((t) => t.id),
    ...extra,
  }
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
    meta: baseMeta('random', selected, transactions, {
      seed,
      rngAlgorithm: 'mulberry32',
    }),
  }
}

export function selectSystematic(
  transactions: LedgerTransaction[],
  size: number,
  seed = `${Date.now()}`,
  sortBasis = 'ledger order',
): { selected: LedgerTransaction[]; meta: SelectionMeta } {
  const n = transactions.length
  if (size >= n) {
    return {
      selected: [...transactions],
      meta: baseMeta('systematic', transactions, transactions, {
        seed,
        interval: 1,
        randomStart: 0,
        sortBasis,
        patternWarning:
          'Systematic selection of full population is 100% examination.',
      }),
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
    meta: baseMeta('systematic', selected, transactions, {
      seed,
      interval: Number(interval.toFixed(4)),
      randomStart: start,
      sortBasis,
      patternWarning:
        'Systematic selection may follow a periodicity pattern. Review for pattern risk.',
    }),
  }
}

export function selectBlock(
  transactions: LedgerTransaction[],
  size: number,
  startIndex: number,
  rationale: string,
): { selected: LedgerTransaction[]; meta: SelectionMeta } {
  const n = transactions.length
  const maxStart = Math.max(0, n - size)
  if (startIndex < 0 || startIndex > maxStart) {
    throw new Error(
      `Block start must be between 0 and ${maxStart} so the full block of ${size} fits.`,
    )
  }
  const selected = transactions.slice(startIndex, startIndex + size)
  return {
    selected,
    meta: baseMeta('block', selected, transactions, {
      blockStart: startIndex,
      rationale,
      patternWarning:
        'Block selection may not represent the full population. Rationale required.',
    }),
  }
}

export function selectHaphazard(
  transactions: LedgerTransaction[],
  ids: string[],
  biasConfirmed: boolean,
): { selected: LedgerTransaction[]; meta: SelectionMeta } {
  if (!biasConfirmed) {
    throw new Error('Auditor must confirm selection without conscious bias.')
  }
  const unique = [...new Set(ids)]
  if (unique.length !== ids.length) {
    throw new Error('Duplicate selections are not allowed.')
  }
  const map = new Map(transactions.map((t) => [t.id, t]))
  const selected = unique
    .map((id) => map.get(id))
    .filter((t): t is LedgerTransaction => Boolean(t))

  if (selected.length !== unique.length) {
    throw new Error('One or more selected rows are not in the active population.')
  }

  return {
    selected,
    meta: baseMeta('haphazard', selected, transactions, {
      biasConfirmed: true,
    }),
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
    case 'valueCoverage':
      return 'Value-Based Coverage Selection'
  }
}

export function runPathBSelection(
  transactions: LedgerTransaction[],
  coveragePct = 50,
): LedgerTransaction[] {
  if (transactions.length === 0) return []
  const clampedPct = Math.min(100, Math.max(1, coveragePct))
  const total = transactions.reduce((sum, t) => sum + Math.abs(t.coverageAmount), 0)
  const target = (clampedPct / 100) * total

  // Sort: descending by absolute coverageAmount, then High -> Medium -> Low
  const sorted = [...transactions].sort((a, b) => {
    const amtA = Math.abs(a.coverageAmount)
    const amtB = Math.abs(b.coverageAmount)
    if (amtA !== amtB) {
      return amtB - amtA
    }
    const riskVal = (r?: string) => {
      const l = (r || '').toLowerCase()
      if (l.includes('high')) return 3
      if (l.includes('medium') || l.includes('med')) return 2
      return 1
    }
    return riskVal(b.riskLevel) - riskVal(a.riskLevel)
  })

  // Single transaction rule: if top item alone meets target, take only it
  if (sorted.length > 0 && total > 0 && Math.abs(sorted[0].coverageAmount) >= target) {
    return [sorted[0]]
  }

  const selected: LedgerTransaction[] = []
  let running = 0
  for (const item of sorted) {
    selected.push(item)
    running += Math.abs(item.coverageAmount)
    if (running >= target) {
      break
    }
  }
  return selected
}
