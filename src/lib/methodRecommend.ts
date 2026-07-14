import type {
  LedgerTransaction,
  MethodRecommendation,
  RiskLevel,
  SelectionMethod,
} from './types'

function valueSpread(transactions: LedgerTransaction[]): number {
  if (transactions.length < 2) return 0
  const values = transactions.map((t) => Math.abs(t.coverageAmount)).sort((a, b) => a - b)
  const median = values[Math.floor(values.length / 2)] || 1
  const max = values[values.length - 1] ?? 0
  return max / median
}

function concentrationRatio(transactions: LedgerTransaction[], keyFn: (t: LedgerTransaction) => string): number {
  if (!transactions.length) return 0
  const counts = new Map<string, number>()
  for (const t of transactions) {
    const key = keyFn(t) || '(blank)'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const top = Math.max(...counts.values())
  return top / transactions.length
}

function dateSpreadDays(transactions: LedgerTransaction[]): number {
  const times = transactions
    .map((t) => Date.parse(t.date))
    .filter((n) => Number.isFinite(n))
  if (times.length < 2) return 0
  return (Math.max(...times) - Math.min(...times)) / (1000 * 60 * 60 * 24)
}

/**
 * Recommends a non-statistical selection method from population characteristics.
 * Stratification is never recommended as a method — it is population design.
 */
export function recommendMethod(params: {
  residual: LedgerTransaction[]
  riskLevel: RiskLevel
  highValueCount: number
}): MethodRecommendation {
  const { residual, riskLevel, highValueCount } = params
  const n = residual.length
  const reasons: string[] = []

  if (n === 0) {
    return { recommended: 'random', reasons: ['No residual items remain after high-value separation.'] }
  }

  const spread = valueSpread(residual)
  const vendorConc = concentrationRatio(
    residual,
    (t) => t.extras['Vendor'] || t.extras['Vendor Name'] || t.accountNo,
  )
  const days = dateSpreadDays(residual)
  const invalidish = residual.filter(
    (t) => t.looksLikeTotal || t.isZeroOrNegative || !t.date,
  ).length

  if (invalidish / n > 0.1) {
    reasons.push('Material missing/unusual data remains — random reduces selection bias.')
  }
  if (spread > 20) {
    reasons.push('Wide value spread — random (or stratified design first) is preferable to block.')
  }
  if (vendorConc > 0.35) {
    reasons.push('Vendor/account concentration detected — avoid predictable haphazard picks.')
  }
  if (days > 90 && n > 40) {
    reasons.push('Wide date spread — systematic selection can give period coverage if no periodicity risk.')
  }
  if (highValueCount > 0) {
    reasons.push('High-value items already separated for specific testing; residual may use a selection technique.')
  }
  if (riskLevel === 'high' || riskLevel === 'veryHigh') {
    reasons.push('Elevated risk — prefer reproducible random or systematic over haphazard/block.')
  }

  let recommended: SelectionMethod = 'random'

  if (n <= 15) {
    recommended = 'random'
    reasons.push('Small residual — random selection is simplest and reproducible.')
  } else if (days > 90 && n > 40 && spread < 15 && vendorConc < 0.35) {
    recommended = 'systematic'
    reasons.push('Population appears ordered over time with moderate concentration — systematic is suitable.')
  } else if (n > 80 && spread < 8) {
    recommended = 'systematic'
    reasons.push('Larger homogeneous residual — systematic can be efficient.')
  } else {
    recommended = 'random'
    reasons.push('Default recommendation: random selection technique.')
  }

  if (n < 8) {
    reasons.push('Very small residual — consider whether 100% examination is more appropriate than sampling.')
  }

  return { recommended, reasons }
}
