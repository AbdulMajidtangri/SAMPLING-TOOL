import type {
  LedgerTransaction,
  PathAInputs,
  PathBResult,
  RiskLevel,
  RiskScore,
  SampleSizePath,
} from './types'
import { totalCoverageValue as coverageSum } from './coverage'
import {
  DEFAULT_MIN_ITEM_COUNT,
  RISK_SCORE_MATRIX,
  VALUE_COVERAGE_TIERS,
} from './firmConfig'

export { DEFAULT_MIN_ITEM_COUNT }

export function formatMoney(value: number): string {
  return `Rs. ${value.toLocaleString('en-PK', { maximumFractionDigits: 0 })}`
}

export function riskLevelLabel(level: RiskLevel): string {
  switch (level) {
    case 'low':
      return 'Low'
    case 'medium':
      return 'Medium'
    case 'high':
      return 'High'
    case 'veryHigh':
      return 'Very high'
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

/**
 * Path A — risk matrix sample size only (§12).
 * Score = risk + expected error + other evidence → matrix size, capped at population.
 * Does not mix Path B / count-coverage % rules.
 */
export function pathASampleSize(
  inputs: PathAInputs,
  transactionCount: number,
  _coveragePercentOverride?: number | null,
): {
  score: number
  matrixSize: number
  coverageSize: number | null
  calculated: number
  finalSize: number
  coveragePercent: number | null
  ruleLabel: string
  isHundredPercent: boolean
} {
  const score = inputs.riskLevel + inputs.expectedError + inputs.otherEvidence
  const row = RISK_SCORE_MATRIX.find((r) => score >= r.min && score <= r.max)
  const matrixSize = row?.size ?? 15
  const finalSize =
    transactionCount > 0 ? Math.min(matrixSize, transactionCount) : 0

  return {
    score,
    matrixSize,
    coverageSize: null,
    calculated: finalSize,
    finalSize,
    coveragePercent: null,
    ruleLabel: `Path A risk matrix (score ${score}) → ${matrixSize} items${
      transactionCount > 0 && matrixSize > transactionCount
        ? ` (capped at population ${transactionCount})`
        : ''
    }`,
    isHundredPercent: transactionCount > 0 && finalSize === transactionCount,
  }
}

/**
 * Path B — value-coverage sizing.
 * Determines how many items are needed to meet monetary coverage guidance.
 * Does not lock which items are selected — selection methods do that.
 */
export function pathBSizing(
  transactions: LedgerTransaction[],
  minimumItemCount = DEFAULT_MIN_ITEM_COUNT,
): PathBResult {
  const total = coverageSum(transactions)
  const tierRule =
    VALUE_COVERAGE_TIERS.find((t) =>
      t.maxInclusive == null ? true : total <= t.maxInclusive,
    ) ?? VALUE_COVERAGE_TIERS[VALUE_COVERAGE_TIERS.length - 1]

  const percentValue = Math.ceil(total * tierRule.percent)
  const tierMinimum = tierRule.tier === 1 ? total : tierRule.minimumRequired
  const requiredCoverageValue = Math.min(Math.max(percentValue, tierMinimum), total)
  const minItems = Math.min(minimumItemCount, transactions.length)

  const sorted = [...transactions].sort(
    (a, b) => Math.abs(b.coverageAmount) - Math.abs(a.coverageAmount),
  )

  const provisionalIds: string[] = []
  let running = 0
  for (const item of sorted) {
    provisionalIds.push(item.id)
    running += Math.abs(item.coverageAmount)
    if (running >= requiredCoverageValue && provisionalIds.length >= minItems) {
      break
    }
  }

  while (provisionalIds.length < minItems && provisionalIds.length < sorted.length) {
    const next = sorted[provisionalIds.length]
    if (!next) break
    provisionalIds.push(next.id)
    running += Math.abs(next.coverageAmount)
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

/** Unified suggested size for the selected path. */
export function suggestSampleSizeForPath(params: {
  path: SampleSizePath
  pathA: PathAInputs
  transactions: LedgerTransaction[]
  coveragePercentOverride?: number | null
}): {
  suggestedSize: number
  coveragePercent: number | null
  ruleLabel: string
  pathADetail: ReturnType<typeof pathASampleSize> | null
  pathBDetail: PathBResult | null
} {
  const { path, pathA, transactions, coveragePercentOverride } = params
  const n = transactions.length

  if (path === 'pathA') {
    const detail = pathASampleSize(pathA, n, coveragePercentOverride)
    return {
      suggestedSize: detail.finalSize,
      coveragePercent: detail.coveragePercent,
      ruleLabel: detail.ruleLabel,
      pathADetail: detail,
      pathBDetail: null,
    }
  }

  const detail = pathBSizing(transactions)
  return {
    suggestedSize: detail.suggestedSampleSize,
    coveragePercent: detail.coveragePercent,
    ruleLabel: `Path B value coverage: Tier ${detail.tier} (${Math.round(detail.coveragePercent * 100)}%) requires ${formatMoney(detail.requiredCoverageValue)} → ${detail.suggestedSampleSize} items (selection method chooses which).`,
    pathADetail: null,
    pathBDetail: detail,
  }
}

export function pathBPostSelectionReview(params: {
  population: LedgerTransaction[]
  selected: LedgerTransaction[]
  requiredCoverageValue: number
}): {
  selectedCount: number
  selectedCoverage: number
  populationCount: number
  populationCoverage: number
  coverageAchievedPercent: number
  untestedCount: number
  untestedValue: number
  belowRequired: boolean
} {
  const { population, selected, requiredCoverageValue } = params
  const populationCoverage = coverageSum(population)
  const selectedCoverage = coverageSum(selected)
  const selectedIds = new Set(selected.map((t) => t.id))
  const untested = population.filter((t) => !selectedIds.has(t.id))
  const untestedValue = coverageSum(untested)
  const coverageAchievedPercent =
    populationCoverage > 0 ? (selectedCoverage / populationCoverage) * 100 : 0

  return {
    selectedCount: selected.length,
    selectedCoverage,
    populationCount: population.length,
    populationCoverage,
    coverageAchievedPercent,
    untestedCount: untested.length,
    untestedValue,
    belowRequired: selectedCoverage + 0.005 < requiredCoverageValue,
  }
}

export function validateSampleSizeOverride(params: {
  proposed: number
  calculated: number
  population: number
  rationale: string
  reviewerApproved: boolean
}): { ok: boolean; error?: string; warning?: string } {
  const { proposed, calculated, population, rationale, reviewerApproved } = params

  if (!Number.isFinite(proposed) || proposed < 1) {
    return { ok: false, error: 'Sample size must be at least 1.' }
  }
  if (proposed > population) {
    return { ok: false, error: 'Sample size cannot exceed population count.' }
  }
  if (!rationale.trim()) {
    return { ok: false, error: 'Sample-size rationale is required (hard stop).' }
  }
  if (proposed < calculated && rationale.trim().length < 20) {
    return {
      ok: false,
      error:
        'Reducing below suggested size requires a stronger rationale (at least 20 characters).',
    }
  }
  if (proposed < calculated && !reviewerApproved) {
    return {
      ok: false,
      error: 'Reducing below suggested size requires reviewer approval.',
    }
  }
  if (proposed !== calculated) {
    return {
      ok: true,
      warning:
        proposed > calculated
          ? 'Sample size increased above suggested size (allowed by professional judgment).'
          : 'Sample size reduced below suggested size with reviewer approval.',
    }
  }
  return { ok: true }
}
