import type {
  LedgerTransaction,
  PathAInputs,
  PathBResult,
  RiskScore,
} from './types'
import { totalCoverageValue } from './coverage'

const PATH_A_MATRIX: Array<{ min: number; max: number; size: number }> = [
  { min: 3, max: 3, size: 15 },
  { min: 4, max: 5, size: 25 },
  { min: 6, max: 7, size: 40 },
  { min: 8, max: 9, size: 60 },
  { min: 10, max: 12, size: 70 },
]

const PATH_B_TIERS = [
  { max: 500_000, percent: 1, minimum: 0, tier: 1 },
  { max: 2_000_000, percent: 0.6, minimum: 500_000, tier: 2 },
  { max: 10_000_000, percent: 0.4, minimum: 1_200_000, tier: 3 },
  { max: Number.POSITIVE_INFINITY, percent: 0.25, minimum: 4_000_000, tier: 4 },
]

export const DEFAULT_MIN_ITEM_COUNT = 15

export function pathASampleSize(
  inputs: PathAInputs,
  transactionCount: number,
): { score: number; calculated: number; finalSize: number } {
  const score = inputs.riskLevel + inputs.expectedError + inputs.otherEvidence
  const row = PATH_A_MATRIX.find((r) => score >= r.min && score <= r.max)
  const calculated = row?.size ?? 15
  const finalSize = Math.min(calculated, transactionCount)
  return { score, calculated, finalSize }
}

export function pathBSizing(
  transactions: LedgerTransaction[],
  minimumItemCount = DEFAULT_MIN_ITEM_COUNT,
): PathBResult {
  const total = totalCoverageValue(transactions)
  const tierRule =
    PATH_B_TIERS.find((t) => total <= t.max) ?? PATH_B_TIERS[PATH_B_TIERS.length - 1]

  const percentValue = Math.ceil(total * tierRule.percent)
  const requiredCoverageValue = Math.max(percentValue, tierRule.minimum)
  const minItems = Math.min(minimumItemCount, transactions.length)

  const sorted = [...transactions].sort(
    (a, b) => b.coverageAmount - a.coverageAmount,
  )

  const provisionalIds: string[] = []
  let running = 0
  for (const item of sorted) {
    provisionalIds.push(item.id)
    running += item.coverageAmount
    if (running >= requiredCoverageValue && provisionalIds.length >= minItems) {
      break
    }
  }

  while (provisionalIds.length < minItems && provisionalIds.length < sorted.length) {
    const next = sorted[provisionalIds.length]
    if (!next) break
    provisionalIds.push(next.id)
  }

  return {
    tier: tierRule.tier,
    coveragePercent: tierRule.percent,
    minimumRequired: tierRule.minimum,
    requiredCoverageValue: Math.min(requiredCoverageValue, total),
    suggestedSampleSize: Math.min(provisionalIds.length, transactions.length),
    provisionalIds,
  }
}

export function scoreLabel(score: RiskScore, kind: keyof PathAInputs): string {
  const labels: Record<keyof PathAInputs, string[]> = {
    riskLevel: ['Low', 'Medium', 'High', 'Very high'],
    expectedError: ['Low', 'Medium', 'High', 'Very high'],
    otherEvidence: ['Strong', 'Normal', 'Weak', 'Very weak / none'],
  }
  return labels[kind][score - 1]
}

export function formatMoney(value: number): string {
  return `Rs. ${value.toLocaleString('en-PK', { maximumFractionDigits: 0 })}`
}
