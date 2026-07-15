import { useMemo, useRef, useState } from 'react'
import {
  activeTransactions,
  buildTransactions,
  resolveTransactionCoverage,
  totalCoverageValue,
  unresolvedBothSides,
} from './lib/coverage'
import { cellToText, parseLedgerFile } from './lib/excel'
import {
  detectDataEnd,
  detectHeaderRow,
  hasDateLikeHeader,
  suggestMappings,
  validateRequiredMappings,
} from './lib/headers'
import {
  formatMoney,
  pathBPostSelectionReview,
  riskLevelLabel,
  scoreLabel,
  suggestSampleSizeForPath,
  validateSampleSizeOverride,
} from './lib/sampleSize'
import {
  methodLabel,
  selectBlock,
  selectHaphazard,
  selectRandom,
  selectSystematic,
} from './lib/selection'
import {
  ASSERTION_OPTIONS,
  AUDIT_AREA_OPTIONS,
  DEFAULT_HIGH_VALUE_THRESHOLD,
  FILE_ASSEMBLY_DEADLINE_DAYS,
  SMALL_POP_HIGH_RISK_DEFAULT_PCT,
  SMALL_POP_HIGH_RISK_MAX_PCT,
  SMALL_POP_HIGH_RISK_MIN_PCT,
  TEST_TYPE_OPTIONS,
  captureFirmConfigSnapshot,
} from './lib/firmConfig'
import { recommendMethod } from './lib/methodRecommend'
import { buildPopulationSummary } from './lib/populationSummary'
import { hashExtractedData } from './lib/hash'
import type {
  CoverageResolution,
  DesignInputs,
  EngagementMeta,
  EvaluationState,
  FieldMappingState,
  FirmConfigSnapshot,
  LedgerTransaction,
  MappingConfidence,
  PopulationSummary,
  RiskLevel,
  RiskScore,
  SampleDesignState,
  SelectionMeta,
  SelectionMethod,
  SignOffState,
  StandardField,
  TestingResult,
  UploadedLedger,
  WizardStep,
} from './lib/types'
import {
  DATE_OPTIONAL_LABEL,
  MAPPING_FIELD_ORDER,
  SAMPLING_RISK_STATEMENT,
  STANDARD_FIELD_LABELS,
  TOOL_VERSION,
} from './lib/types'
import './App.css'

const STEPS: WizardStep[] = [
  'upload',
  'worksheet',
  'mapping',
  'confirm',
  'planning',
  'design',
  'selection',
  'testing',
  'workingPaper',
]

const STEP_TITLES: Record<WizardStep, string> = {
  upload: 'Upload ledger',
  worksheet: 'Choose worksheet',
  mapping: 'Headers & column mapping',
  confirm: 'Confirm population',
  planning: 'Planning inputs',
  design: 'Method, size & sampling risk',
  selection: 'Generate sample',
  testing: 'Testing results',
  workingPaper: 'Working paper',
}

const DEFAULT_SIZE_RATIONALE =
  'Accepted suggested population coverage per firm guidance.'
const DEFAULT_SAMPLING_UNIT = 'Individual expense voucher / document'
const DEFAULT_HIGH_VALUE_BASIS =
  'Absolute coverage amount at or above the stated threshold (specific testing, not sampling).'
const DEFAULT_UNTESTED_REMAINDER_BASIS =
  'Remainder accepted based on audit risk assessment and other audit procedures performed.'
const PATH_B_BELOW_REQUIRED_WARNING =
  'Path B §13.8: selected coverage is below the required coverage value. Increase sample size and re-run selection, or document reviewer-approved rationale before finishing testing.'

function confidenceClass(confidence: MappingConfidence): string {
  return `confidence ${confidence}`
}

function riskScoreToLevel(score: RiskScore): RiskLevel {
  switch (score) {
    case 1:
      return 'low'
    case 2:
      return 'medium'
    case 3:
      return 'high'
    case 4:
      return 'veryHigh'
  }
}

const RISK_SCORE_OPTIONS: RiskScore[] = [1, 2, 3, 4]

function emptyMapping(): Record<StandardField, FieldMappingState> {
  const result = {} as Record<StandardField, FieldMappingState>
  for (const field of MAPPING_FIELD_ORDER) {
    result[field] = {
      columnIndex: null,
      confidence: 'none',
      candidates: [],
      needsAuditorChoice: false,
    }
  }
  return result
}

function defaultEngagement(): EngagementMeta {
  return {
    wpReference: '',
    clientName: '',
    auditArea: 'Expenses',
    period: '',
    testType: 'Tests of details — vouching',
    assertion: ASSERTION_OPTIONS[0] ?? 'Existence / Occurrence',
    objective: '',
    samplingUnit: DEFAULT_SAMPLING_UNIT,
    errorDefinition: '',
  }
}

function defaultDesignInputs(): DesignInputs {
  return {
    highValueThreshold: DEFAULT_HIGH_VALUE_THRESHOLD,
    highValueBasis: DEFAULT_HIGH_VALUE_BASIS,
    stratificationBasis: 'none',
    stratificationOther: '',
    riskLevel: 'high',
    expectedError: '',
    tolerableError: '',
    sampleSizePath: 'pathA',
    pathA: { riskLevel: 3, expectedError: 2, otherEvidence: 2 },
  }
}

function defaultSampleDesign(
  recommended: SelectionMethod = 'random',
): SampleDesignState {
  return {
    recommendedMethod: recommended,
    selectedMethod: recommended,
    methodOverrideReason: '',
    methodApproved: false,
    suggestedSize: 0,
    confirmedSize: 0,
    sizeRationale: DEFAULT_SIZE_RATIONALE,
    coveragePercentUsed: null,
    samplingRiskAccepted: false,
    sizeReviewerApproved: false,
    sizeRuleLabel: '',
  }
}

function defaultEvaluation(): EvaluationState {
  return {
    exceptionCount: 0,
    exceptionValue: 0,
    natureSummary: '',
    widerIssue: 'no',
    furtherTesting: 'no',
    conclusion: '',
    reviewerComments: '',
    untestedRemainderBasis: DEFAULT_UNTESTED_REMAINDER_BASIS,
  }
}

type PathBReview = ReturnType<typeof pathBPostSelectionReview>

