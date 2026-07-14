import type { ExclusionSummaryRow, LedgerTransaction, PopulationSummary } from './types'

export function buildPopulationSummary(
  transactions: LedgerTransaction[],
  blanksSkipped = 0,
): PopulationSummary {
  const originalCount = transactions.length
  const originalValue = transactions.reduce(
    (s, t) => s + Math.abs(t.coverageAmount),
    0,
  )

  const excluded = transactions.filter((t) => t.excluded)
  const cleaned = transactions.filter((t) => !t.excluded)

  const reasonMap = new Map<string, { count: number; value: number }>()
  for (const t of excluded) {
    const reason = t.exclusionReason || 'Excluded'
    const cur = reasonMap.get(reason) ?? { count: 0, value: 0 }
    cur.count += 1
    cur.value += Math.abs(t.coverageAmount)
    reasonMap.set(reason, cur)
  }

  const byReason: ExclusionSummaryRow[] = [...reasonMap.entries()].map(
    ([reason, v]) => ({ reason, count: v.count, value: v.value }),
  )

  return {
    originalCount,
    originalValue,
    cleanedCount: cleaned.length,
    cleanedValue: cleaned.reduce((s, t) => s + Math.abs(t.coverageAmount), 0),
    excludedCount: excluded.length,
    excludedValue: excluded.reduce((s, t) => s + Math.abs(t.coverageAmount), 0),
    byReason,
    flaggedTotals: transactions.filter((t) => t.looksLikeTotal).length,
    flaggedOpeningClosing: transactions.filter((t) => t.looksLikeOpeningClosing).length,
    flaggedZeroNegative: transactions.filter((t) => t.isZeroOrNegative).length,
    flaggedDuplicates: transactions.filter((t) => t.isDuplicateVoucher).length,
    flaggedBlanksSkipped: blanksSkipped,
  }
}
