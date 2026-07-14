import type { LedgerTransaction } from './types'

export function separateHighValue(
  transactions: LedgerTransaction[],
  threshold: number,
): { highValue: LedgerTransaction[]; residual: LedgerTransaction[] } {
  const highValue: LedgerTransaction[] = []
  const residual: LedgerTransaction[] = []
  for (const t of transactions) {
    if (t.excluded) continue
    if (Math.abs(t.coverageAmount) >= threshold && threshold > 0) {
      highValue.push({ ...t, highValue: true })
    } else {
      residual.push({ ...t, highValue: false })
    }
  }
  return { highValue, residual }
}

export function applyStratumKeys(
  transactions: LedgerTransaction[],
  basis: 'none' | 'value' | 'account' | 'vendor' | 'date' | 'other',
  otherKey?: string,
): LedgerTransaction[] {
  if (basis === 'none') {
    return transactions.map((t) => ({ ...t, stratumKey: 'all' }))
  }

  return transactions.map((t) => {
    let key = 'all'
    if (basis === 'account') key = t.accountNo || '(blank account)'
    else if (basis === 'vendor') {
      key =
        t.extras['Vendor'] ||
        t.extras['Vendor Name'] ||
        t.extras['Supplier'] ||
        t.accountNo ||
        '(blank vendor)'
    } else if (basis === 'date') {
      key = t.date ? t.date.slice(0, 7) : '(blank date)'
    } else if (basis === 'value') {
      const v = Math.abs(t.coverageAmount)
      if (v >= 500_000) key = 'Value ≥ 500,000'
      else if (v >= 100_000) key = 'Value 100,000–499,999'
      else if (v >= 25_000) key = 'Value 25,000–99,999'
      else key = 'Value < 25,000'
    } else if (basis === 'other') {
      key = (otherKey && t.extras[otherKey]) || t.extras[otherKey || ''] || 'other'
    }
    return { ...t, stratumKey: key }
  })
}

export function stratumSummary(
  transactions: LedgerTransaction[],
): Array<{ key: string; count: number; value: number }> {
  const map = new Map<string, { count: number; value: number }>()
  for (const t of transactions) {
    const key = t.stratumKey || 'all'
    const cur = map.get(key) ?? { count: 0, value: 0 }
    cur.count += 1
    cur.value += Math.abs(t.coverageAmount)
    map.set(key, cur)
  }
  return [...map.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.value - a.value)
}