function defaultSignOff(): SignOffState {
  return {
    preparedBy: '',
    preparedDate: '',
    reviewedBy: '',
    reviewedDate: '',
    reviewStatus: 'draft',
    locked: false,
    lockDate: '',
    fileAssemblyDeadline: '',
    amendmentNote: '',
    amendmentReviewerApproved: false,
  }
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Dropdown/chip label: show real ledger column position + header text. */
function formatColumnLabel(index: number, header: string): string {
  const name = header.trim() || `Column ${index + 1}`
  return `Col ${index + 1}: ${name}`
}

/** ID shown in tables — prefer voucher; label account so it is not mistaken for voucher. */
function displayRowId(t: { voucherNo: string; accountNo: string }): string {
  if (t.voucherNo) return t.voucherNo
  if (t.accountNo) return `Acct ${t.accountNo}`
  return '—'
}

export default function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<WizardStep>('upload')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])

  const [ledger, setLedger] = useState<UploadedLedger | null>(null)
  const [sheetIndex, setSheetIndex] = useState(0)
  const [headerRow, setHeaderRow] = useState(0)
  const [dataStart, setDataStart] = useState(1)
  const [dataEnd, setDataEnd] = useState(1)
  const [mapping, setMapping] = useState<Record<StandardField, FieldMappingState>>(
    emptyMapping(),
  )

  const [transactions, setTransactions] = useState<LedgerTransaction[]>([])
  const [populationSummary, setPopulationSummary] = useState<PopulationSummary | null>(
    null,
  )
  const [populationConfirmed, setPopulationConfirmed] = useState(false)
  const [excludeDrafts, setExcludeDrafts] = useState<Record<string, string>>({})

  const [engagement, setEngagement] = useState<EngagementMeta>(defaultEngagement())
  const [designInputs, setDesignInputs] = useState<DesignInputs>(defaultDesignInputs())

  const [sampleDesign, setSampleDesign] = useState<SampleDesignState>(
    defaultSampleDesign(),
  )
  const [coveragePercentOverride, setCoveragePercentOverride] = useState(
    SMALL_POP_HIGH_RISK_DEFAULT_PCT,
  )
  const [sizeWarning, setSizeWarning] = useState('')

  const [blockStart, setBlockStart] = useState(0)
  const [blockRationale, setBlockRationale] = useState('')
  const [haphazardIds, setHaphazardIds] = useState<string[]>([])
  const [haphazardBiasConfirmed, setHaphazardBiasConfirmed] = useState(false)

  const [selected, setSelected] = useState<LedgerTransaction[]>([])
  const [selectionMeta, setSelectionMeta] = useState<SelectionMeta | null>(null)
  const [pathBReview, setPathBReview] = useState<PathBReview | null>(null)
  const [pathBCoverageAccepted, setPathBCoverageAccepted] = useState(false)
  const [pathBCoverageRationale, setPathBCoverageRationale] = useState('')
  const [removeDrafts, setRemoveDrafts] = useState<Record<string, string>>({})

  const [testing, setTesting] = useState<TestingResult[]>([])
  const [evaluation, setEvaluation] = useState<EvaluationState>(defaultEvaluation())

  const [signOff, setSignOff] = useState<SignOffState>(defaultSignOff())
  const [configSnapshot, setConfigSnapshot] = useState<FirmConfigSnapshot | null>(null)

  const sheet = ledger?.sheets[sheetIndex]
  const headers = useMemo(() => {
    if (!sheet) return []
    return (sheet.rows[headerRow] ?? []).map((cell, index) => {
      const text = cellToText(cell)
      return text || `Column ${index + 1}`
    })
  }, [sheet, headerRow])

  const activePop = useMemo(() => activeTransactions(transactions), [transactions])
  const dataHash = useMemo(() => hashExtractedData(transactions), [transactions])

  const liveSummary = useMemo(
    () => buildPopulationSummary(transactions),
    [transactions],
  )

  const methodRecommendation = useMemo(
    () =>
      recommendMethod({
        residual: activePop,
        riskLevel:
          designInputs.sampleSizePath === 'pathA'
            ? riskScoreToLevel(designInputs.pathA.riskLevel)
            : designInputs.riskLevel,
        highValueCount: 0,
      }),
    [
      activePop,
      designInputs.sampleSizePath,
      designInputs.pathA.riskLevel,
      designInputs.riskLevel,
    ],
  )

  const sizeSuggestion = useMemo(() => {
    const allowBand =
      designInputs.sampleSizePath === 'pathA' &&
      activePop.length <= 30 &&
      designInputs.pathA.riskLevel >= 3
    return suggestSampleSizeForPath({
      path: designInputs.sampleSizePath,
      pathA: designInputs.pathA,
      transactions: activePop,
      coveragePercentOverride: allowBand ? coveragePercentOverride : null,
    })
  }, [
    activePop,
    designInputs.sampleSizePath,
    designInputs.pathA,
    coveragePercentOverride,
  ])

  const dateHeaderPresent = useMemo(
    () => (sheet ? hasDateLikeHeader(headers) : false),
    [headers, sheet],
  )
  const mappingErrors = useMemo(
    () => (sheet ? validateRequiredMappings(mapping, headers) : []),
    [mapping, sheet, headers],
  )
  const needsChoiceFields = useMemo(
    () => MAPPING_FIELD_ORDER.filter((f) => mapping[f].needsAuditorChoice),
    [mapping],
  )
  const mappingBlocked =
    mappingErrors.length > 0 ||
    needsChoiceFields.length > 0 ||
    MAPPING_FIELD_ORDER.some(
      (f) => mapping[f].needsAuditorChoice === true && mapping[f].columnIndex == null,
    )

  const selectedCoverage = useMemo(() => totalCoverageValue(selected), [selected])
  const unresolvedCount = useMemo(
    () => unresolvedBothSides(transactions),
    [transactions],
  )
  const coverageTotal = useMemo(() => totalCoverageValue(transactions), [transactions])
  const flaggedTotals = useMemo(
    () => transactions.filter((t) => t.looksLikeTotal),
    [transactions],
  )
  const flaggedOpening = useMemo(
    () => transactions.filter((t) => t.looksLikeOpeningClosing),
    [transactions],
  )
  const flaggedZeroNeg = useMemo(
    () => transactions.filter((t) => t.isZeroOrNegative),
    [transactions],
  )
  const flaggedDuplicates = useMemo(
    () => transactions.filter((t) => t.isDuplicateVoucher),
    [transactions],
  )
  const needingResolution = useMemo(
    () => transactions.filter((t) => !t.excluded && t.needsCoverageResolution),
    [transactions],
  )

  const stepIndex = STEPS.indexOf(step)
  const smallHighRiskBand =
    designInputs.sampleSizePath === 'pathA' &&
    activePop.length <= 30 &&
    designInputs.pathA.riskLevel >= 3

  function pathBZeroCoverageError(): string | null {
    if (
      designInputs.sampleSizePath === 'pathB' &&
      totalCoverageValue(activePop) <= 0
    ) {
      return 'Path B cannot be used when total coverage value is zero.'
    }
    return null
  }

  function goNext() {
    const next = STEPS[stepIndex + 1]
    if (next) setStep(next)
  }

  function goBack() {
    const prev = STEPS[stepIndex - 1]
    if (prev) setStep(prev)
  }

  /**
   * Clears all state that is downstream of `fromStep` and, if the wizard is
   * currently further along than `fromStep`, moves it back to `fromStep`.
   */
  function invalidateFrom(fromStep: WizardStep) {
    const idx = STEPS.indexOf(fromStep)
    const confirmIdx = STEPS.indexOf('confirm')
    const planningIdx = STEPS.indexOf('planning')
    const selectionIdx = STEPS.indexOf('selection')
    const testingIdx = STEPS.indexOf('testing')

    if (idx < confirmIdx) {
      setTransactions([])
      setPopulationSummary(null)
      setPopulationConfirmed(false)
      setExcludeDrafts({})
    }
    if (idx <= confirmIdx) {
      setPopulationConfirmed(false)
    }
    if (idx <= planningIdx) {
      setSampleDesign(defaultSampleDesign())
      setCoveragePercentOverride(SMALL_POP_HIGH_RISK_DEFAULT_PCT)
      setSizeWarning('')
    }
    if (idx <= selectionIdx) {
      setSelected([])
      setSelectionMeta(null)
      setPathBReview(null)
      setPathBCoverageAccepted(false)
      setPathBCoverageRationale('')
      setRemoveDrafts({})
    }
    if (idx < selectionIdx) {
      setBlockStart(0)
      setBlockRationale('')
      setHaphazardIds([])
      setHaphazardBiasConfirmed(false)
    }
    if (idx <= testingIdx) {
      setTesting([])
      setEvaluation(defaultEvaluation())
      setConfigSnapshot(null)
      setSignOff(defaultSignOff())
      setPathBCoverageAccepted(false)
      setPathBCoverageRationale('')
    }

    setError('')
    setWarnings([])
    setStep((current) => (STEPS.indexOf(current) > idx ? fromStep : current))
  }

  async function onUpload(file: File) {
    setBusy(true)
    setError('')
    try {
      const parsed = await parseLedgerFile(file)
      if (!parsed.sheets.length) {
        setError('No worksheets found in this file.')
        return
      }
      invalidateFrom('upload')
      setLedger(parsed)
      setSheetIndex(0)
      prepareSheet(parsed, 0)
      setStep('worksheet')
    } catch {
      setError('Could not read this file. Please upload an Excel workbook (.xlsx / .xls).')
    } finally {
      setBusy(false)
    }
  }

  function prepareSheet(source: UploadedLedger, index: number) {
    const activeSheet = source.sheets[index]
    const detected = detectHeaderRow(activeSheet.rows)
    const start = Math.min(detected + 1, Math.max(activeSheet.rows.length - 1, 0))
    const end = detectDataEnd(activeSheet.rows, detected)
    const headerTexts = (activeSheet.rows[detected] ?? []).map((c) => cellToText(c))
    const suggestions = suggestMappings(headerTexts, activeSheet.rows, detected)

    setHeaderRow(detected)
    setDataStart(start)
    setDataEnd(end)
    setMapping(suggestions)
    setWarnings([])
  }

  function changeSheet(index: number) {
    if (!ledger) return
    invalidateFrom('worksheet')
    setSheetIndex(index)
    prepareSheet(ledger, index)
  }

  function applyHeaderRow(rowIndex: number) {
    if (!sheet) return
    const start = Math.min(rowIndex + 1, Math.max(sheet.rows.length - 1, 0))
    const end = detectDataEnd(sheet.rows, rowIndex)
    const headerTexts = (sheet.rows[rowIndex] ?? []).map((c) => cellToText(c))
    invalidateFrom('mapping')
    setHeaderRow(rowIndex)
    setDataStart(start)
    setDataEnd(end)
    setMapping(suggestMappings(headerTexts, sheet.rows, rowIndex))
    setError('')
  }

  function applyDataStart(rowIndex: number) {
    if (!sheet) return
    if (rowIndex <= headerRow) {
      setError('Data start must be after the header row.')
      return
    }
    const end = Math.max(dataEnd, rowIndex)
    invalidateFrom('mapping')
    setDataStart(rowIndex)
    setDataEnd(end)
    setError('')
  }

  function applyDataEnd(rowIndex: number) {
    if (!sheet) return
    if (rowIndex < dataStart) {
      setError('Data end must be on or after data start.')
      return
    }
    invalidateFrom('mapping')
    setDataEnd(rowIndex)
    setError('')
  }

  function updateMapping(field: StandardField, columnIndex: number | null) {
    invalidateFrom('mapping')
    setMapping((prev) => ({
      ...prev,
      [field]: {
        columnIndex,
        confidence: columnIndex == null ? 'none' : 'high',
        candidates: prev[field].candidates,
        needsAuditorChoice: false,
      },
    }))
  }

  function confirmMappingAndBuild() {
    if (!sheet) return

    if (dataStart <= headerRow) {
      setError('Data start must be after the header row.')
      return
    }
    if (dataEnd < dataStart) {
      setError('Data end must be on or after data start.')
      return
    }

    const errors = validateRequiredMappings(mapping, headers)
    if (errors.length > 0) {
      setError(errors[0])
      return
    }
    if (needsChoiceFields.length > 0) {
      setError(
        `Confirm column choice for: ${needsChoiceFields
          .map((f) => STANDARD_FIELD_LABELS[f])
          .join(', ')}.`,
      )
      return
    }
    if (
      MAPPING_FIELD_ORDER.some(
        (f) => mapping[f].needsAuditorChoice === true && mapping[f].columnIndex == null,
      )
    ) {
      setError('Resolve all fields that need auditor choice before continuing.')
      return
    }

    const mapIndexes = MAPPING_FIELD_ORDER.reduce(
      (acc, field) => {
        acc[field] = mapping[field].columnIndex
        return acc
      },
      {} as Record<StandardField, number | null>,
    )

    const result = buildTransactions({
      rows: sheet.rows,
      headerRow,
      dataStart,
      dataEnd,
      mapping: mapIndexes,
    })

    if (result.errors.length) {
      setError(result.errors[0])
      return
    }

    // Keep needsCoverageResolution rows for auditor resolution on confirm step.
    invalidateFrom('mapping')
    setError('')
    setWarnings(result.warnings)
    setTransactions(result.transactions)
    setPopulationSummary(buildPopulationSummary(result.transactions))
    setPopulationConfirmed(false)
    setExcludeDrafts({})
    setStep('confirm')
  }

  function resolveRow(id: string, resolution: CoverageResolution) {
    setTransactions((prev) => {
      const next = prev.map((t) =>
        t.id === id ? resolveTransactionCoverage(t, resolution) : t,
      )
      setPopulationSummary(buildPopulationSummary(next))
      return next
    })
    invalidateFrom('confirm')
    setPopulationConfirmed(false)
    setError('')
  }

  function excludeRow(id: string) {
    const reason = (excludeDrafts[id] ?? '').trim()
    if (!reason) {
      setError('Please enter a reason before excluding this row.')
      return
    }
    setTransactions((prev) => {
      const next = prev.map((t) =>
        t.id === id ? { ...t, excluded: true, exclusionReason: reason } : t,
      )
      setPopulationSummary(buildPopulationSummary(next))
      return next
    })
    setExcludeDrafts((prev) => ({ ...prev, [id]: '' }))
    invalidateFrom('confirm')
    setPopulationConfirmed(false)
    setError('')
  }

  function restoreRow(id: string) {
    setTransactions((prev) => {
      const next = prev.map((t) => {
        if (t.id !== id) return t
        const both = Math.abs(t.debit) > 0 && Math.abs(t.credit) > 0
        if (both && (!t.coverageResolution || t.coverageResolution === 'exclude')) {
          return {
            ...t,
            excluded: false,
            exclusionReason: '',
            coverageResolution: undefined,
            needsCoverageResolution: true,
            coverageAmount: 0,
            bothSidesWarning: true,
          }
        }
        return {
          ...t,
          excluded: false,
          exclusionReason: '',
        }
      })
      setPopulationSummary(buildPopulationSummary(next))
      return next
    })
    invalidateFrom('confirm')
    setPopulationConfirmed(false)
    setError('')
  }

  function continueFromConfirm() {
    const unresolved = unresolvedBothSides(transactions)
    if (unresolved > 0) {
      setError(
        `${unresolved} row(s) still need Debit/Credit resolution before continuing.`,
      )
      return
    }
    const active = activeTransactions(transactions)
    if (active.length === 0) {
      setError('No active transactions remain. Restore or fix rows before continuing.')
      return
    }
    const summary = buildPopulationSummary(transactions)
    setPopulationSummary(summary)
    setPopulationConfirmed(true)
    setError('')
    setStep('planning')
  }

  function continueFromPlanning() {
    const required: Array<[string, string]> = [
      [engagement.wpReference, 'WP reference'],
      [engagement.clientName, 'Client name'],
      [engagement.auditArea, 'Audit area'],
      [engagement.period, 'Period'],
      [engagement.testType, 'Test type'],
      [engagement.assertion, 'Assertion'],
      [engagement.objective, 'Objective'],
      [engagement.samplingUnit, 'Sampling unit'],
      [engagement.errorDefinition, 'Error definition'],
    ]
    const missing = required.filter(([v]) => !v.trim()).map(([, label]) => label)
    if (missing.length) {
      setError(`Please complete: ${missing.join(', ')}.`)
      return
    }

    const pop = activeTransactions(transactions)
    if (pop.length === 0) {
      setError('No active transactions remain for sampling.')
      return
    }

    const zeroErr = pathBZeroCoverageError()
    if (zeroErr) {
      setError(zeroErr)
      return
    }

    const riskForMethod =
      designInputs.sampleSizePath === 'pathA'
        ? riskScoreToLevel(designInputs.pathA.riskLevel)
        : designInputs.riskLevel
    const recommendation = recommendMethod({
      residual: pop,
      riskLevel: riskForMethod,
      highValueCount: 0,
    })
    const allowBand =
      designInputs.sampleSizePath === 'pathA' &&
      pop.length <= 30 &&
      designInputs.pathA.riskLevel >= 3
    const suggestion = suggestSampleSizeForPath({
      path: designInputs.sampleSizePath,
      pathA: designInputs.pathA,
      transactions: pop,
      coveragePercentOverride: allowBand ? coveragePercentOverride : null,
    })
    setSampleDesign({
      ...defaultSampleDesign(recommendation.recommended),
      recommendedMethod: recommendation.recommended,
      selectedMethod: recommendation.recommended,
      suggestedSize: suggestion.suggestedSize,
      confirmedSize: suggestion.suggestedSize,
      coveragePercentUsed: suggestion.coveragePercent,
      sizeRuleLabel: suggestion.ruleLabel,
      sizeRationale: DEFAULT_SIZE_RATIONALE,
    })
    setError('')
    setStep('design')
  }

  function updateDesignMethod(next: SelectionMethod) {
    invalidateFrom('design')
    setSampleDesign((prev) => ({
      ...prev,
      selectedMethod: next,
      methodOverrideReason:
        next === prev.recommendedMethod ? '' : prev.methodOverrideReason,
    }))
  }

  function continueFromDesign() {
    const pop = activePop
    const suggestion = sizeSuggestion

    if (pop.length === 0) {
      setError('No active transactions remain for sampling.')
      return
    }
    const zeroErr = pathBZeroCoverageError()
    if (zeroErr) {
      setError(zeroErr)
      return
    }
    if (!sampleDesign.methodApproved) {
      setError('Method must be approved before continuing (hard stop).')
      return
    }
    if (
      sampleDesign.selectedMethod !== sampleDesign.recommendedMethod &&
      !sampleDesign.methodOverrideReason.trim()
    ) {
      setError(
        'Record a reason for selecting a method different from the recommendation.',
      )
      return
    }
    if (!sampleDesign.samplingRiskAccepted) {
      setError('Sampling risk statement must be accepted (hard stop).')
      return
    }
    if (!sampleDesign.sizeRationale.trim()) {
      setError('Sample-size rationale is required (hard stop).')
      return
    }

    const validation = validateSampleSizeOverride({
      proposed: sampleDesign.confirmedSize,
      calculated: suggestion.suggestedSize,
      population: pop.length,
      rationale: sampleDesign.sizeRationale,
      reviewerApproved: sampleDesign.sizeReviewerApproved,
    })
    if (!validation.ok) {
      setError(validation.error ?? 'Invalid sample size.')
      return
    }
    setSizeWarning(validation.warning ?? '')
    setSampleDesign((prev) => ({
      ...prev,
      suggestedSize: suggestion.suggestedSize,
      coveragePercentUsed: suggestion.coveragePercent,
      sizeRuleLabel: suggestion.ruleLabel,
    }))

    setError('')
    setStep('selection')
  }

  function toggleHaphazard(id: string) {
    invalidateFrom('selection')
    setHaphazardIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= sampleDesign.confirmedSize) return prev
      return [...prev, id]
    })
  }

  function runSelection() {
    const pop = activePop
    const size = sampleDesign.confirmedSize
    const method = sampleDesign.selectedMethod

    if (pop.length === 0) {
      setError('No active transactions remain for sampling.')
      return
    }

    if (size < 1) {
      setError('Confirmed sample size must be at least 1 for the population.')
      return
    }
    if (
      method !== sampleDesign.recommendedMethod &&
      !sampleDesign.methodOverrideReason.trim()
    ) {
      setError('Method override reason is required.')
      return
    }
    if (method === 'block' && !blockRationale.trim()) {
      setError('Please record a rationale for block selection.')
      return
    }
    if (method === 'haphazard') {
      if (!haphazardBiasConfirmed) {
        setError('Please confirm the haphazard selection was made without conscious bias.')
        return
      }
      if (haphazardIds.length !== size) {
        setError(`Please select exactly ${size} population transactions.`)
        return
      }
    }

    let outcome: { selected: LedgerTransaction[]; meta: SelectionMeta }
    try {
      if (method === 'random') {
        outcome = selectRandom(pop, size)
      } else if (method === 'systematic') {
        outcome = selectSystematic(pop, size)
      } else if (method === 'block') {
        outcome = selectBlock(pop, size, blockStart, blockRationale)
      } else {
        outcome = selectHaphazard(pop, haphazardIds, haphazardBiasConfirmed)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Selection failed.')
      return
    }

    if (outcome.selected.length !== size) {
      setError('Selected item count must equal the confirmed sample size.')
      return
    }

    setError('')
    setSelected(outcome.selected)
    setSelectionMeta({
      ...outcome.meta,
      rationale: sampleDesign.methodOverrideReason || outcome.meta.rationale,
    })
    setTesting(
      outcome.selected.map((item) => ({
        transactionId: item.id,
        tested: false,
        exception: false,
        exceptionValue: 0,
        nature: '',
        notes: '',
      })),
    )

    let nextWarnings: string[] = []
    if (designInputs.sampleSizePath === 'pathB') {
      const requiredCoverage =
        sizeSuggestion.pathBDetail?.requiredCoverageValue ?? 0
      const review = pathBPostSelectionReview({
        population: pop,
        selected: outcome.selected,
        requiredCoverageValue: requiredCoverage,
      })
      setPathBReview(review)
      setPathBCoverageAccepted(false)
      setPathBCoverageRationale('')
      if (review.belowRequired) {
        nextWarnings = [PATH_B_BELOW_REQUIRED_WARNING]
      }
    } else {
      setPathBReview(null)
    }
    setWarnings(nextWarnings)
    setStep('testing')
  }

  function removeSelectedItem(transactionId: string) {
    const reason = (removeDrafts[transactionId] ?? '').trim()
    if (!reason) {
      setError('Enter a reason before removing a sampled item.')
      return
    }
    setSelected([])
    setSelectionMeta(null)
    setTesting([])
    setPathBReview(null)
    setPathBCoverageAccepted(false)
    setPathBCoverageRationale('')
    setRemoveDrafts({})
    setEvaluation(defaultEvaluation())
    setConfigSnapshot(null)
    setSignOff(defaultSignOff())
    setWarnings([
      `Full re-selection required after removing a sampled item. Reason: ${reason}`,
    ])
    setError('')
    setStep('selection')
  }

  function updateTesting(
    transactionId: string,
    patch: Partial<TestingResult>,
  ) {
    setTesting((prev) =>
      prev.map((row) =>
        row.transactionId === transactionId ? { ...row, ...patch } : row,
      ),
    )
  }

  function finishTesting() {
    if (!evaluation.conclusion.trim()) {
      setError('Please record an auditor conclusion before generating the working paper.')
      return
    }

    if (designInputs.sampleSizePath === 'pathB') {
      if (!evaluation.untestedRemainderBasis.trim()) {
        setError('Path B requires an auditor basis for the untested remainder.')
        return
      }
      if (pathBReview?.belowRequired) {
        const rationaleOk = pathBCoverageRationale.trim().length >= 20
        if (!(pathBCoverageAccepted && rationaleOk)) {
          setError(
            'Path B coverage is below required. Accept with a reviewer rationale (at least 20 characters), or increase size and re-run selection.',
          )
          return
        }
      }
    }

    setError('')
    const exceptionCount = testing.filter((t) => t.exception).length
    const exceptionValue = testing.reduce(
      (sum, t) => sum + (t.exception ? t.exceptionValue : 0),
      0,
    )
    setEvaluation((prev) => ({ ...prev, exceptionCount, exceptionValue }))
    setConfigSnapshot(captureFirmConfigSnapshot())
    setSignOff((prev) => ({
      ...prev,
      reviewStatus: prev.preparedBy ? 'prepared' : 'draft',
      fileAssemblyDeadline: prev.fileAssemblyDeadline,
    }))
    setStep('workingPaper')
  }

  function lockWorkingPaper() {
    if (!signOff.reviewedBy.trim()) {
      setError('Reviewed by is required before locking the working paper.')
      return
    }
    if (signOff.locked && signOff.amendmentNote.trim() && !signOff.amendmentReviewerApproved) {
      setError(
        'Amendment note changed while locked — amendment reviewer approval is required.',
      )
      return
    }
    const lockDate = todayIsoDate()
    setSignOff((prev) => ({
      ...prev,
      locked: true,
      lockDate,
      reviewStatus: 'locked',
      reviewedDate: prev.reviewedDate || lockDate,
      fileAssemblyDeadline:
        prev.fileAssemblyDeadline ||
        addDaysIso(lockDate, FILE_ASSEMBLY_DEADLINE_DAYS),
    }))
    setError('')
  }

  function resetAll() {
    setStep('upload')
    setBusy(false)
    setError('')
    setWarnings([])
    setLedger(null)
    setSheetIndex(0)
    setHeaderRow(0)
    setDataStart(1)
    setDataEnd(1)
    setMapping(emptyMapping())
    setTransactions([])
    setPopulationSummary(null)
    setPopulationConfirmed(false)
    setExcludeDrafts({})
    setEngagement(defaultEngagement())
    setDesignInputs(defaultDesignInputs())
    setSampleDesign(defaultSampleDesign())
    setCoveragePercentOverride(SMALL_POP_HIGH_RISK_DEFAULT_PCT)
    setSizeWarning('')
    setBlockStart(0)
    setBlockRationale('')
    setHaphazardIds([])
    setHaphazardBiasConfirmed(false)
    setSelected([])
    setSelectionMeta(null)
    setPathBReview(null)
    setPathBCoverageAccepted(false)
    setPathBCoverageRationale('')
    setRemoveDrafts({})
    setTesting([])
    setEvaluation(defaultEvaluation())
    setSignOff(defaultSignOff())
    setConfigSnapshot(null)
  }

  const summary = populationSummary ?? liveSummary

  return (
    <div className="app-shell">
      {step !== 'upload' && (
        <header className="topbar">
          <div>
            <p className="brand">Audit Sampling</p>
            <h1>{STEP_TITLES[step]}</h1>
          </div>
          <div className="progress">
            Step {stepIndex + 1} of {STEPS.length}
          </div>
        </header>
      )}

      <main className={`stage ${step === 'upload' ? 'stage-upload' : ''}`}>
        {error && <div className="banner error">{error}</div>}
        {warnings.length > 0 && step !== 'upload' && (
          <div className="banner warn">
            {warnings.slice(0, 6).map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
        )}

        {step === 'upload' && (
          <section className="upload-screen">
            <p className="brand-lg">Audit Sampling</p>
            <h1>Non-Statistical Audit Sampling</h1>
            <p className="lead">
              Upload the client ledger to begin. The tool will guide you one step at a
              time.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void onUpload(file)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              className="upload-btn"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              {busy ? 'Reading file…' : 'Upload ledger'}
            </button>
            <p className="hint">Excel (.xlsx, .xls) or CSV</p>
          </section>
        )}

        {step === 'worksheet' && ledger && (
          <section className="card">
            <p className="file-name">{ledger.fileName}</p>
            <label htmlFor="sheet">Worksheet</label>
            <select
              id="sheet"
              value={sheetIndex}
              onChange={(e) => changeSheet(Number(e.target.value))}
            >
              {ledger.sheets.map((s, i) => (
                <option key={s.name} value={i}>
                  {s.name} ({s.rows.length} rows)
                </option>
              ))}
            </select>
            <div className="actions">
              <button type="button" className="ghost" onClick={resetAll}>
                Start over
              </button>
              <button type="button" className="primary" onClick={goNext}>
                Continue
              </button>
            </div>
          </section>
        )}

        {step === 'mapping' && sheet && (
          <section className="card">
            <p className="lead-inline">
              Confirm the header row, data range, and required column mappings. Mapping
              is a required confirmation — continue is blocked until required fields are
              mapped and any ambiguous matches are resolved by the auditor.
            </p>

            <div className="auto-note">
              <div>
                <span>Header row</span>
                <strong>Row {headerRow + 1}</strong>
              </div>
              <div>
                <span>Data starts</span>
                <strong>Row {dataStart + 1}</strong>
              </div>
              <div>
                <span>Data ends</span>
                <strong>Row {dataEnd + 1}</strong>
              </div>
              <div>
                <span>Rows used</span>
                <strong>{Math.max(0, dataEnd - dataStart + 1)}</strong>
              </div>
            </div>

            <details className="fix-header" open>
              <summary>Header / data range</summary>
              <label htmlFor="headerPick">Column title row</label>
              <select
                id="headerPick"
                value={headerRow}
                onChange={(e) => applyHeaderRow(Number(e.target.value))}
              >
                {sheet.rows.slice(0, Math.min(sheet.rows.length, 25)).map((row, index) => {
                  const label = row
                    .map((c) => cellToText(c))
                    .filter(Boolean)
                    .slice(0, 4)
                    .join(' · ')
                  return (
                    <option key={`hdr-${index}`} value={index}>
                      Row {index + 1}
                      {label ? `: ${label}` : ''}
                    </option>
                  )
                })}
              </select>

              <label htmlFor="dataStartPick">Data start</label>
              <select
                id="dataStartPick"
                value={dataStart}
                onChange={(e) => applyDataStart(Number(e.target.value))}
              >
                {sheet.rows.map((_, index) => (
                  <option key={`ds-${index}`} value={index} disabled={index <= headerRow}>
                    Row {index + 1}
                  </option>
                ))}
              </select>

              <label htmlFor="dataEndPick">Data end</label>
              <select
                id="dataEndPick"
                value={dataEnd}
                onChange={(e) => applyDataEnd(Number(e.target.value))}
              >
                {sheet.rows.map((_, index) => (
                  <option key={`de-${index}`} value={index} disabled={index < dataStart}>
                    Row {index + 1}
                  </option>
                ))}
              </select>
              <p className="hint">
                Changing header or data range invalidates downstream mapping results.
                Data start must be after the header row; data end must be on or after
                data start.
              </p>
            </details>

            <div className="preview-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    {headers.slice(0, 8).map((h, hi) => (
                      <th key={`mh-${hi}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sheet.rows
                    .slice(
                      Math.min(headerRow + 1, sheet.rows.length),
                      Math.min(headerRow + 6, sheet.rows.length),
                    )
                    .map((row, i) => {
                      const rowNum = headerRow + 1 + i
                      return (
                        <tr key={`map-preview-${rowNum}`}>
                          <td>{rowNum + 1}</td>
                          {row.slice(0, 8).map((cell, j) => (
                            <td key={`${i}-${j}`}>{cellToText(cell)}</td>
                          ))}
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>

            <h3 className="map-heading">Column mapping (required)</h3>
            <p className="lead-inline">
              Map required fields explicitly. Continue is blocked until mapping errors
              and auditor choices are resolved.
            </p>

            {mappingErrors.length > 0 && (
              <div className="banner error">{mappingErrors.join('  •  ')}</div>
            )}

            {needsChoiceFields.length > 0 && (
              <div className="banner error">
                These fields have more than one strong match and need your confirmation:{' '}
                {needsChoiceFields.map((f) => STANDARD_FIELD_LABELS[f]).join(', ')}.
              </div>
            )}

            {MAPPING_FIELD_ORDER.map((field) => {
              const state = mapping[field]
              const fieldLabel =
                field === 'date' && !dateHeaderPresent
                  ? DATE_OPTIONAL_LABEL
                  : STANDARD_FIELD_LABELS[field]
              const uniqueCandidateHeaders = new Set(
                state.candidates.map((c) => c.header.trim().toLowerCase()),
              )
              const showCandidateChips =
                state.candidates.length > 1 &&
                (state.needsAuditorChoice || uniqueCandidateHeaders.size > 1)
              return (
                <div className="map-row" key={field}>
                  <div>
                    <strong>{fieldLabel}</strong>
                    <span className={confidenceClass(state.confidence)}>
                      {state.columnIndex == null
                        ? 'not mapped'
                        : state.confidence === 'high'
                          ? 'auto'
                          : state.confidence}
                    </span>
                    {state.needsAuditorChoice && (
                      <span className="needs-choice">needs your choice</span>
                    )}
                  </div>
                  <div>
                    <select
                      value={state.columnIndex ?? ''}
                      onChange={(e) =>
                        updateMapping(
                          field,
                          e.target.value === '' ? null : Number(e.target.value),
                        )
                      }
                    >
                      <option value="">Not mapped</option>
                      {headers.map((header, index) => (
                        <option key={`col-${index}`} value={index}>
                          {formatColumnLabel(index, header)}
                        </option>
                      ))}
                    </select>
                    {showCandidateChips && (
                      <div className="candidate-row">
                        {state.candidates.map((c) => (
                          <button
                            type="button"
                            key={c.columnIndex}
                            className={`candidate-chip ${
                              state.columnIndex === c.columnIndex ? 'active' : ''
                            }`}
                            onClick={() => updateMapping(field, c.columnIndex)}
                          >
                            {formatColumnLabel(c.columnIndex, c.header)} (
                            {Math.round(c.score)}%)
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            <div className="actions">
              <button type="button" className="ghost" onClick={goBack}>
                Back
              </button>
              <button
                type="button"
                className="primary"
                onClick={confirmMappingAndBuild}
                disabled={mappingBlocked}
              >
                Confirm mapping — continue
              </button>
            </div>
          </section>
        )}

        {step === 'confirm' && (
          <section className="card">
            <div className="stat-grid">
              <div>
                <span>Confirmed transaction count (active)</span>
                <strong>{activePop.length}</strong>
              </div>
              <div>
                <span>Total coverage value</span>
                <strong>{formatMoney(coverageTotal)}</strong>
              </div>
              <div>
                <span>Excluded</span>
                <strong>{transactions.filter((t) => t.excluded).length}</strong>
              </div>
              <div>
                <span>Unresolved Debit/Credit</span>
                <strong>{unresolvedCount}</strong>
              </div>
            </div>

            <div className="stat-grid">
              <div>
                <span>Flagged totals</span>
                <strong>{flaggedTotals.length}</strong>
              </div>
              <div>
                <span>Opening / closing</span>
                <strong>{flaggedOpening.length}</strong>
              </div>
              <div>
                <span>Zero / negative</span>
                <strong>{flaggedZeroNeg.length}</strong>
              </div>
              <div>
                <span>Duplicates (not auto-excluded)</span>
                <strong>{flaggedDuplicates.length}</strong>
              </div>
            </div>

            <p className="lead-inline">
              Confirm population count and coverage value. Resolve any Debit/Credit
              conflicts and exclude rows only with a recorded reason.
            </p>

            {unresolvedCount > 0 && (
              <div className="banner error">
                {unresolvedCount} row(s) have both Debit and Credit values. Resolve each
                before continuing.
              </div>
            )}
            {activePop.length === 0 && (
              <div className="banner error">
                No active transactions remain. Restore or fix rows before continuing.
              </div>
            )}

            {needingResolution.length > 0 && (
              <>
                <h3>Rows needing Debit/Credit resolution</h3>
                <div className="preview-table-wrap preview-table-all">
                  <table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Voucher / Acct</th>
                        <th>Debit</th>
                        <th>Credit</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {needingResolution.map((t) => (
                        <tr key={`resolve-${t.id}`}>
                          <td>{t.id}</td>
                          <td>{displayRowId(t)}</td>
                          <td>{formatMoney(t.debit)}</td>
                          <td>{formatMoney(t.credit)}</td>
                          <td>
                            <div className="row-actions">
                              <button
                                type="button"
                                className="small-btn"
                                onClick={() => resolveRow(t.id, 'useDebit')}
                              >
                                Use Debit
                              </button>
                              <button
                                type="button"
                                className="small-btn"
                                onClick={() => resolveRow(t.id, 'useCredit')}
                              >
                                Use Credit
                              </button>
                              <button
                                type="button"
                                className="small-btn"
                                onClick={() => resolveRow(t.id, 'useMax')}
                              >
                                Use higher
                              </button>
                              <button
                                type="button"
                                className="small-btn"
                                onClick={() => resolveRow(t.id, 'exclude')}
                              >
                                Exclude
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <h3>Population rows</h3>
            <div className="preview-table-wrap preview-table-all">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Date</th>
                    <th>Voucher / Acct</th>
                    <th>Description</th>
                    <th>Coverage</th>
                    <th>Flags</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t) => (
                    <tr key={`confirm-${t.id}`} className={t.excluded ? 'excluded-row' : ''}>
                      <td>{t.id}</td>
                      <td>{t.date || '—'}</td>
                      <td>{displayRowId(t)}</td>
                      <td>{t.description || '—'}</td>
                      <td>{formatMoney(t.coverageAmount)}</td>
                      <td>
                        {[
                          t.needsCoverageResolution ? 'both sides' : '',
                          t.looksLikeTotal ? 'total' : '',
                          t.looksLikeOpeningClosing ? 'open/close' : '',
                          t.isZeroOrNegative ? 'zero/neg' : '',
                          t.isDuplicateVoucher ? 'duplicate' : '',
                          t.excluded ? `excluded: ${t.exclusionReason}` : '',
                        ]
                          .filter(Boolean)
                          .join(', ') || '—'}
                      </td>
                      <td>
                        {t.excluded ? (
                          <button
                            type="button"
                            className="small-btn"
                            onClick={() => restoreRow(t.id)}
                          >
                            Restore
                          </button>
                        ) : t.needsCoverageResolution ? (
                          <span className="hint">Resolve above</span>
                        ) : (
                          <div className="row-actions">
                            <input
                              className="exclude-input"
                              placeholder="Reason to exclude"
                              value={excludeDrafts[t.id] ?? ''}
                              onChange={(e) =>
                                setExcludeDrafts((prev) => ({
                                  ...prev,
                                  [t.id]: e.target.value,
                                }))
                              }
                            />
                            <button
                              type="button"
                              className="small-btn"
                              onClick={() => excludeRow(t.id)}
                            >
                              Exclude
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {summary.byReason.length > 0 && (
              <>
                <h3>Exclusion summary</h3>
                <ul>
                  {summary.byReason.map((r) => (
                    <li key={r.reason}>
                      {r.reason}: {r.count} ({formatMoney(r.value)})
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div className="actions">
              <button type="button" className="ghost" onClick={goBack}>
                Back
              </button>
              <button
                type="button"
                className="primary"
                onClick={continueFromConfirm}
                disabled={unresolvedCount > 0 || activePop.length === 0}
              >
                Confirm count & value — continue
              </button>
            </div>
          </section>
        )}

        {step === 'planning' && (
          <section className="card">
            <p className="lead-inline">
              Complete planning inputs required for the working paper (hard stops).
            </p>
            <div className="form-grid grid-3">
              <div>
                <label htmlFor="wpRef">WP reference</label>
                <input
                  id="wpRef"
                  value={engagement.wpReference}
                  onChange={(e) => {
                    invalidateFrom('planning')
                    setEngagement((prev) => ({
                      ...prev,
                      wpReference: e.target.value,
                    }))
                  }}
                />
              </div>
              <div>
                <label htmlFor="clientName">Client name</label>
                <input
                  id="clientName"
                  value={engagement.clientName}
                  onChange={(e) => {
                    invalidateFrom('planning')
                    setEngagement((prev) => ({
                      ...prev,
                      clientName: e.target.value,
                    }))
                  }}
                />
              </div>
              <div>
                <label htmlFor="auditArea">Audit area</label>
                <select
                  id="auditArea"
                  value={engagement.auditArea}
                  onChange={(e) => {
                    invalidateFrom('planning')
                    setEngagement((prev) => ({
                      ...prev,
                      auditArea: e.target.value,
                    }))
                  }}
                >
                  {AUDIT_AREA_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="period">Period</label>
                <input
                  id="period"
                  value={engagement.period}
                  onChange={(e) => {
                    invalidateFrom('planning')
                    setEngagement((prev) => ({ ...prev, period: e.target.value }))
                  }}
                  placeholder="e.g. Year ended 30 June 2026"
                />
              </div>
              <div>
                <label htmlFor="testType">Test type</label>
                <select
                  id="testType"
                  value={engagement.testType}
                  onChange={(e) => {
                    invalidateFrom('planning')
                    setEngagement((prev) => ({ ...prev, testType: e.target.value }))
                  }}
                >
                  {TEST_TYPE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="assertion">Assertion</label>
                <select
                  id="assertion"
                  value={engagement.assertion}
                  onChange={(e) => {
                    invalidateFrom('planning')
                    setEngagement((prev) => ({ ...prev, assertion: e.target.value }))
                  }}
                >
                  {ASSERTION_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label htmlFor="objective">Objective</label>
            <textarea
              id="objective"
              rows={3}
              value={engagement.objective}
              onChange={(e) => {
                invalidateFrom('planning')
                setEngagement((prev) => ({ ...prev, objective: e.target.value }))
              }}
              placeholder="e.g. Test occurrence and accuracy of expense vouchers"
            />

            <label htmlFor="unit">Sampling unit</label>
            <input
              id="unit"
              value={engagement.samplingUnit}
              onChange={(e) => {
                invalidateFrom('planning')
                setEngagement((prev) => ({ ...prev, samplingUnit: e.target.value }))
              }}
            />

            <label htmlFor="errorDef">Error definition</label>
            <textarea
              id="errorDef"
              rows={2}
              value={engagement.errorDefinition}
              onChange={(e) => {
                invalidateFrom('planning')
                setEngagement((prev) => ({
                  ...prev,
                  errorDefinition: e.target.value,
                }))
              }}
              placeholder="Define what constitutes an exception / misstatement"
            />

            <h3>Sample size path</h3>
            <div className="path-chooser" role="radiogroup" aria-label="Sample size path">
              <label className="check-row">
                <input
                  type="radio"
                  name="sampleSizePath"
                  checked={designInputs.sampleSizePath === 'pathA'}
                  onChange={() => {
                    invalidateFrom('planning')
                    setDesignInputs((prev) => ({
                      ...prev,
                      sampleSizePath: 'pathA',
                      riskLevel: riskScoreToLevel(prev.pathA.riskLevel),
                    }))
                  }}
                />
                <span>
                  Path A — Risk matrix (risk, expected error, other evidence)
                </span>
              </label>
              <label className="check-row">
                <input
                  type="radio"
                  name="sampleSizePath"
                  checked={designInputs.sampleSizePath === 'pathB'}
                  onChange={() => {
                    if (totalCoverageValue(activePop) <= 0) {
                      setError('Path B cannot be used when total coverage value is zero.')
                      return
                    }
                    invalidateFrom('planning')
                    setDesignInputs((prev) => ({
                      ...prev,
                      sampleSizePath: 'pathB',
                    }))
                  }}
                />
                <span>Path B — Value coverage (monetary tier guidance)</span>
              </label>
            </div>

            {designInputs.sampleSizePath === 'pathA' ? (
              <div className="form-grid grid-3">
                <div>
                  <label htmlFor="pathARisk">Risk level</label>
                  <select
                    id="pathARisk"
                    value={designInputs.pathA.riskLevel}
                    onChange={(e) => {
                      invalidateFrom('planning')
                      const score = Number(e.target.value) as RiskScore
                      setDesignInputs((prev) => ({
                        ...prev,
                        pathA: { ...prev.pathA, riskLevel: score },
                        riskLevel: riskScoreToLevel(score),
                      }))
                    }}
                  >
                    {RISK_SCORE_OPTIONS.map((score) => (
                      <option key={score} value={score}>
                        {score} — {scoreLabel(score, 'riskLevel')}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="pathAExpected">Expected error</label>
                  <select
                    id="pathAExpected"
                    value={designInputs.pathA.expectedError}
                    onChange={(e) => {
                      invalidateFrom('planning')
                      const score = Number(e.target.value) as RiskScore
                      setDesignInputs((prev) => ({
                        ...prev,
                        pathA: { ...prev.pathA, expectedError: score },
                      }))
                    }}
                  >
                    {RISK_SCORE_OPTIONS.map((score) => (
                      <option key={score} value={score}>
                        {score} — {scoreLabel(score, 'expectedError')}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="pathAEvidence">Other evidence</label>
                  <select
                    id="pathAEvidence"
                    value={designInputs.pathA.otherEvidence}
                    onChange={(e) => {
                      invalidateFrom('planning')
                      const score = Number(e.target.value) as RiskScore
                      setDesignInputs((prev) => ({
                        ...prev,
                        pathA: { ...prev.pathA, otherEvidence: score },
                      }))
                    }}
                  >
                    {RISK_SCORE_OPTIONS.map((score) => (
                      <option key={score} value={score}>
                        {score} — {scoreLabel(score, 'otherEvidence')}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <p className="hint">
                Suggested size will be based on population value coverage tiers after
                you continue.
              </p>
            )}

            <div className="form-grid grid-2">
              <div>
                <label htmlFor="expectedError">Expected error note (optional)</label>
                <input
                  id="expectedError"
                  value={designInputs.expectedError}
                  onChange={(e) => {
                    invalidateFrom('planning')
                    setDesignInputs((prev) => ({
                      ...prev,
                      expectedError: e.target.value,
                    }))
                  }}
                />
              </div>
              <div>
                <label htmlFor="tolerableError">Tolerable error (optional)</label>
                <input
                  id="tolerableError"
                  value={designInputs.tolerableError}
                  onChange={(e) => {
                    invalidateFrom('planning')
                    setDesignInputs((prev) => ({
                      ...prev,
                      tolerableError: e.target.value,
                    }))
                  }}
                />
              </div>
            </div>

            <div className="actions">
              <button type="button" className="ghost" onClick={goBack}>
                Back
              </button>
              <button type="button" className="primary" onClick={continueFromPlanning}>
                Continue
              </button>
            </div>
          </section>
        )}

        {step === 'design' && (
          <section className="card">
            <div className="stat-grid">
              <div>
                <span>Population count</span>
                <strong>{activePop.length}</strong>
              </div>
              <div>
                <span>Sample size path</span>
                <strong>
                  {designInputs.sampleSizePath === 'pathA'
                    ? 'Path A — Risk matrix'
                    : 'Path B — Value coverage'}
                </strong>
              </div>
              <div>
                <span>Suggested size</span>
                <strong>{sizeSuggestion.suggestedSize}</strong>
              </div>
            </div>

            <h3>Recommended method</h3>
            <p className="lead-inline">
              <strong>{methodLabel(methodRecommendation.recommended)}</strong>
            </p>
            <ul>
              {methodRecommendation.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>

            <label htmlFor="selectedMethod">Selected method</label>
            <select
              id="selectedMethod"
              value={sampleDesign.selectedMethod}
              onChange={(e) =>
                updateDesignMethod(e.target.value as SelectionMethod)
              }
            >
              <option value="random">Random</option>
              <option value="systematic">Systematic</option>
              <option value="haphazard">Haphazard / Manual</option>
              <option value="block">Block</option>
            </select>

            {sampleDesign.selectedMethod !== sampleDesign.recommendedMethod && (
              <>
                <label htmlFor="methodOverride">Method override reason</label>
                <textarea
                  id="methodOverride"
                  rows={2}
                  value={sampleDesign.methodOverrideReason}
                  onChange={(e) => {
                    invalidateFrom('design')
                    setSampleDesign((prev) => ({
                      ...prev,
                      methodOverrideReason: e.target.value,
                    }))
                  }}
                />
              </>
            )}

            <label className="check-row">
              <input
                type="checkbox"
                checked={sampleDesign.methodApproved}
                onChange={(e) => {
                  invalidateFrom('design')
                  setSampleDesign((prev) => ({
                    ...prev,
                    methodApproved: e.target.checked,
                  }))
                }}
              />
              <span>I approve the selected selection method for this engagement.</span>
            </label>

            <h3>Sample size</h3>
            <p className="lead-inline">
              {sampleDesign.sizeRuleLabel || sizeSuggestion.ruleLabel}
            </p>

            {designInputs.sampleSizePath === 'pathA' && sizeSuggestion.pathADetail && (
              <p className="hint">
                Path A scores: risk {designInputs.pathA.riskLevel} (
                {scoreLabel(designInputs.pathA.riskLevel, 'riskLevel')}), expected
                error {designInputs.pathA.expectedError} (
                {scoreLabel(designInputs.pathA.expectedError, 'expectedError')}),
                other evidence {designInputs.pathA.otherEvidence} (
                {scoreLabel(designInputs.pathA.otherEvidence, 'otherEvidence')}).
                Matrix score {sizeSuggestion.pathADetail.score} → matrix size{' '}
                {sizeSuggestion.pathADetail.matrixSize}.
              </p>
            )}

            {designInputs.sampleSizePath === 'pathB' && sizeSuggestion.pathBDetail && (
              <p className="hint">
                Path B tier {sizeSuggestion.pathBDetail.tier}:{' '}
                {Math.round(sizeSuggestion.pathBDetail.coveragePercent * 100)}%
                coverage requires{' '}
                {formatMoney(sizeSuggestion.pathBDetail.requiredCoverageValue)} (
                provisional {sizeSuggestion.pathBDetail.suggestedSampleSize} items).
              </p>
            )}

            {smallHighRiskBand && (
              <>
                <label htmlFor="coveragePct">
                  Coverage % (small pop, high risk:{' '}
                  {Math.round(SMALL_POP_HIGH_RISK_MIN_PCT * 100)}–
                  {Math.round(SMALL_POP_HIGH_RISK_MAX_PCT * 100)}%)
                </label>
                <input
                  id="coveragePct"
                  type="range"
                  min={Math.round(SMALL_POP_HIGH_RISK_MIN_PCT * 100)}
                  max={Math.round(SMALL_POP_HIGH_RISK_MAX_PCT * 100)}
                  step={1}
                  value={Math.round(coveragePercentOverride * 100)}
                  onChange={(e) => {
                    invalidateFrom('design')
                    const pct = Number(e.target.value) / 100
                    setCoveragePercentOverride(pct)
                    const next = suggestSampleSizeForPath({
                      path: 'pathA',
                      pathA: designInputs.pathA,
                      transactions: activePop,
                      coveragePercentOverride: pct,
                    })
                    setSampleDesign((prev) => ({
                      ...prev,
                      suggestedSize: next.suggestedSize,
                      confirmedSize: next.suggestedSize,
                      coveragePercentUsed: next.coveragePercent,
                      sizeRuleLabel: next.ruleLabel,
                    }))
                  }}
                />
                <p className="hint">
                  {Math.round(coveragePercentOverride * 100)}% of population
                </p>
              </>
            )}

            <label htmlFor="confirmedSize">Confirmed sample size</label>
            <input
              id="confirmedSize"
              type="number"
              min={1}
              max={Math.max(1, activePop.length)}
              value={sampleDesign.confirmedSize}
              onChange={(e) => {
                invalidateFrom('design')
                setSampleDesign((prev) => ({
                  ...prev,
                  confirmedSize: Number(e.target.value),
                }))
                setSizeWarning('')
              }}
            />

            <label htmlFor="sizeRationale">Size rationale</label>
            <textarea
              id="sizeRationale"
              rows={3}
              value={sampleDesign.sizeRationale}
              onChange={(e) => {
                invalidateFrom('design')
                setSampleDesign((prev) => ({
                  ...prev,
                  sizeRationale: e.target.value,
                }))
              }}
            />

            {sampleDesign.confirmedSize < sizeSuggestion.suggestedSize && (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={sampleDesign.sizeReviewerApproved}
                  onChange={(e) => {
                    invalidateFrom('design')
                    setSampleDesign((prev) => ({
                      ...prev,
                      sizeReviewerApproved: e.target.checked,
                    }))
                  }}
                />
                <span>
                  Reviewer approves reduction below suggested population coverage (
                  {sizeSuggestion.suggestedSize}).
                </span>
              </label>
            )}

            {sizeWarning && <div className="banner warn">{sizeWarning}</div>}
            {(sizeSuggestion.pathADetail?.isHundredPercent ||
              (activePop.length > 0 &&
                sizeSuggestion.suggestedSize === activePop.length)) && (
              <div className="banner warn">
                Confirmed size equals the full population — this is 100% examination,
                not sample-based testing.
              </div>
            )}

            <label className="check-row">
              <input
                type="checkbox"
                checked={sampleDesign.samplingRiskAccepted}
                onChange={(e) => {
                  invalidateFrom('design')
                  setSampleDesign((prev) => ({
                    ...prev,
                    samplingRiskAccepted: e.target.checked,
                  }))
                }}
              />
              <span>{SAMPLING_RISK_STATEMENT}</span>
            </label>

            <div className="actions">
              <button type="button" className="ghost" onClick={goBack}>
                Back
              </button>
              <button type="button" className="primary" onClick={continueFromDesign}>
                Continue to selection
              </button>
            </div>
          </section>
        )}

        {step === 'selection' && (
          <section className="card">
            <p className="lead-inline">
              Selection runs on the active <strong>population</strong>.
            </p>

            <div className="stat-grid">
              <div>
                <span>Population</span>
                <strong>{activePop.length}</strong>
              </div>
              <div>
                <span>Sample size</span>
                <strong>{sampleDesign.confirmedSize}</strong>
              </div>
              <div>
                <span>Method</span>
                <strong>{methodLabel(sampleDesign.selectedMethod)}</strong>
              </div>
            </div>

            {sampleDesign.selectedMethod === 'systematic' && (
              <div className="banner warn">
                Systematic selection may follow a periodicity pattern. Review for
                pattern risk.
              </div>
            )}

            {sampleDesign.selectedMethod === 'block' && (
              <>
                <label htmlFor="blockStart">
                  Block start index (0-based in population list)
                </label>
                <input
                  id="blockStart"
                  type="number"
                  min={0}
                  max={Math.max(0, activePop.length - sampleDesign.confirmedSize)}
                  value={blockStart}
                  onChange={(e) => {
                    invalidateFrom('selection')
                    setBlockStart(Number(e.target.value))
                  }}
                />
                <label htmlFor="blockRationale">Rationale for block selection</label>
                <textarea
                  id="blockRationale"
                  rows={2}
                  value={blockRationale}
                  onChange={(e) => {
                    invalidateFrom('selection')
                    setBlockRationale(e.target.value)
                  }}
                />
              </>
            )}

            {sampleDesign.selectedMethod === 'haphazard' && (
              <>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={haphazardBiasConfirmed}
                    onChange={(e) => {
                      invalidateFrom('selection')
                      setHaphazardBiasConfirmed(e.target.checked)
                    }}
                  />
                  <span>
                    I confirm this selection was made without conscious bias.
                  </span>
                </label>
                <p className="lead-inline">
                  Select exactly {sampleDesign.confirmedSize} population items (
                  {haphazardIds.length} selected).
                </p>
                <div className="pick-list">
                  {activePop.map((t) => (
                    <label key={t.id} className="pick-item">
                      <input
                        type="checkbox"
                        checked={haphazardIds.includes(t.id)}
                        onChange={() => toggleHaphazard(t.id)}
                      />
                      <span>
                        {t.id} · {displayRowId(t)} ·{' '}
                        {formatMoney(t.coverageAmount)}
                      </span>
                    </label>
                  ))}
                </div>
              </>
            )}

            <div className="actions">
              <button type="button" className="ghost" onClick={goBack}>
                Back
              </button>
              <button type="button" className="primary" onClick={runSelection}>
                Select {sampleDesign.confirmedSize} items
              </button>
            </div>
          </section>
        )}

        {step === 'testing' && (
          <section className="card">
            <div className="stat-grid">
              <div>
                <span>Sample selected</span>
                <strong>{selected.length}</strong>
              </div>
              <div>
                <span>Sample coverage</span>
                <strong>{formatMoney(selectedCoverage)}</strong>
              </div>
              <div>
                <span>Population</span>
                <strong>{activePop.length}</strong>
              </div>
            </div>

            {designInputs.sampleSizePath === 'pathB' && pathBReview && (
              <>
                <div className="stat-grid">
                  <div>
                    <span>Path B selected coverage</span>
                    <strong>{formatMoney(pathBReview.selectedCoverage)}</strong>
                  </div>
                  <div>
                    <span>Coverage achieved</span>
                    <strong>
                      {pathBReview.coverageAchievedPercent.toFixed(1)}%
                    </strong>
                  </div>
                  <div>
                    <span>Untested count / value</span>
                    <strong>
                      {pathBReview.untestedCount} /{' '}
                      {formatMoney(pathBReview.untestedValue)}
                    </strong>
                  </div>
                  <div>
                    <span>Required coverage</span>
                    <strong>
                      {formatMoney(
                        sizeSuggestion.pathBDetail?.requiredCoverageValue ?? 0,
                      )}
                    </strong>
                  </div>
                </div>
                {pathBReview.belowRequired && (
                  <div className="banner error">{PATH_B_BELOW_REQUIRED_WARNING}</div>
                )}
              </>
            )}

            <h3>Sample testing</h3>
            {selected.length === 0 ? (
              <p className="lead-inline">No sample items selected.</p>
            ) : (
              <div className="preview-table-wrap preview-table-all">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Voucher / Acct</th>
                      <th>Coverage</th>
                      <th>Tested</th>
                      <th>Exception</th>
                      <th>Exception value</th>
                      <th>Nature</th>
                      <th>Notes</th>
                      <th>§20 Remove</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.map((t) => {
                      const row = testing.find((x) => x.transactionId === t.id)
                      return (
                        <tr key={`test-${t.id}`}>
                          <td>{t.id}</td>
                          <td>{displayRowId(t)}</td>
                          <td>{formatMoney(t.coverageAmount)}</td>
                          <td>
                            <input
                              type="checkbox"
                              checked={row?.tested ?? false}
                              onChange={(e) =>
                                updateTesting(t.id, { tested: e.target.checked })
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              checked={row?.exception ?? false}
                              onChange={(e) =>
                                updateTesting(t.id, { exception: e.target.checked })
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              value={row?.exceptionValue ?? 0}
                              onChange={(e) =>
                                updateTesting(t.id, {
                                  exceptionValue: Number(e.target.value),
                                })
                              }
                            />
                          </td>
                          <td>
                            <input
                              value={row?.nature ?? ''}
                              onChange={(e) =>
                                updateTesting(t.id, { nature: e.target.value })
                              }
                            />
                          </td>
                          <td>
                            <input
                              value={row?.notes ?? ''}
                              onChange={(e) =>
                                updateTesting(t.id, { notes: e.target.value })
                              }
                            />
                          </td>
                          <td>
                            <div className="row-actions">
                              <input
                                className="exclude-input"
                                placeholder="Removal reason"
                                value={removeDrafts[t.id] ?? ''}
                                onChange={(e) =>
                                  setRemoveDrafts((prev) => ({
                                    ...prev,
                                    [t.id]: e.target.value,
                                  }))
                                }
                              />
                              <button
                                type="button"
                                className="small-btn"
                                onClick={() => removeSelectedItem(t.id)}
                              >
                                Remove from sample
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {designInputs.sampleSizePath === 'pathB' && (
              <>
                <label htmlFor="untestedRemainderBasis">
                  Untested remainder basis (required for Path B)
                </label>
                <textarea
                  id="untestedRemainderBasis"
                  rows={3}
                  value={evaluation.untestedRemainderBasis}
                  onChange={(e) =>
                    setEvaluation((prev) => ({
                      ...prev,
                      untestedRemainderBasis: e.target.value,
                    }))
                  }
                />
                {pathBReview?.belowRequired && (
                  <>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={pathBCoverageAccepted}
                        onChange={(e) =>
                          setPathBCoverageAccepted(e.target.checked)
                        }
                      />
                      <span>
                        I accept Path B coverage below the required amount with
                        documented reviewer rationale (or will increase size and
                        re-run).
                      </span>
                    </label>
                    <label htmlFor="pathBCoverageRationale">
                      Path B coverage shortfall rationale (min 20 characters)
                    </label>
                    <textarea
                      id="pathBCoverageRationale"
                      rows={3}
                      value={pathBCoverageRationale}
                      onChange={(e) => setPathBCoverageRationale(e.target.value)}
                    />
                  </>
                )}
              </>
            )}

            <label htmlFor="natureSummary">Nature of exceptions summary</label>
            <textarea
              id="natureSummary"
              rows={2}
              value={evaluation.natureSummary}
              onChange={(e) =>
                setEvaluation((prev) => ({ ...prev, natureSummary: e.target.value }))
              }
            />

            <div className="form-grid grid-3">
              <div>
                <label htmlFor="widerIssue">Wider issue indicated?</label>
                <select
                  id="widerIssue"
                  value={evaluation.widerIssue}
                  onChange={(e) =>
                    setEvaluation((prev) => ({
                      ...prev,
                      widerIssue: e.target.value as EvaluationState['widerIssue'],
                    }))
                  }
                >
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                  <option value="unclear">Unclear</option>
                </select>
              </div>
              <div>
                <label htmlFor="furtherTesting">Further testing?</label>
                <select
                  id="furtherTesting"
                  value={evaluation.furtherTesting}
                  onChange={(e) =>
                    setEvaluation((prev) => ({
                      ...prev,
                      furtherTesting: e.target.value as EvaluationState['furtherTesting'],
                    }))
                  }
                >
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </div>
            </div>

            <label htmlFor="conclusion">Auditor conclusion (required)</label>
            <textarea
              id="conclusion"
              rows={4}
              value={evaluation.conclusion}
              onChange={(e) =>
                setEvaluation((prev) => ({ ...prev, conclusion: e.target.value }))
              }
            />

            <label htmlFor="reviewerComments">Reviewer comments</label>
            <textarea
              id="reviewerComments"
              rows={2}
              value={evaluation.reviewerComments}
              onChange={(e) =>
                setEvaluation((prev) => ({
                  ...prev,
                  reviewerComments: e.target.value,
                }))
              }
            />

            <div className="actions">
              <button type="button" className="ghost" onClick={goBack}>
                Back
              </button>
              <button type="button" className="primary" onClick={finishTesting}>
                Generate working paper
              </button>
            </div>
          </section>
        )}

        {step === 'workingPaper' && (
          <section className="card working-paper">
            <div className="actions">
              <button type="button" className="ghost" onClick={() => window.print()}>
                Print
              </button>
              <button type="button" className="ghost" onClick={resetAll}>
                New engagement
              </button>
            </div>

            <h2>Non-Statistical Audit Sampling — Working Paper</h2>
            <p>
              Tool version {TOOL_VERSION}
              {configSnapshot ? ` · Config captured ${configSnapshot.capturedAt}` : ''}
            </p>

            <h3>Header</h3>
            <p>
              <strong>WP reference:</strong> {engagement.wpReference || '—'}
              <br />
              <strong>Client:</strong> {engagement.clientName || '—'}
              <br />
              <strong>Audit area:</strong> {engagement.auditArea || '—'}
              <br />
              <strong>Period:</strong> {engagement.period || '—'}
            </p>

            <h3>Objective & assertions</h3>
            <p>
              <strong>Objective:</strong> {engagement.objective || '—'}
              <br />
              <strong>Test type:</strong> {engagement.testType || '—'}
              <br />
              <strong>Assertion:</strong> {engagement.assertion || '—'}
              <br />
              <strong>Sampling unit:</strong> {engagement.samplingUnit || '—'}
              <br />
              <strong>Error definition:</strong> {engagement.errorDefinition || '—'}
              <br />
              <strong>Sample size path:</strong>{' '}
              {designInputs.sampleSizePath === 'pathA'
                ? 'Path A — Risk matrix'
                : 'Path B — Value coverage'}
              <br />
              {designInputs.sampleSizePath === 'pathA' ? (
                <>
                  <strong>Path A scores:</strong> risk{' '}
                  {designInputs.pathA.riskLevel} (
                  {scoreLabel(designInputs.pathA.riskLevel, 'riskLevel')}); expected
                  error {designInputs.pathA.expectedError} (
                  {scoreLabel(designInputs.pathA.expectedError, 'expectedError')});
                  other evidence {designInputs.pathA.otherEvidence} (
                  {scoreLabel(designInputs.pathA.otherEvidence, 'otherEvidence')})
                  <br />
                  <strong>Mapped risk level:</strong>{' '}
                  {riskLevelLabel(designInputs.riskLevel)}
                </>
              ) : (
                <>
                  <strong>Path B:</strong>{' '}
                  {sizeSuggestion.pathBDetail
                    ? `Tier ${sizeSuggestion.pathBDetail.tier}; ${Math.round(sizeSuggestion.pathBDetail.coveragePercent * 100)}% coverage; required ${formatMoney(sizeSuggestion.pathBDetail.requiredCoverageValue)}`
                    : 'Value coverage tier guidance'}
                </>
              )}
            </p>

            <h3>Population source</h3>
            <p>
              <strong>File:</strong> {ledger?.fileName || '—'}
              <br />
              <strong>File hash:</strong> {ledger?.fileHash || '—'}
              <br />
              <strong>Extracted data hash:</strong> {dataHash}
              <br />
              <strong>Worksheet:</strong>{' '}
              {ledger?.sheets[sheetIndex]?.name || '—'} (header row {headerRow + 1};
              data rows {dataStart + 1}–{dataEnd + 1})
              <br />
              <strong>Population confirmed:</strong>{' '}
              {populationConfirmed ? 'Yes (count & coverage value)' : 'No'}
              <br />
              <strong>Confirmed active count:</strong> {activePop.length}
              <br />
              <strong>Confirmed coverage value:</strong> {formatMoney(coverageTotal)}
            </p>

            <h3>Mapping summary</h3>
            <ul>
              {MAPPING_FIELD_ORDER.map((field) => (
                <li key={`map-sum-${field}`}>
                  {field === 'date' && !dateHeaderPresent
                    ? DATE_OPTIONAL_LABEL
                    : STANDARD_FIELD_LABELS[field]}
                  :{' '}
                  {mapping[field].columnIndex == null
                    ? 'not mapped'
                    : `column ${mapping[field].columnIndex + 1} (${headers[mapping[field].columnIndex!] ?? '—'})`}
                </li>
              ))}
            </ul>

            {summary.excludedCount > 0 && (
              <>
                <h3>Cleaning / exclusion summary</h3>
                <p>
                  Original {summary.originalCount} ({formatMoney(summary.originalValue)})
                  → cleaned {summary.cleanedCount} ({formatMoney(summary.cleanedValue)});
                  excluded {summary.excludedCount} ({formatMoney(summary.excludedValue)}
                  ). Flags: totals {summary.flaggedTotals}, opening/closing{' '}
                  {summary.flaggedOpeningClosing}, zero/negative{' '}
                  {summary.flaggedZeroNegative}, duplicates {summary.flaggedDuplicates}{' '}
                  (not auto-excluded).
                </p>
                {summary.byReason.length > 0 && (
                  <ul>
                    {summary.byReason.map((r) => (
                      <li key={r.reason}>
                        {r.reason}: {r.count} ({formatMoney(r.value)})
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {designInputs.sampleSizePath === 'pathB' && (
              <>
                <h3>Path B coverage</h3>
                <p>
                  <strong>Required coverage:</strong>{' '}
                  {formatMoney(
                    sizeSuggestion.pathBDetail?.requiredCoverageValue ?? 0,
                  )}
                  <br />
                  <strong>Selected coverage:</strong>{' '}
                  {formatMoney(pathBReview?.selectedCoverage ?? selectedCoverage)}
                  <br />
                  <strong>Coverage %:</strong>{' '}
                  {pathBReview
                    ? `${pathBReview.coverageAchievedPercent.toFixed(1)}%`
                    : '—'}
                  <br />
                  <strong>Untested remainder:</strong>{' '}
                  {pathBReview
                    ? `${pathBReview.untestedCount} items / ${formatMoney(pathBReview.untestedValue)}`
                    : '—'}
                  <br />
                  <strong>Auditor basis (untested remainder):</strong>{' '}
                  {evaluation.untestedRemainderBasis || '—'}
                  {pathBReview?.belowRequired ? (
                    <>
                      <br />
                      <strong>Below-required acceptance:</strong>{' '}
                      {pathBCoverageAccepted ? 'Yes' : 'No'}
                      {pathBCoverageRationale
                        ? ` — ${pathBCoverageRationale}`
                        : ''}
                    </>
                  ) : null}
                </p>
              </>
            )}

            <h3>Sampling risk</h3>
            <p>{SAMPLING_RISK_STATEMENT}</p>
            <p>
              Accepted: {sampleDesign.samplingRiskAccepted ? 'Yes' : 'No'}
            </p>

            <h3>Sample size rationale</h3>
            <p>
              <strong>Size rule:</strong>{' '}
              {sampleDesign.sizeRuleLabel || sizeSuggestion.ruleLabel || '—'}
              <br />
              Suggested {sampleDesign.suggestedSize}
              {sampleDesign.coveragePercentUsed != null
                ? ` (${Math.round(sampleDesign.coveragePercentUsed * 100)}% coverage)`
                : ''}
              ; confirmed {sampleDesign.confirmedSize}. Rationale:{' '}
              {sampleDesign.sizeRationale || '—'}
              {sampleDesign.sizeReviewerApproved
                ? ' (size reduction reviewer-approved).'
                : ''}
            </p>

            <h3>Selection method</h3>
            <p>
              Recommended: {methodLabel(sampleDesign.recommendedMethod)}. Selected:{' '}
              {methodLabel(sampleDesign.selectedMethod)}. Method approved:{' '}
              {sampleDesign.methodApproved ? 'Yes' : 'No'}
              {sampleDesign.methodOverrideReason
                ? `. Override reason: ${sampleDesign.methodOverrideReason}`
                : ''}
              .
            </p>

            <h3>Reproducibility details</h3>
            {selectionMeta ? (
              <p>
                Method {methodLabel(selectionMeta.method)}; timestamp{' '}
                {selectionMeta.timestamp}; tool {selectionMeta.toolVersion}; data hash{' '}
                {selectionMeta.dataHash}
                {selectionMeta.seed ? `; seed ${selectionMeta.seed}` : ''}
                {selectionMeta.rngAlgorithm
                  ? `; RNG ${selectionMeta.rngAlgorithm}`
                  : ''}
                {selectionMeta.interval != null
                  ? `; interval ${selectionMeta.interval}`
                  : ''}
                {selectionMeta.randomStart != null
                  ? `; random start ${selectionMeta.randomStart}`
                  : ''}
                {selectionMeta.blockStart != null
                  ? `; block start ${selectionMeta.blockStart}`
                  : ''}
                {selectionMeta.sortBasis ? `; sort ${selectionMeta.sortBasis}` : ''}
                {selectionMeta.patternWarning
                  ? `. Warning: ${selectionMeta.patternWarning}`
                  : ''}
                .
              </p>
            ) : (
              <p>No selection meta recorded.</p>
            )}

            <h3>Selected sample items</h3>
            <div className="preview-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Date</th>
                    <th>Voucher / Acct</th>
                    <th>Description</th>
                    <th>Coverage</th>
                    <th>Exception</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.length === 0 ? (
                    <tr>
                      <td colSpan={6}>None.</td>
                    </tr>
                  ) : (
                    selected.map((t) => {
                      const row = testing.find((x) => x.transactionId === t.id)
                      return (
                        <tr key={`wp-sel-${t.id}`}>
                          <td>{t.id}</td>
                          <td>{t.date || '—'}</td>
                          <td>{t.voucherNo || '—'}</td>
                          <td>{t.description || '—'}</td>
                          <td>{formatMoney(t.coverageAmount)}</td>
                          <td>
                            {row?.exception
                              ? `Yes (${formatMoney(row.exceptionValue)}) ${row.nature}`
                              : 'No'}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            <h3>Evaluation</h3>
            <p>
              Exceptions: {evaluation.exceptionCount} (
              {formatMoney(evaluation.exceptionValue)}). Wider issue:{' '}
              {evaluation.widerIssue}. Further testing: {evaluation.furtherTesting}.
            </p>
            <p>
              <strong>Conclusion:</strong> {evaluation.conclusion || '—'}
            </p>
            {evaluation.natureSummary && (
              <p>
                <strong>Nature summary:</strong> {evaluation.natureSummary}
              </p>
            )}
            {evaluation.untestedRemainderBasis && (
              <p>
                <strong>Untested remainder basis:</strong>{' '}
                {evaluation.untestedRemainderBasis}
              </p>
            )}
            {evaluation.reviewerComments && (
              <p>
                <strong>Reviewer comments:</strong> {evaluation.reviewerComments}
              </p>
            )}

            <h3>Firm config snapshot</h3>
            {configSnapshot ? (
              <pre className="config-snapshot">
                {JSON.stringify(configSnapshot, null, 2)}
              </pre>
            ) : (
              <p>No config snapshot captured.</p>
            )}

            <h3>Prepared / reviewed by & lock</h3>
            <div className="form-grid grid-3">
              <div>
                <label htmlFor="preparedBy">Prepared by</label>
                <input
                  id="preparedBy"
                  value={signOff.preparedBy}
                  disabled={signOff.locked}
                  onChange={(e) =>
                    setSignOff((prev) => ({
                      ...prev,
                      preparedBy: e.target.value,
                      reviewStatus:
                        prev.reviewStatus === 'draft' ? 'prepared' : prev.reviewStatus,
                      preparedDate: prev.preparedDate || todayIsoDate(),
                    }))
                  }
                />
              </div>
              <div>
                <label htmlFor="preparedDate">Prepared date</label>
                <input
                  id="preparedDate"
                  type="date"
                  value={signOff.preparedDate}
                  disabled={signOff.locked}
                  onChange={(e) =>
                    setSignOff((prev) => ({ ...prev, preparedDate: e.target.value }))
                  }
                />
              </div>
              <div>
                <label htmlFor="reviewedBy">Reviewed by</label>
                <input
                  id="reviewedBy"
                  value={signOff.reviewedBy}
                  disabled={signOff.locked}
                  onChange={(e) =>
                    setSignOff((prev) => ({
                      ...prev,
                      reviewedBy: e.target.value,
                      reviewStatus: e.target.value.trim()
                        ? 'reviewed'
                        : prev.preparedBy
                          ? 'prepared'
                          : 'draft',
                      reviewedDate: prev.reviewedDate || todayIsoDate(),
                    }))
                  }
                />
              </div>
              <div>
                <label htmlFor="reviewedDate">Reviewed date</label>
                <input
                  id="reviewedDate"
                  type="date"
                  value={signOff.reviewedDate}
                  disabled={signOff.locked}
                  onChange={(e) =>
                    setSignOff((prev) => ({ ...prev, reviewedDate: e.target.value }))
                  }
                />
              </div>
              <div>
                <label htmlFor="reviewStatus">Review status</label>
                <select
                  id="reviewStatus"
                  value={signOff.reviewStatus}
                  disabled={signOff.locked}
                  onChange={(e) =>
                    setSignOff((prev) => ({
                      ...prev,
                      reviewStatus: e.target.value as SignOffState['reviewStatus'],
                    }))
                  }
                >
                  <option value="draft">draft</option>
                  <option value="prepared">prepared</option>
                  <option value="reviewed">reviewed</option>
                  <option value="locked">locked</option>
                </select>
              </div>
            </div>

            <p className="lead-inline">
              File assembly guidance: lock within {FILE_ASSEMBLY_DEADLINE_DAYS} days of
              the report date / period end (firm policy). Current deadline field:{' '}
              {signOff.fileAssemblyDeadline || 'not set (set on lock)'}.
            </p>

            <label htmlFor="amendmentNote">Amendment note</label>
            <textarea
              id="amendmentNote"
              rows={2}
              value={signOff.amendmentNote}
              onChange={(e) => {
                const note = e.target.value
                setSignOff((prev) => ({
                  ...prev,
                  amendmentNote: note,
                  amendmentReviewerApproved:
                    prev.locked && note !== prev.amendmentNote
                      ? false
                      : prev.amendmentReviewerApproved,
                }))
              }}
            />
            {signOff.locked && signOff.amendmentNote.trim() && (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={signOff.amendmentReviewerApproved}
                  onChange={(e) =>
                    setSignOff((prev) => ({
                      ...prev,
                      amendmentReviewerApproved: e.target.checked,
                    }))
                  }
                />
                <span>
                  Amendment reviewer approves changes after lock (required when
                  amendment note is edited while locked).
                </span>
              </label>
            )}

            <p>
              <strong>Lock status:</strong>{' '}
              {signOff.locked
                ? `Locked on ${signOff.lockDate || '—'}`
                : 'Not locked'}
            </p>

            <div className="actions">
              <button
                type="button"
                className="primary"
                onClick={lockWorkingPaper}
                disabled={
                  signOff.locked &&
                  !!signOff.amendmentNote.trim() &&
                  !signOff.amendmentReviewerApproved
                }
              >
                {signOff.locked ? 'Confirm lock / amendment' : 'Lock working paper'}
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
