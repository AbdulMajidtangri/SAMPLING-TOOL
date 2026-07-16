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
import { type MainScreenId } from './lib/navigation'

const STEPS: WizardStep[] = [
  'upload',
  'worksheet',
  'mapping',
  'confirm',
  'planning',
  'design',
  'selection',
  'testing',
  'evaluation',
]

const WORKSPACE_SECTIONS: Array<{
  id: WizardStep
  title: string
  blurb: string
}> = [
  { id: 'upload', title: '1. Upload', blurb: 'Add the Excel file' },
  { id: 'mapping', title: '2. Map columns', blurb: 'Match Date, Voucher, Amounts' },
  { id: 'confirm', title: '3. Check data', blurb: 'Fix warnings, then confirm' },
  { id: 'planning', title: '4. Audit details', blurb: 'Client info + Path A or B' },
  { id: 'design', title: '5. Sample size', blurb: 'Confirm how many to test' },
  { id: 'selection', title: '6. Pick sample', blurb: 'Choose the transactions' },
  { id: 'testing', title: '7. Selected items', blurb: 'Review list & open WP' },
]

const DEFAULT_SIZE_RATIONALE =
  'Accepted suggested population coverage per firm guidance.'
const DEFAULT_SAMPLING_UNIT = 'Individual expense voucher / document'
const DEFAULT_HIGH_VALUE_BASIS =
  'Absolute coverage amount at or above the stated threshold (specific testing, not sampling).'
const PATH_B_BELOW_REQUIRED_WARNING =
  'Selected coverage is below the required coverage value. Increase sample size and re-run selection if needed.'

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

type PathBReview = ReturnType<typeof pathBPostSelectionReview>

