import {
  SAMPLING_RISK_STATEMENT,
  TOOL_VERSION,
  type FirmConfigSnapshot,
  type RiskLevel,
} from './types'

/** Residual / population count at or below this uses small-population coverage guidance. */
export const SMALL_POPULATION_CUTOFF = 30

/** High-risk small population: 60–70% (default 60%). */
export const SMALL_POP_HIGH_RISK_MIN_PCT = 0.6
export const SMALL_POP_HIGH_RISK_MAX_PCT = 0.7
export const SMALL_POP_HIGH_RISK_DEFAULT_PCT = 0.6

/**
 * Path A — base sample size by risk level score.
 * 1 Low = 15, 2 Medium = 30, 3 High = 50, 4 Very high = 70.
 */
export const PATH_A_BASE_SIZES: Record<1 | 2 | 3 | 4, number> = {
  1: 15,
  2: 30,
  3: 50,
  4: 70,
}

/** Path A — expected error / deviation adjustment by score. */
export const PATH_A_EXPECTED_ERROR_ADJUSTMENTS: Record<1 | 2 | 3 | 4, number> = {
  1: 0,
  2: 5,
  3: 10,
  4: 15,
}

/** Path A — other audit evidence adjustment by score (strong evidence reduces size). */
export const PATH_A_EVIDENCE_ADJUSTMENTS: Record<1 | 2 | 3 | 4, number> = {
  1: -10,
  2: 0,
  3: 5,
  4: 10,
}

/** Path A — final size is clamped to this band after adjustments. */
export const PATH_A_MIN_SIZE = 15
export const PATH_A_MAX_SIZE = 70

/**
 * Path B — monetary value-coverage tiers (firm guidance).
 * Sample size is driven by value coverage; item selection is still a separate method.
 */
export const VALUE_COVERAGE_TIERS = [
  { tier: 1, maxInclusive: 500_000, percent: 1, minimumRequired: 0 },
  { tier: 2, maxInclusive: 2_000_000, percent: 0.6, minimumRequired: 500_000 },
  { tier: 3, maxInclusive: 10_000_000, percent: 0.4, minimumRequired: 1_200_000 },
  {
    tier: 4,
    maxInclusive: null as number | null,
    percent: 0.25,
    minimumRequired: 4_000_000,
  },
] as const

/** Large populations: default count-coverage % by risk (used with Path A small-pop band). */
export const LARGE_POP_COVERAGE_BY_RISK: Record<RiskLevel, number> = {
  low: 0.15,
  medium: 0.25,
  high: 0.4,
  veryHigh: 0.5,
}

export const DEFAULT_MIN_ITEM_COUNT = 15
export const DEFAULT_HIGH_VALUE_THRESHOLD = 100_000
export const HEADER_SYNONYMS_VERSION = '2.0.0'

export const DEBIT_CREDIT_TREATMENT =
  'Coverage Amount = abs(Debit) if Credit blank/zero; abs(Credit) if Debit blank/zero; both populated requires auditor resolution; value coverage uses absolute amounts.'

export const ASSERTION_OPTIONS = [
  'Existence / Occurrence',
  'Completeness',
  'Accuracy / Valuation',
  'Cutoff',
  'Classification',
  'Rights and obligations',
  'Presentation and disclosure',
]

export const TEST_TYPE_OPTIONS = [
  'Tests of details — vouching',
  'Tests of details — tracing',
  'Tests of details — other',
  'Tests of controls (attribute)',
]

export const AUDIT_AREA_OPTIONS = [
  'Expenses',
  'Purchases',
  'Sales / Revenue',
  'Cash and bank',
  'Trade receivables',
  'Trade payables',
  'Inventory',
  'Fixed assets',
  'Payroll',
  'Other',
]

export const FILE_ASSEMBLY_DEADLINE_DAYS = 60

export function captureFirmConfigSnapshot(): FirmConfigSnapshot {
  return {
    toolVersion: TOOL_VERSION,
    highValueDefaultThreshold: DEFAULT_HIGH_VALUE_THRESHOLD,
    smallPopulationCutoff: SMALL_POPULATION_CUTOFF,
    smallPopHighRiskMinPct: SMALL_POP_HIGH_RISK_MIN_PCT,
    smallPopHighRiskMaxPct: SMALL_POP_HIGH_RISK_MAX_PCT,
    largePopCoverageByRisk: { ...LARGE_POP_COVERAGE_BY_RISK },
    pathABaseSizes: { ...PATH_A_BASE_SIZES },
    pathAExpectedErrorAdjustments: { ...PATH_A_EXPECTED_ERROR_ADJUSTMENTS },
    pathAEvidenceAdjustments: { ...PATH_A_EVIDENCE_ADJUSTMENTS },
    pathAMinSize: PATH_A_MIN_SIZE,
    pathAMaxSize: PATH_A_MAX_SIZE,
    valueCoverageTiers: VALUE_COVERAGE_TIERS.map((t) => ({
      tier: t.tier,
      maxInclusive: t.maxInclusive,
      percent: t.percent,
      minimumRequired: t.minimumRequired,
    })),
    minimumItemCount: DEFAULT_MIN_ITEM_COUNT,
    assertionOptions: [...ASSERTION_OPTIONS],
    testTypeOptions: [...TEST_TYPE_OPTIONS],
    auditAreaOptions: [...AUDIT_AREA_OPTIONS],
    headerSynonymsVersion: HEADER_SYNONYMS_VERSION,
    debitCreditTreatment: DEBIT_CREDIT_TREATMENT,
    samplingRiskStatement: SAMPLING_RISK_STATEMENT,
    fileAssemblyDeadlineDays: FILE_ASSEMBLY_DEADLINE_DAYS,
    capturedAt: new Date().toISOString(),
  }
}
