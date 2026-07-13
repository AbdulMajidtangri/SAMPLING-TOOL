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
  accountNo: string
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
  date: 'Date (optional)',
  voucherNo: 'Voucher No (optional)',
  accountNo: 'Account No (optional)',
  description: 'Description (optional)',
  debit: 'Debit (optional)',
  credit: 'Credit (optional)',
  amount: 'Amount (optional — use if no Debit/Credit)',
}

export const OPTIONAL_FIELDS: StandardField[] = [
  'date',
  'voucherNo',
  'accountNo',
  'description',
  'debit',
  'credit',
  'amount',
]

export const TOOL_VERSION = '1.0.0'
