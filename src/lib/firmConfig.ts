import { TOOL_VERSION, type FirmConfigSnapshot } from './types'

export const RISK_SCORE_MATRIX = [
  { min: 3, max: 3, size: 15 },
  { min: 4, max: 5, size: 25 },
  { min: 6, max: 7, size: 40 },
  { min: 8, max: 9, size: 60 },
  { min: 10, max: 12, size: 70 },
] as const

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

export const DEFAULT_MIN_ITEM_COUNT = 15
export const HEADER_SYNONYMS_VERSION = '1.1.0'

export const DEBIT_CREDIT_TREATMENT =
  'Coverage Amount = abs(Debit) if Credit blank/zero; abs(Credit) if Debit blank/zero; both populated requires auditor resolution; value coverage uses absolute amounts.'

export function captureFirmConfigSnapshot(): FirmConfigSnapshot {
  return {
    toolVersion: TOOL_VERSION,
    riskScoreMatrix: RISK_SCORE_MATRIX.map((r) => ({ ...r })),
    valueCoverageTiers: VALUE_COVERAGE_TIERS.map((t) => ({
      tier: t.tier,
      maxInclusive: t.maxInclusive,
      percent: t.percent,
      minimumRequired: t.minimumRequired,
    })),
    minimumItemCount: DEFAULT_MIN_ITEM_COUNT,
    headerSynonymsVersion: HEADER_SYNONYMS_VERSION,
    debitCreditTreatment: DEBIT_CREDIT_TREATMENT,
    capturedAt: new Date().toISOString(),
  }
}
