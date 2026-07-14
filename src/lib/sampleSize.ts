import type { LedgerTransaction, RiskLevel } from './types'
import {
  LARGE_POP_COVERAGE_BY_RISK,
  SMALL_POP_HIGH_RISK_DEFAULT_PCT,
  SMALL_POP_HIGH_RISK_MAX_PCT,
  SMALL_POP_HIGH_RISK_MIN_PCT,
  SMALL_POPULATION_CUTOFF,
} from './firmConfig'

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

/**
 * Suggest residual sample size from firm coverage guidance.
 * ≤30 + high/veryHigh → 60–70% (default 60%).
 * ≤30 + other risk → lower %.
 * >30 → large-pop % by risk, ceil.
 */
export function suggestResidualSampleSize(params: {
  residualCount: number
  riskLevel: RiskLevel
  coveragePercentOverride?: number | null
}): {
  suggestedSize: number
  coveragePercent: number
  ruleLabel: string
  isHundredPercent: boolean
} {
  const { residualCount, riskLevel, coveragePercentOverride } = params
  if (residualCount <= 0) {
    return {
      suggestedSize: 0,
      coveragePercent: 0,
      ruleLabel: 'No residual population',
      isHundredPercent: false,
    }
  }

  let coveragePercent: number
  let ruleLabel: string

  if (residualCount <= SMALL_POPULATION_CUTOFF) {
    if (riskLevel === 'high' || riskLevel === 'veryHigh') {
      coveragePercent =
        coveragePercentOverride != null
          ? Math.min(
              SMALL_POP_HIGH_RISK_MAX_PCT,
              Math.max(SMALL_POP_HIGH_RISK_MIN_PCT, coveragePercentOverride),
            )
          : SMALL_POP_HIGH_RISK_DEFAULT_PCT
      ruleLabel = `Small population (≤${SMALL_POPULATION_CUTOFF}), high risk: ${Math.round(coveragePercent * 100)}% of residual (band ${Math.round(SMALL_POP_HIGH_RISK_MIN_PCT * 100)}–${Math.round(SMALL_POP_HIGH_RISK_MAX_PCT * 100)}%)`
    } else if (riskLevel === 'medium') {
      coveragePercent = coveragePercentOverride ?? 0.4
      ruleLabel = `Small population (≤${SMALL_POPULATION_CUTOFF}), medium risk: ${Math.round(coveragePercent * 100)}% of residual`
    } else {
      coveragePercent = coveragePercentOverride ?? 0.25
      ruleLabel = `Small population (≤${SMALL_POPULATION_CUTOFF}), low risk: ${Math.round(coveragePercent * 100)}% of residual`
    }
  } else {
    coveragePercent =
      coveragePercentOverride ?? LARGE_POP_COVERAGE_BY_RISK[riskLevel]
    ruleLabel = `Large population (>${SMALL_POPULATION_CUTOFF}): ${Math.round(coveragePercent * 100)}% of residual (${riskLevelLabel(riskLevel)} risk)`
  }

  const suggestedSize = Math.min(
    residualCount,
    Math.max(1, Math.ceil(residualCount * coveragePercent)),
  )

  return {
    suggestedSize,
    coveragePercent,
    ruleLabel,
    isHundredPercent: suggestedSize === residualCount,
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
    return { ok: false, error: 'Sample size cannot exceed residual population count.' }
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
      error: 'Reducing below suggested coverage requires reviewer approval.',
    }
  }
  if (proposed !== calculated) {
    return {
      ok: true,
      warning:
        proposed > calculated
          ? 'Sample size increased above suggested coverage (allowed by professional judgment).'
          : 'Sample size reduced below suggested coverage with reviewer approval.',
    }
  }
  return { ok: true }
}

export function totalCoverageValue(transactions: LedgerTransaction[]): number {
  return transactions.reduce((sum, t) => sum + Math.abs(t.coverageAmount), 0)
}
