export type WizardStep =
  | 'upload'
  | 'worksheet'
  | 'mapping'
  | 'planning'
  | 'design'
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

export type SelectionMethod = 'random' | 'systematic' | 'haphazard' | 'block'

export type SampleSizePath = 'pathA' | 'pathB'

export type RiskLevel = 'low' | 'medium' | 'high' | 'veryHigh'

export type RiskScore = 1 | 2 | 3 | 4

export type CoverageResolution = 'useDebit' | 'useCredit' | 'useMax' | 'exclude'

export type ReviewStatus = 'draft' | 'prepared' | 'reviewed' | 'locked'

export type StratificationBasis =
  | 'none'
  | 'value'
  | 'account'
  | 'vendor'
  | 'date'
  | 'other'

export interface WorkbookSheet {
  name: string
  rows: unknown[][]
}

export interface UploadedLedger {
  fileName: string
  fileHash: string
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
  looksLikeOpeningClosing: boolean
  isZeroOrNegative: boolean
  isDuplicateVoucher: boolean
  excluded: boolean
  exclusionReason: string
  coverageResolution?: CoverageResolution
  highValue: boolean
  stratumKey: string
  extras: Record<string, string>
}

export interface ExclusionSummaryRow {
  reason: string
  count: number
  value: number
}

export interface PopulationSummary {
  originalCount: number
  originalValue: number
  cleanedCount: number
  cleanedValue: number
  excludedCount: number
  excludedValue: number
  byReason: ExclusionSummaryRow[]
  flaggedTotals: number
  flaggedOpeningClosing: number
  flaggedZeroNegative: number
  flaggedDuplicates: number
  flaggedBlanksSkipped: number
}

export interface EngagementMeta {
  wpReference: string
  clientName: string
  auditArea: string
  period: string
  testType: string
  assertion: string
  objective: string
  samplingUnit: string
  errorDefinition: string
}

export interface DesignInputs {
  highValueThreshold: number
  highValueBasis: string
  stratificationBasis: StratificationBasis
  stratificationOther: string
  riskLevel: RiskLevel
  expectedError: string
  tolerableError: string
  sampleSizePath: SampleSizePath
  pathA: PathAInputs
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

export interface MethodRecommendation {
  recommended: SelectionMethod
  reasons: string[]
}

export interface SampleDesignState {
  recommendedMethod: SelectionMethod
  selectedMethod: SelectionMethod
  methodOverrideReason: string
  methodApproved: boolean
  suggestedSize: number
  confirmedSize: number
  sizeRationale: string
  coveragePercentUsed: number | null
  samplingRiskAccepted: boolean
  sizeReviewerApproved: boolean
  sizeRuleLabel: string
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
}

export interface SignOffState {
  preparedBy: string
  preparedDate: string
  reviewedBy: string
  reviewedDate: string
  reviewStatus: ReviewStatus
  locked: boolean
  lockDate: string
  fileAssemblyDeadline: string
  amendmentNote: string
  amendmentReviewerApproved: boolean
}

export interface FirmConfigSnapshot {
  toolVersion: string
  highValueDefaultThreshold: number
  smallPopulationCutoff: number
  smallPopHighRiskMinPct: number
  smallPopHighRiskMaxPct: number
  largePopCoverageByRisk: Record<RiskLevel, number>
  riskScoreMatrix: Array<{ min: number; max: number; size: number }>
  valueCoverageTiers: Array<{
    tier: number
    maxInclusive: number | null
    percent: number
    minimumRequired: number
  }>
  minimumItemCount: number
  assertionOptions: string[]
  testTypeOptions: string[]
  auditAreaOptions: string[]
  headerSynonymsVersion: string
  debitCreditTreatment: string
  samplingRiskStatement: string
  fileAssemblyDeadlineDays: number
  capturedAt: string
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

export const MAPPING_FIELD_ORDER: StandardField[] = [
  'date',
  'voucherNo',
  'description',
  'debit',
  'credit',
  'accountNo',
  'amount',
]

export const POSITIONAL_FIELD_ORDER: StandardField[] = [
  'date',
  'voucherNo',
  'description',
  'debit',
  'credit',
]

export const CORE_REQUIRED_FIELDS: StandardField[] = [
  'date',
  'voucherNo',
  'description',
  'debit',
  'credit',
]

export const TOOL_VERSION = '2.0.0'

export const SAMPLING_RISK_STATEMENT =
  'Because a non-statistical sample is used, sampling risk is addressed through professional judgment, population design, sample size rationale, and review approval — not statistical confidence measurement.'
