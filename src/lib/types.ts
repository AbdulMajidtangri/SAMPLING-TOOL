export type WizardStep =
  | 'upload'
  | 'worksheet'
  | 'header'
  | 'mapping'
  | 'confirm'
  | 'objective'
  | 'sampleSize'
  | 'selection'
  | 'testing'
  | 'workingPaper'

export type StandardField = 'date' | 'voucherNo' | 'description' | 'debit' | 'credit'

export type MappingConfidence = 'high' | 'medium' | 'low' | 'none'

export type SampleSizePath = 'pathA' | 'pathB'

export type SelectionMethod = 'random' | 'systematic' | 'haphazard' | 'block'

export type RiskScore = 1 | 2 | 3 | 4

export interface WorkbookSheet {
  name: string
  rows: unknown[][]
}

export interface UploadedLedger {
  fileName: string
  sheets: WorkbookSheet[]
}

export interface FieldMapping {
  field: StandardField
  columnIndex: number | null
  confidence: MappingConfidence
  suggestedHeader?: string
}

export interface LedgerTransaction {
  id: string
  rowIndex: number
  date: string
  voucherNo: string
  description: string
  debit: number
  credit: number
  coverageAmount: number
  bothSidesWarning: boolean
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
  timestamp: string
  toolVersion: string
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

export const STANDARD_FIELD_LABELS: Record<StandardField, string> = {
  date: 'Date',
  voucherNo: 'Voucher No',
  description: 'Description',
  debit: 'Debit',
  credit: 'Credit',
}

export const TOOL_VERSION = '1.0.0'
