export type WizardStep =
  | 'upload'
  | 'worksheet'
  | 'mapping'
  | 'confirm'
  | 'objective'
  | 'sampleSize'
  | 'selection'
  | 'testing'
  | 'workingPaper'

export type StandardField =
  | 'date'
  | 'voucherNo'
  | 'accountNo'
  | 'description'
  | 'debit'
  | 'credit'
  | 'amount'

export type MappingConfidence = 'high' | 'medium' | 'low' | 'none'

export type SampleSizePath = 'pathA' | 'pathB'

export type SelectionMethod = 'random' | 'systematic' | 'haphazard' | 'block'

export type RiskScore = 1 | 2 | 3 | 4

export type CoverageResolution = 'useDebit' | 'useCredit' | 'useMax' | 'exclude'

export interface WorkbookSheet {
  name: string
  rows: unknown[][]
}

export interface UploadedLedger {
  fileName: string
  sheets: WorkbookSheet[]
}

export interface MappingCandidate {
  columnIndex: number
  header: string
  score: number
  confidence: MappingConfidence
}

export interface FieldMappingState {
  columnIndex: number | null
  confidence: MappingConfidence
  candidates: MappingCandidate[]
  needsAuditorChoice: boolean
}

export interface LedgerTransaction {
  id: string
  rowIndex: number
  date: string
  voucherNo: string
  accountNo: string
  description: string
  debit: number
  credit: number
  amountRaw: number
  coverageAmount: number
  bothSidesWarning: boolean
  needsCoverageResolution: boolean
  isRepeatedHeader: boolean
  looksLikeTotal: boolean
  excluded: boolean
  exclusionReason: string
  coverageResolution?: CoverageResolution
  extras: Record<string, string>
}

export interface PathAInputs {
  riskLevel: RiskScore
  expectedError: RiskScore
  otherEvidence: RiskScore
}

export interface PathBResult {
  tier: number
  coveragePercent: number
  minimumRequired: number
  requiredCoverageValue: number
  suggestedSampleSize: number
  provisionalIds: string[]
  provisionalCoverageValue: number
}

export interface SelectionMeta {
  method: SelectionMethod
  seed?: string
  rngAlgorithm?: string
  interval?: number
  randomStart?: number
  sortBasis?: string
  blockStart?: number
  biasConfirmed?: boolean
  rationale?: string
  patternWarning?: string
  timestamp: string
  toolVersion: string
  dataHash: string
  selectedIds: string[]
}

export interface TestingResult {
  transactionId: string
  tested: boolean
  exception: boolean
  exceptionValue: number
  nature: string
  notes: string
}

export interface EvaluationState {
  exceptionCount: number
  exceptionValue: number
  natureSummary: string
  widerIssue: 'yes' | 'no' | 'unclear'
  furtherTesting: 'yes' | 'no'
  conclusion: string
  reviewerComments: string
  untestedRemainderBasis: string
}

export interface FirmConfigSnapshot {
  toolVersion: string
  riskScoreMatrix: Array<{ min: number; max: number; size: number }>
  valueCoverageTiers: Array<{
    tier: number
    maxInclusive: number | null
    percent: number
    minimumRequired: number
  }>
  minimumItemCount: number
  headerSynonymsVersion: string
  debitCreditTreatment: string
  capturedAt: string
}

export interface EngagementMeta {
  wpReference: string
  clientName: string
  auditArea: string
  period: string
}

export const STANDARD_FIELD_LABELS: Record<StandardField, string> = {
  date: 'Date',
  voucherNo: 'Voucher No',
  accountNo: 'Account No (optional / alt. ID)',
  description: 'Description',
  debit: 'Debit',
  credit: 'Credit',
  amount: 'Amount (alt. if no Debit/Credit)',
}

/**
 * UI + auto-suggest processing order.
 * Core ledger columns first, then optional alternatives.
 */
export const MAPPING_FIELD_ORDER: StandardField[] = [
  'date',
  'voucherNo',
  'description',
  'debit',
  'credit',
  'accountNo',
  'amount',
]

/**
 * Left-to-right positional fallback when a column is still unmapped
 * (e.g. generic headers). Matches the usual ledger layout.
 */
export const POSITIONAL_FIELD_ORDER: StandardField[] = [
  'date',
  'voucherNo',
  'description',
  'debit',
  'credit',
]

/** Brief-required core fields (Account No / Amount are allowed alternatives). */
export const CORE_REQUIRED_FIELDS: StandardField[] = [
  'date',
  'voucherNo',
  'description',
  'debit',
  'credit',
]

export const TOOL_VERSION = '1.1.0'
