import type { LedgerTransaction, PathAInputs, PathBResult, RiskScore } from './types'
import { totalCoverageValue } from './coverage'
import {
  DEFAULT_MIN_ITEM_COUNT,
  RISK_SCORE_MATRIX,
  VALUE_COVERAGE_TIERS,
} from './firmConfig'

export { DEFAULT_MIN_ITEM_COUNT }

export function pathASampleSize(
  inputs: PathAInputs,
  transactionCount: number,
): { score: number; calculated: number; finalSize: number; isHundredPercent: boolean } {
  const score = inputs.riskLevel + inputs.expectedError + inputs.otherEvidence
  const row = RISK_SCORE_MATRIX.find((r) => score >= r.min && score <= r.max)
  const calculated = row?.size ?? 15
  const finalSize = Math.min(calculated, transactionCount)
  return {
    score,
    calculated,
    finalSize,
    isHundredPercent: transactionCount > 0 && finalSize === transactionCount,
  }
}

export function pathBSizing(
  transactions: LedgerTransaction[],
  minimumItemCount = DEFAULT_MIN_ITEM_COUNT,
): PathBResult {
  const total = totalCoverageValue(transactions)
  const tierRule =
    VALUE_COVERAGE_TIERS.find((t) =>
      t.maxInclusive == null ? true : total <= t.maxInclusive,
    ) ?? VALUE_COVERAGE_TIERS[VALUE_COVERAGE_TIERS.length - 1]

  // Floor rule: higher of percent value and tier minimum (tier 1 minimum = full value)
  const percentValue = Math.ceil(total * tierRule.percent)
  const tierMinimum =
    tierRule.tier === 1 ? total : tierRule.minimumRequired
  const requiredCoverageValue = Math.min(
    Math.max(percentValue, tierMinimum),
    total,
  )
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
    running += next.coverageAmount
  }

  return {
    tier: tierRule.tier,
    coveragePercent: tierRule.percent,
    minimumRequired: tierMinimum,
    requiredCoverageValue,
    suggestedSampleSize: Math.min(provisionalIds.length, transactions.length),
    provisionalIds,
    provisionalCoverageValue: running,
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

export function validateSampleSizeOverride(params: {
  proposed: number
  calculated: number
  minimumFloor: number
  population: number
  rationale: string
  reviewerApproved: boolean
}): { ok: boolean; error?: string; warning?: string } {
  const { proposed, calculated, minimumFloor, population, rationale, reviewerApproved } =
    params

  if (!Number.isFinite(proposed) || proposed < 1) {
    return { ok: false, error: 'Sample size must be at least 1.' }
  }
  if (proposed > population) {
    return { ok: false, error: 'Sample size cannot exceed confirmed transaction count.' }
  }
  if (!rationale.trim()) {
    return { ok: false, error: 'Sample-size rationale is required.' }
  }
  if (proposed < calculated && rationale.trim().length < 20) {
    return {
      ok: false,
      error:
        'Reducing below calculated/suggested size requires a stronger rationale (at least 20 characters).',
    }
  }
  if (proposed < minimumFloor && proposed < population && !reviewerApproved) {
    return {
      ok: false,
      error: `Reduction below minimum floor (${minimumFloor}) requires reviewer approval.`,
    }
  }
  if (proposed !== calculated) {
    return {
      ok: true,
      warning:
        proposed > calculated
          ? 'Sample size increased above calculated/suggested size.'
          : 'Sample size reduced below calculated/suggested size.',
    }
  }
  return { ok: true }
}