function defaultSignOff(): SignOffState {
  return {
    preparedBy: '',
    preparedDate: '',
    reviewedBy: '',
    reviewedDate: '',
    reviewExtent:
      'Reviewed the sample selection schedule, population source, and identifying characteristics of selected items.',
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
  const [screen, setScreen] = useState<MainScreenId>('samplingWorkspace')
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
  const [sizeWarning, setSizeWarning] = useState('')

  const [blockStart, setBlockStart] = useState(0)
  const [blockRationale, setBlockRationale] = useState('')
  const [haphazardIds, setHaphazardIds] = useState<string[]>([])
  const [haphazardBiasConfirmed, setHaphazardBiasConfirmed] = useState(false)

  const [selected, setSelected] = useState<LedgerTransaction[]>([])
  const [selectionMeta, setSelectionMeta] = useState<SelectionMeta | null>(null)
  const [pathBReview, setPathBReview] = useState<PathBReview | null>(null)
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
    return suggestSampleSizeForPath({
      path: designInputs.sampleSizePath,
      pathA: designInputs.pathA,
      transactions: activePop,
    })
  }, [
    activePop,
    designInputs.sampleSizePath,
    designInputs.pathA,
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
  const selectedForTesting = useMemo(
    () => [...selected].sort((a, b) => a.rowIndex - b.rowIndex),
    [selected],
  )
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

  function pathBZeroCoverageError(): string | null {
    if (
      designInputs.sampleSizePath === 'pathB' &&
      totalCoverageValue(activePop) <= 0
    ) {
      return 'Path B cannot be used when total coverage value is zero.'
    }
    return null
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
      setSizeWarning('')
    }
    if (idx <= selectionIdx) {
      setSelected([])
      setSelectionMeta(null)
      setPathBReview(null)
    }
    if (idx < selectionIdx) {
      setBlockStart(0)
      setBlockRationale('')
      setHaphazardIds([])
      setHaphazardBiasConfirmed(false)
    }
    if (idx <= testingIdx) {
      setConfigSnapshot(null)
      setSignOff(defaultSignOff())
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
    const suggestion = suggestSampleSizeForPath({
      path: designInputs.sampleSizePath,
      pathA: designInputs.pathA,
      transactions: pop,
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
      if (review.belowRequired) {
        nextWarnings = [PATH_B_BELOW_REQUIRED_WARNING]
      }
    } else {
      setPathBReview(null)
    }
    setWarnings(nextWarnings)
    setStep('testing')
  }

  function finishTesting() {
    if (selected.length === 0) {
      setError('Select sample items before opening the working paper.')
      return
    }

    setError('')
    setConfigSnapshot(captureFirmConfigSnapshot())
    setSignOff((prev) => ({
      ...prev,
      reviewStatus: prev.preparedBy ? 'prepared' : 'draft',
      fileAssemblyDeadline: prev.fileAssemblyDeadline,
    }))
    setStep('testing')
    setScreen('workingPaper')
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
    setScreen('samplingWorkspace')
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
    setSizeWarning('')
    setBlockStart(0)
    setBlockRationale('')
    setHaphazardIds([])
    setHaphazardBiasConfirmed(false)
    setSelected([])
    setSelectionMeta(null)
    setPathBReview(null)
    setSignOff(defaultSignOff())
    setConfigSnapshot(null)
  }

  const summary = populationSummary ?? liveSummary

  const activeWorkspaceStep: WizardStep =
    step === 'worksheet'
      ? 'mapping'
      : step === 'evaluation' || step === 'workingPaper'
        ? 'testing'
        : step

  const stepOrderIndex = (id: WizardStep) => {
    const mapped =
      id === 'worksheet'
        ? 'mapping'
        : id === 'evaluation' || id === 'workingPaper'
          ? 'testing'
          : id
    return WORKSPACE_SECTIONS.findIndex((s) => s.id === mapped)
  }

  const currentSectionIndex = Math.max(0, stepOrderIndex(activeWorkspaceStep))

  const sectionUnlocked = (id: WizardStep) => {
    if (id === 'upload') return true
    if (id === 'mapping') return !!ledger
    if (id === 'confirm') return transactions.length > 0
    if (id === 'planning') return populationConfirmed
    if (id === 'design') return currentSectionIndex >= stepOrderIndex('design') || sampleDesign.suggestedSize > 0
    if (id === 'selection') return currentSectionIndex >= stepOrderIndex('selection')
    if (id === 'testing') return selected.length > 0 || currentSectionIndex >= stepOrderIndex('testing')
    return false
  }

  const sectionDone = (id: WizardStep) => {
    if (id === 'upload') return !!ledger
    if (id === 'mapping') return transactions.length > 0
    if (id === 'confirm') return populationConfirmed
    if (id === 'planning') return sampleDesign.suggestedSize > 0
    if (id === 'design') return currentSectionIndex > stepOrderIndex('design')
    if (id === 'selection') return selected.length > 0
    if (id === 'testing') return selected.length > 0
    return false
  }

  const statusLabel = !ledger
    ? 'Start by uploading a ledger'
    : transactions.length === 0
      ? 'Next: map the columns'
      : !populationConfirmed
        ? 'Next: check data & confirm'
        : selected.length === 0
          ? sampleDesign.confirmedSize > 0 && currentSectionIndex >= stepOrderIndex('selection')
            ? 'Next: pick the sample'
            : 'Next: set sample size'
          : 'Ready — open working paper'

  const nextStepHint = !ledger
    ? 'Upload the client Excel file to begin.'
    : transactions.length === 0
      ? 'Match the required columns, then click Confirm mapping.'
      : !populationConfirmed
        ? 'Resolve any red warnings, then confirm the population.'
        : sampleDesign.suggestedSize === 0
          ? 'Fill audit details, choose Path A or B, then calculate sample size.'
          : currentSectionIndex < stepOrderIndex('selection')
            ? 'Confirm the sample size, then continue.'
            : selected.length === 0
              ? 'Select the transactions for your sample.'
              : 'Review the selected items, then open the working paper.'

  const canOpenWorkingPaper = selected.length > 0

  function goToSection(id: WizardStep) {
    if (!sectionUnlocked(id) && id !== 'upload') return
    setScreen('samplingWorkspace')
    if (id === 'mapping' && ledger) setStep(transactions.length ? 'mapping' : 'worksheet')
    else setStep(id)
    requestAnimationFrame(() => {
      document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  function openWorkingPaperPreview() {
    if (!configSnapshot) {
      finishTesting()
      return
    }
    setScreen('workingPaper')
  }

  const sectionClass = (section: WizardStep) => {
    const active = activeWorkspaceStep === section || (section === 'mapping' && (step === 'worksheet' || step === 'mapping'))
    const unlocked = sectionUnlocked(section)
    const done = sectionDone(section)
    return [
      'ws-card',
      active ? 'is-active' : '',
      done ? 'is-done' : '',
      !unlocked ? 'is-locked' : '',
    ]
      .filter(Boolean)
      .join(' ')
  }

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="topbar-brand">
          <div className="brand-mark" aria-hidden="true" />
          <div>
            <p className="brand">Audit Sampling</p>
            <p className="file-chip">{ledger?.fileName ?? 'No file yet'}</p>
          </div>
        </div>
        <div className="topbar-spacer" aria-hidden="true" />
        <div className="topbar-status">
          <span className={`status-dot ${ledger ? 'on' : ''}`} />
          <span>{statusLabel}</span>
        </div>
      </header>

      {error && <div className="banner error floating-banner">{error}</div>}
      {warnings.length > 0 && screen === 'samplingWorkspace' && (
        <div className="banner warn floating-banner">
          {warnings.slice(0, 4).map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      )}

      {screen === 'samplingWorkspace' ? (
        <div className="workspace-layout">
          <aside className="progress-rail" aria-label="Workspace progress">
            <p className="rail-title">Your steps</p>
            <p className="next-hint">{nextStepHint}</p>
            <ol className="rail-list">
              {WORKSPACE_SECTIONS.map((section, index) => {
                const unlocked = sectionUnlocked(section.id)
                const done = sectionDone(section.id)
                const active = currentSectionIndex === index
                return (
                  <li key={section.id}>
                    <button
                      type="button"
                      className={[
                        'rail-item',
                        active ? 'is-active' : '',
                        done ? 'is-done' : '',
                        !unlocked ? 'is-locked' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      disabled={!unlocked}
                      onClick={() => goToSection(section.id)}
                    >
                      <span className="rail-num">{done ? '✓' : index + 1}</span>
                      <span>
                        <strong>{section.title}</strong>
                        <em>{section.blurb}</em>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
            {(configSnapshot || canOpenWorkingPaper) && (
              <button
                type="button"
                className="primary summary-cta rail-wp-btn"
                onClick={openWorkingPaperPreview}
              >
                Open working paper
              </button>
            )}
          </aside>

          <main className="workspace-main">
            <section id="section-upload" className={sectionClass('upload')}>
              <div className="ws-card-head">
                <div>
                  <p className="section-kicker">Step 1</p>
                  <h2>Upload the ledger</h2>
                  <p className="section-lead">
                    Choose the Excel file. Then pick the worksheet that has the
                    transactions.
                  </p>
                </div>
              </div>

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

              <div className="upload-panel">
                <button
                  type="button"
                  className="primary upload-cta"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {busy ? 'Reading file…' : ledger ? 'Replace ledger' : 'Upload ledger'}
                </button>
                <p className="hint">Excel (.xlsx, .xls) or CSV</p>
                {ledger && (
                  <div className="upload-meta">
                    <div>
                      <span>File</span>
                      <strong>{ledger.fileName}</strong>
                    </div>
                    <div>
                      <span>Worksheets</span>
                      <strong>{ledger.sheets.length}</strong>
                    </div>
                    <div>
                      <span>File hash</span>
                      <strong className="mono">{ledger.fileHash.slice(0, 12)}…</strong>
                    </div>
                  </div>
                )}
              </div>

              {ledger && (
                <div className="form-block">
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
                    <button
                      type="button"
                      className="primary"
                      onClick={() => {
                        setStep('mapping')
                        goToSection('mapping')
                      }}
                    >
                      Continue
                    </button>
                  </div>
                </div>
              )}
            </section>

            {ledger && sheet && (
              <section id="section-mapping" className={sectionClass('mapping')}>
                <div className="ws-card-head">
                  <div>
                    <p className="section-kicker">Step 2</p>
                    <h2>Map the columns</h2>
                    <p className="section-lead">
                      Check the header row, then match Date, Voucher No, Description,
                      Debit, and Credit. Extra columns are fine.
                    </p>
                  </div>
                </div>

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

                <h3 className="map-heading">Required field mapping</h3>
                {mappingErrors.length > 0 && (
                  <div className="banner error">{mappingErrors.join('  •  ')}</div>
                )}
                {needsChoiceFields.length > 0 && (
                  <div className="banner error">
                    Multiple strong matches need your choice:{' '}
                    {needsChoiceFields.map((f) => STANDARD_FIELD_LABELS[f]).join(', ')}.
                  </div>
                )}

                {MAPPING_FIELD_ORDER.map((field) => {
                  const state = mapping[field]
                  const fieldLabel =
                    field === 'date' && !dateHeaderPresent
                      ? DATE_OPTIONAL_LABEL
                      : STANDARD_FIELD_LABELS[field]
                  return (
                    <div className="map-row" key={field}>
                      <div>
                        <strong>{fieldLabel}</strong>
                        <span className={confidenceClass(state.confidence)}>
                          {state.columnIndex == null
                            ? 'not mapped'
                            : state.confidence === 'high'
                              ? 'high confidence'
                              : state.confidence === 'medium'
                                ? 'medium confidence'
                                : state.confidence === 'low'
                                  ? 'low confidence'
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
                      </div>
                    </div>
                  )
                })}

                <div className="actions">
                  <button
                    type="button"
                    className="primary"
                    onClick={confirmMappingAndBuild}
                    disabled={mappingBlocked}
                  >
                    Confirm mapping
                  </button>
                </div>
              </section>
            )}

            {transactions.length > 0 && (
              <section id="section-confirm" className={sectionClass('confirm')}>
                <div className="ws-card-head">
                  <div>
                    <p className="section-kicker">Step 3</p>
                    <h2>Check the data</h2>
                    <p className="section-lead">
                      Fix any red warnings (like both Debit and Credit filled). Then
                      confirm the list you will sample from.
                    </p>
                  </div>
                </div>

                <div className="stat-grid">
                  <div>
                    <span>Active transactions</span>
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
                    <span>Duplicate vouchers</span>
                    <strong>{flaggedDuplicates.length}</strong>
                  </div>
                </div>

                {unresolvedCount > 0 && (
                  <div className="banner error">
                    {unresolvedCount} row(s) have both Debit and Credit. Resolve each before
                    continuing.
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
                                  <button type="button" className="small-btn" onClick={() => resolveRow(t.id, 'useDebit')}>Use Debit</button>
                                  <button type="button" className="small-btn" onClick={() => resolveRow(t.id, 'useCredit')}>Use Credit</button>
                                  <button type="button" className="small-btn" onClick={() => resolveRow(t.id, 'useMax')}>Use higher</button>
                                  <button type="button" className="small-btn" onClick={() => resolveRow(t.id, 'exclude')}>Exclude</button>
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
                              <button type="button" className="small-btn" onClick={() => restoreRow(t.id)}>Restore</button>
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
                                <button type="button" className="small-btn" onClick={() => excludeRow(t.id)}>Exclude</button>
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
                  <button
                    type="button"
                    className="primary"
                    onClick={continueFromConfirm}
                    disabled={unresolvedCount > 0 || activePop.length === 0}
                  >
                    Confirm population
                  </button>
                </div>
              </section>
            )}

            {populationConfirmed && (
              <section id="section-planning" className={sectionClass('planning')}>
                <div className="ws-card-head">
                  <div>
                    <p className="section-kicker">Step 4</p>
                    <h2>Audit details</h2>
                    <p className="section-lead">
                      Enter client info, then choose how to size the sample: Path A
                      (risk score) or Path B (value coverage).
                    </p>
                  </div>
                </div>

                <div className="form-grid grid-3">
                  <div>
                    <label htmlFor="wpRef">WP reference</label>
                    <input
                      id="wpRef"
                      value={engagement.wpReference}
                      onChange={(e) => {
                        invalidateFrom('planning')
                        setEngagement((prev) => ({ ...prev, wpReference: e.target.value }))
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
                        setEngagement((prev) => ({ ...prev, clientName: e.target.value }))
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
                        setEngagement((prev) => ({ ...prev, auditArea: e.target.value }))
                      }}
                    >
                      {AUDIT_AREA_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
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
                        <option key={opt} value={opt}>{opt}</option>
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
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <label htmlFor="objective">Audit objective</label>
                <textarea
                  id="objective"
                  rows={3}
                  value={engagement.objective}
                  onChange={(e) => {
                    invalidateFrom('planning')
                    setEngagement((prev) => ({ ...prev, objective: e.target.value }))
                  }}
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
                    setEngagement((prev) => ({ ...prev, errorDefinition: e.target.value }))
                  }}
                />

                <h3>Sample-size path</h3>
                <div className="path-chooser" role="radiogroup" aria-label="Sample size path">
                  <label className={`path-card ${designInputs.sampleSizePath === 'pathA' ? 'is-selected' : ''}`}>
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
                      <strong>Path A — Risk score model</strong>
                      <em>Risk + expected error + other evidence → matrix size</em>
                    </span>
                  </label>
                  <label className={`path-card ${designInputs.sampleSizePath === 'pathB' ? 'is-selected' : ''}`}>
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
                        setDesignInputs((prev) => ({ ...prev, sampleSizePath: 'pathB' }))
                      }}
                    />
                    <span>
                      <strong>Path B — Value-based coverage</strong>
                      <em>Provisional sizing suggests size; not the final sample</em>
                    </span>
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
                      <label htmlFor="pathAExpected">Expected error / deviation</label>
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
                      <label htmlFor="pathAEvidence">Other audit evidence</label>
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
                    Path B uses confirmed coverage value, tier rules, floor, and minimum item
                    count. The provisional pass only suggests sample size.
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
                        setDesignInputs((prev) => ({ ...prev, expectedError: e.target.value }))
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
                        setDesignInputs((prev) => ({ ...prev, tolerableError: e.target.value }))
                      }}
                    />
                  </div>
                </div>

                <div className="actions">
                  <button type="button" className="primary" onClick={continueFromPlanning}>
                    Calculate sample size
                  </button>
                </div>
              </section>
            )}

            {sampleDesign.suggestedSize > 0 && (
              <section id="section-design" className={sectionClass('design')}>
                <div className="ws-card-head">
                  <div>
                    <p className="section-kicker">Step 5</p>
                    <h2>Confirm sample size</h2>
                    <p className="section-lead">
                      Accept or adjust how many items to test. You cannot pick the sample
                      until this size is confirmed.
                    </p>
                  </div>
                </div>

                <div className="stat-grid">
                  <div>
                    <span>Confirmed transaction count</span>
                    <strong>{activePop.length}</strong>
                  </div>
                  {designInputs.sampleSizePath === 'pathB' && (
                    <div>
                      <span>Confirmed coverage value</span>
                      <strong>{formatMoney(coverageTotal)}</strong>
                    </div>
                  )}
                  <div>
                    <span>Selected path</span>
                    <strong>
                      {designInputs.sampleSizePath === 'pathA' ? 'Path A — Risk' : 'Path B — Value'}
                    </strong>
                  </div>
                  <div>
                    <span>Suggested size</span>
                    <strong>{sizeSuggestion.suggestedSize}</strong>
                  </div>
                </div>

                <h3>Selection method</h3>
                <p className="lead-inline">
                  Recommended: <strong>{methodLabel(methodRecommendation.recommended)}</strong>
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
                  onChange={(e) => updateDesignMethod(e.target.value as SelectionMethod)}
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
                <p className="lead-inline">{sampleDesign.sizeRuleLabel || sizeSuggestion.ruleLabel}</p>

                {designInputs.sampleSizePath === 'pathA' && sizeSuggestion.pathADetail && (
                  <p className="hint">
                    Path A scores: risk {designInputs.pathA.riskLevel}, expected error{' '}
                    {designInputs.pathA.expectedError}, other evidence{' '}
                    {designInputs.pathA.otherEvidence}. Matrix score{' '}
                    {sizeSuggestion.pathADetail.score} → matrix size{' '}
                    {sizeSuggestion.pathADetail.matrixSize}.
                  </p>
                )}

                {designInputs.sampleSizePath === 'pathB' && sizeSuggestion.pathBDetail && (
                  <p className="hint">
                    Path B tier {sizeSuggestion.pathBDetail.tier}:{' '}
                    {Math.round(sizeSuggestion.pathBDetail.coveragePercent * 100)}% coverage
                    requires {formatMoney(sizeSuggestion.pathBDetail.requiredCoverageValue)}{' '}
                    (provisional {sizeSuggestion.pathBDetail.suggestedSampleSize} items — not
                    final selection).
                  </p>
                )}

                <label htmlFor="confirmedSize">Final confirmed sample size</label>
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

                <label htmlFor="sizeRationale">Auditor rationale</label>
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
                      Reviewer approves reduction below suggested size (
                      {sizeSuggestion.suggestedSize}).
                    </span>
                  </label>
                )}

                {sizeWarning && <div className="banner warn">{sizeWarning}</div>}

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
                  <button type="button" className="primary" onClick={continueFromDesign}>
                    Confirm sample size
                  </button>
                </div>
              </section>
            )}

            {currentSectionIndex >= stepOrderIndex('selection') && (
              <section id="section-selection" className={sectionClass('selection')}>
                <div className="ws-card-head">
                  <div>
                    <p className="section-kicker">Step 6</p>
                    <h2>Pick the sample</h2>
                    <p className="section-lead">
                      Choose the selection method. The tool will pick exactly{' '}
                      {sampleDesign.confirmedSize} transactions.
                    </p>
                  </div>
                </div>

                <div className="stat-grid">
                  <div>
                    <span>Population</span>
                    <strong>{activePop.length}</strong>
                  </div>
                  <div>
                    <span>Confirmed size</span>
                    <strong>{sampleDesign.confirmedSize}</strong>
                  </div>
                  <div>
                    <span>Method</span>
                    <strong>{methodLabel(sampleDesign.selectedMethod)}</strong>
                  </div>
                </div>

                {sampleDesign.selectedMethod === 'systematic' && (
                  <div className="banner warn">
                    Systematic selection may follow a periodicity pattern. Review for pattern
                    risk.
                  </div>
                )}

                {sampleDesign.selectedMethod === 'block' && (
                  <>
                    <label htmlFor="blockStart">Block start index (0-based)</label>
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
                      <span>I confirm this selection was made without conscious bias.</span>
                    </label>
                    <p className="lead-inline">
                      Select exactly {sampleDesign.confirmedSize} items ({haphazardIds.length}{' '}
                      selected).
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
                            {t.id} · {displayRowId(t)} · {formatMoney(t.coverageAmount)}
                          </span>
                        </label>
                      ))}
                    </div>
                  </>
                )}

                <div className="actions">
                  <button type="button" className="primary" onClick={runSelection}>
                    Select transactions
                  </button>
                  {selected.length > 0 && (
                    <button
                      type="button"
                      className="primary"
                      onClick={openWorkingPaperPreview}
                    >
                      Open working paper →
                    </button>
                  )}
                </div>

                {selected.length > 0 && (
                  <>
                    <h3>Selected transactions ({selected.length})</h3>
                    {designInputs.sampleSizePath === 'pathB' && pathBReview && (
                      <div className="stat-grid">
                        <div>
                          <span>Selected coverage</span>
                          <strong>{formatMoney(pathBReview.selectedCoverage)}</strong>
                        </div>
                        <div>
                          <span>Coverage achieved</span>
                          <strong>{pathBReview.coverageAchievedPercent.toFixed(1)}%</strong>
                        </div>
                        <div>
                          <span>Untested remainder value</span>
                          <strong>{formatMoney(pathBReview.untestedValue)}</strong>
                        </div>
                        <div>
                          <span>Untested remainder count</span>
                          <strong>{pathBReview.untestedCount}</strong>
                        </div>
                      </div>
                    )}
                    <div className="preview-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Voucher</th>
                            <th>Description</th>
                            <th>Debit</th>
                            <th>Credit</th>
                            <th>Coverage</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selected.map((t) => (
                            <tr key={`sel-${t.id}`}>
                              <td>{t.date || '—'}</td>
                              <td>{displayRowId(t)}</td>
                              <td>{t.description || '—'}</td>
                              <td>{formatMoney(t.debit)}</td>
                              <td>{formatMoney(t.credit)}</td>
                              <td>{formatMoney(t.coverageAmount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </section>
            )}

            {selected.length > 0 && (
              <section id="section-testing" className={sectionClass('testing')}>
                <div className="ws-card-head">
                  <div>
                    <p className="section-kicker">Step 7</p>
                    <h2>Selected items</h2>
                    <p className="section-lead">
                      These are the transactions selected for testing. Open the working
                      paper to print or export this list — no conclusion is required.
                    </p>
                  </div>
                </div>

                <div className="stat-grid">
                  <div>
                    <span>Selected count</span>
                    <strong>{selected.length}</strong>
                  </div>
                  <div>
                    <span>Selected coverage</span>
                    <strong>{formatMoney(selectedCoverage)}</strong>
                  </div>
                </div>

                <div className="preview-table-wrap preview-table-all">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Date</th>
                        <th>Voucher No</th>
                        <th>Description</th>
                        <th>Debit</th>
                        <th>Credit</th>
                        <th>Coverage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedForTesting.map((t, index) => (
                        <tr key={`finish-${t.id}`}>
                          <td>{index + 1}</td>
                          <td>{t.date || '—'}</td>
                          <td>{displayRowId(t)}</td>
                          <td>{t.description || '—'}</td>
                          <td>{formatMoney(t.debit)}</td>
                          <td>{formatMoney(t.credit)}</td>
                          <td>{formatMoney(t.coverageAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="actions finish-actions">
                  <button
                    type="button"
                    className="primary wp-open-btn"
                    onClick={openWorkingPaperPreview}
                  >
                    Open working paper →
                  </button>
                </div>
              </section>
            )}
          </main>

          <aside className="summary-panel" aria-label="Engagement summary">
            <p className="rail-title">At a glance</p>
            <p className="next-hint">{nextStepHint}</p>
            <div className="summary-stack">
              <div>
                <span>Transactions</span>
                <strong>{activePop.length || '—'}</strong>
              </div>
              <div>
                <span>Coverage value</span>
                <strong>{activePop.length ? formatMoney(coverageTotal) : '—'}</strong>
              </div>
              <div>
                <span>Sample path</span>
                <strong>
                  {populationConfirmed
                    ? designInputs.sampleSizePath === 'pathA'
                      ? 'Path A'
                      : 'Path B'
                    : '—'}
                </strong>
              </div>
              <div>
                <span>Sample size</span>
                <strong>
                  {currentSectionIndex >= stepOrderIndex('selection')
                    ? sampleDesign.confirmedSize
                    : '—'}
                </strong>
              </div>
              <div>
                <span>Method</span>
                <strong>
                  {currentSectionIndex >= stepOrderIndex('selection')
                    ? methodLabel(sampleDesign.selectedMethod)
                    : '—'}
                </strong>
              </div>
              <div>
                <span>Selected</span>
                <strong>{selected.length || '—'}</strong>
              </div>
            </div>
            {(configSnapshot || canOpenWorkingPaper) && (
              <button
                type="button"
                className="primary summary-cta"
                onClick={openWorkingPaperPreview}
              >
                Open working paper →
              </button>
            )}
          </aside>
        </div>
      ) : (
        <div className="wp-screen">
          <div className="wp-toolbar no-print">
            <button
              type="button"
              className="ghost"
              onClick={() => setScreen('samplingWorkspace')}
            >
              ← Back to work
            </button>
            <div className="wp-toolbar-actions">
              <button type="button" className="ghost" onClick={() => window.print()}>
                Print / PDF
              </button>
              <button type="button" className="ghost" onClick={resetAll}>
                New engagement
              </button>
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
                {signOff.locked ? 'Confirm lock' : 'Lock working paper'}
              </button>
            </div>
          </div>

          <article className="working-paper isa230-wp">
            <header className="wp-masthead">
              <div className="wp-std-line">
                <span>Audit documentation</span>
                <span>ISA 230</span>
              </div>
              <h1>Sample Selection Working Paper</h1>
              <p className="wp-subtitle">
                Non-statistical audit sampling — selection schedule (ISA 230 / ISA 530)
              </p>

              <table className="wp-id-table">
                <tbody>
                  <tr>
                    <th scope="row">Client</th>
                    <td>{engagement.clientName || '—'}</td>
                    <th scope="row">Period</th>
                    <td>{engagement.period || '—'}</td>
                  </tr>
                  <tr>
                    <th scope="row">Subject / audit area</th>
                    <td>{engagement.auditArea || '—'}</td>
                    <th scope="row">WP reference</th>
                    <td>{engagement.wpReference || '—'}</td>
                  </tr>
                  <tr>
                    <th scope="row">Prepared by</th>
                    <td>{signOff.preparedBy || '—'}</td>
                    <th scope="row">Date work completed</th>
                    <td>{signOff.preparedDate || '—'}</td>
                  </tr>
                  <tr>
                    <th scope="row">Reviewed by</th>
                    <td>{signOff.reviewedBy || '—'}</td>
                    <th scope="row">Date of review</th>
                    <td>{signOff.reviewedDate || '—'}</td>
                  </tr>
                </tbody>
              </table>
            </header>

            <section>
              <h2>1. Purpose of this working paper</h2>
              <p>
                This working paper records the selection of items for audit testing so that
                an experienced auditor, having no previous connection with the audit, can
                understand the nature, timing and extent of the selection procedures
                performed (ISA 230.8–.9).
              </p>
              <p><strong>Audit objective:</strong> {engagement.objective || '—'}</p>
              <p><strong>Test type:</strong> {engagement.testType || '—'}</p>
              <p><strong>Assertion(s):</strong> {engagement.assertion || '—'}</p>
              <p><strong>Sampling unit:</strong> {engagement.samplingUnit || '—'}</p>
            </section>

            <section>
              <h2>2. Nature of the procedure performed</h2>
              <p>
                Non-statistical sample selection from the client ledger population for the
                subject area above. Selection performed using the tool’s confirmed sample
                design for this engagement.
              </p>
              <p>
                <strong>Selection method:</strong>{' '}
                {methodLabel(sampleDesign.selectedMethod)}
                {sampleDesign.methodOverrideReason
                  ? ` (override rationale: ${sampleDesign.methodOverrideReason})`
                  : ''}
              </p>
              {selectionMeta && (
                <p className="wp-meta-line">
                  Selection recorded {selectionMeta.timestamp}; tool v
                  {selectionMeta.toolVersion}
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
                  .
                </p>
              )}
            </section>

            <section>
              <h2>3. Source of information (population)</h2>
              <p><strong>File:</strong> {ledger?.fileName || '—'}</p>
              <p><strong>File hash:</strong> {ledger?.fileHash || '—'}</p>
              <p><strong>Extracted data hash:</strong> {dataHash || '—'}</p>
              <p>
                <strong>Worksheet:</strong> {ledger?.sheets[sheetIndex]?.name || '—'} ·
                header row {headerRow + 1} · data rows {dataStart + 1}–{dataEnd + 1}
              </p>
              <p>
                <strong>Population (active items):</strong> {activePop.length} ·{' '}
                <strong>Coverage value:</strong> {formatMoney(coverageTotal)}
              </p>
            </section>

            <section>
              <h2>4. Extent of selection</h2>
              <p>
                <strong>Items selected:</strong> {selected.length} of {activePop.length}{' '}
                population items (confirmed sample size {sampleDesign.confirmedSize}).
              </p>
              <p>
                <strong>Size basis:</strong>{' '}
                {designInputs.sampleSizePath === 'pathA'
                  ? `Path A risk score model — ${sampleDesign.sizeRuleLabel || sizeSuggestion.ruleLabel || 'firm matrix'}`
                  : `Path B value coverage — ${sampleDesign.sizeRuleLabel || sizeSuggestion.ruleLabel || 'coverage tier guidance'}`}
              </p>
              {sampleDesign.sizeRationale ? (
                <p><strong>Auditor note on extent:</strong> {sampleDesign.sizeRationale}</p>
              ) : null}
            </section>

            <section>
              <h2>5. Identifying characteristics of items selected (ISA 230.9(a))</h2>
              <p>
                The following items were selected for testing. Identifying characteristics
                (date, voucher / document reference, description and amounts) are recorded
                so each item can be traced and re-performed.
              </p>
              <div className="preview-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Date</th>
                      <th>Voucher No</th>
                      <th>Description</th>
                      <th>Debit</th>
                      <th>Credit</th>
                      <th>Coverage amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.length === 0 ? (
                      <tr><td colSpan={7}>None selected.</td></tr>
                    ) : (
                      selected.map((t, index) => (
                        <tr key={`wp-sel-${t.id}`}>
                          <td>{index + 1}</td>
                          <td>{t.date || '—'}</td>
                          <td>{t.voucherNo || displayRowId(t)}</td>
                          <td>{t.description || '—'}</td>
                          <td>{formatMoney(t.debit)}</td>
                          <td>{formatMoney(t.credit)}</td>
                          <td>{formatMoney(t.coverageAmount)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <p className="wp-note">
                Results of detailed testing on these items, exceptions (if any), and the
                auditor’s conclusion on the subject matter are documented on the related
                testing working paper — not on this selection schedule.
              </p>
            </section>

            <section>
              <h2>6. Preparation and review (ISA 230.9(b)–(c))</h2>
              <div className="form-grid grid-2 no-print-inputs">
                <div>
                  <label htmlFor="preparedBy">Prepared by (who performed the work)</label>
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
                  <label htmlFor="preparedDate">Date work completed</label>
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
                  <label htmlFor="reviewedDate">Date of review</label>
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
              </div>
              <label htmlFor="reviewExtent">Extent of review</label>
              <textarea
                id="reviewExtent"
                rows={2}
                value={signOff.reviewExtent}
                disabled={signOff.locked}
                onChange={(e) =>
                  setSignOff((prev) => ({ ...prev, reviewExtent: e.target.value }))
                }
              />
              <p className="wp-assembly">
                <strong>File assembly (ISA 230):</strong> assemble the final audit file on
                a timely basis after the date of the auditor’s report
                {signOff.fileAssemblyDeadline
                  ? ` (target deadline recorded: ${signOff.fileAssemblyDeadline})`
                  : ''}
                . Lock status:{' '}
                {signOff.locked ? `Locked on ${signOff.lockDate || '—'}` : 'Not locked'}.
              </p>
            </section>

            <footer className="wp-footer">
              Tool version {TOOL_VERSION}
              {configSnapshot ? ` · Config captured ${configSnapshot.capturedAt}` : ''}
            </footer>
          </article>
        </div>
      )}
    </div>
  )
}
