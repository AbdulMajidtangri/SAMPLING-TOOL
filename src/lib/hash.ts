import type { LedgerTransaction } from './types'

/** Stable hash of mapped transaction extract for reproducibility (not file hash). */
export function hashExtractedData(transactions: LedgerTransaction[]): string {
  const payload = transactions
    .filter((t) => !t.excluded)
    .map(
      (t) =>
        `${t.id}|${t.date}|${t.voucherNo}|${t.accountNo}|${t.description}|${t.debit}|${t.credit}|${t.coverageAmount}`,
    )
    .join('\n')

  let h = 2166136261
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `fnv1a-${(h >>> 0).toString(16).padStart(8, '0')}`
}
