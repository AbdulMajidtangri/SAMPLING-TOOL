import {
  SAMPLING_RISK_STATEMENT,
  TOOL_VERSION,
  type FirmConfigSnapshot,
  type RiskLevel,
} from './types'

/** Residual count at or below this uses small-population coverage guidance. */
export const SMALL_POPULATION_CUTOFF = 30

/** High-risk small population: 60–70% of residual (default 60%). */
export const SMALL_POP_HIGH_RISK_MIN_PCT = 0.6
export const SMALL_POP_HIGH_RISK_MAX_PCT = 0.7
export const SMALL_POP_HIGH_RISK_DEFAULT_PCT = 0.6

/** Large residual populations: default coverage % by risk (auditor may increase). */
export const LARGE_POP_COVERAGE_BY_RISK: Record<RiskLevel, number> = {
  low: 0.15,
  medium: 0.25,
  high: 0.4,
  veryHigh: 0.5,
}

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

/** Days after period end used as default file-assembly lock deadline guidance. */
export const FILE_ASSEMBLY_DEADLINE_DAYS = 60

export function captureFirmConfigSnapshot(): FirmConfigSnapshot {
  return {
    toolVersion: TOOL_VERSION,
    highValueDefaultThreshold: DEFAULT_HIGH_VALUE_THRESHOLD,
    smallPopulationCutoff: SMALL_POPULATION_CUTOFF,
    smallPopHighRiskMinPct: SMALL_POP_HIGH_RISK_MIN_PCT,
    smallPopHighRiskMaxPct: SMALL_POP_HIGH_RISK_MAX_PCT,
    largePopCoverageByRisk: { ...LARGE_POP_COVERAGE_BY_RISK },
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
