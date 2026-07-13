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
  suggestMappings,
  validateRequiredMappings,
} from './lib/headers'
import {
  DEFAULT_MIN_ITEM_COUNT,
  formatMoney,
  pathASampleSize,
  pathBSizing,
  scoreLabel,
  validateSampleSizeOverride,
} from './lib/sampleSize'
import {
  methodLabel,
  selectBlock,
  selectHaphazard,
  selectRandom,
  selectSystematic,
} from './lib/selection'
import { captureFirmConfigSnapshot } from './lib/firmConfig'
import { hashExtractedData } from './lib/hash'
import type {
  CoverageResolution,
  EngagementMeta,
  EvaluationState,
  FieldMappingState,
  FirmConfigSnapshot,
  LedgerTransaction,
  MappingConfidence,
  PathAInputs,
  PathBResult,
  RiskScore,
  SampleSizePath,
  SelectionMeta,
  SelectionMethod,
  StandardField,
  TestingResult,
  UploadedLedger,
  WizardStep,
} from './lib/types'
import { STANDARD_FIELD_LABELS, TOOL_VERSION } from './lib/types'
import './App.css'

const STEPS: WizardStep[] = [
  'upload',
  'worksheet',
  'mapping',
  'confirm',
  'objective',
  'sampleSize',
  'selection',
  'testing',
  'workingPaper',
]

const STEP_TITLES: Record<WizardStep, string> = {
  upload: 'Upload ledger',
  worksheet: 'Choose worksheet',
  mapping: 'Confirm headers',
  confirm: 'Confirm population',
  objective: 'Audit objective',
  sampleSize: 'Sample size',
  selection: 'Select items',
  testing: 'Testing results',
  workingPaper: 'Working paper',
}

const MAPPING_FIELDS: StandardField[] = [
  'date',
  'voucherNo',
  'accountNo',
  'description',
  'debit',
  'credit',
  'amount',
]

const DEFAULT_SELECTION_METHOD: SelectionMethod = 'random'
const DEFAULT_SIZE_RATIONALE = 'Accepted calculated / suggested sample size.'

function confidenceClass(confidence: MappingConfidence): string {
  return `confidence ${confidence}`
}

function emptyMapping(): Record<StandardField, FieldMappingState> {
  const result = {} as Record<StandardField, FieldMappingState>
  for (const field of MAPPING_FIELDS) {
    result[field] = {
      columnIndex: null,
      confidence: 'none',
      candidates: [],
      needsAuditorChoice: false,
    }
  }
  return result
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
    untestedRemainderBasis:
      'Remainder accepted based on audit risk assessment and other audit procedures performed.',
  }
}

function defaultEngagement(): EngagementMeta {
  return { wpReference: '', clientName: '', auditArea: '', period: '' }
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
  const [excludeDrafts, setExcludeDrafts] = useState<Record<string, string>>({})

  const [engagement, setEngagement] = useState<EngagementMeta>(defaultEngagement())
  const [objective, setObjective] = useState('')
  const [samplingUnit, setSamplingUnit] = useState('Individual transaction / voucher')
  const [path, setPath] = useState<SampleSizePath>('pathA')
  const [pathA, setPathA] = useState<PathAInputs>({
    riskLevel: 2,
    expectedError: 2,
    otherEvidence: 2,
  })
  const [pathB, setPathB] = useState<PathBResult | null>(null)

  const [confirmedSize, setConfirmedSize] = useState(0)
  const [sizeRationale, setSizeRationale] = useState(DEFAULT_SIZE_RATIONALE)
  const [reviewerApproved, setReviewerApproved] = useState(false)
  const [sizeWarning, setSizeWarning] = useState('')

  const [method, setMethod] = useState<SelectionMethod>(DEFAULT_SELECTION_METHOD)
  const [methodChangeReason, setMethodChangeReason] = useState('')
  const [blockStart, setBlockStart] = useState(0)
  const [blockRationale, setBlockRationale] = useState('')
  const [haphazardIds, setHaphazardIds] = useState<string[]>([])
  const [haphazardBiasConfirmed, setHaphazardBiasConfirmed] = useState(false)

  const [selected, setSelected] = useState<LedgerTransaction[]>([])
  const [selectionMeta, setSelectionMeta] = useState<SelectionMeta | null>(null)

  const [testing, setTesting] = useState<TestingResult[]>([])
  const [evaluation, setEvaluation] = useState<EvaluationState>(defaultEvaluation())

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
  const coverageTotal = useMemo(() => totalCoverageValue(transactions), [transactions])
  const unresolvedCount = useMemo(() => unresolvedBothSides(transactions), [transactions])
  const dataHash = useMemo(() => hashExtractedData(transactions), [transactions])

  const pathAResult = useMemo(
    () => pathASampleSize(pathA, activePop.length),
    [pathA, activePop.length],
  )

  const suggestedSize =
    path === 'pathA'
      ? pathAResult.finalSize
      : Math.min(pathB?.suggestedSampleSize ?? 0, activePop.length)

  const minimumFloor = Math.min(DEFAULT_MIN_ITEM_COUNT, activePop.length)

  const isHundredPercent = activePop.length > 0 && confirmedSize === activePop.length

  const selectedCoverage = useMemo(() => totalCoverageValue(selected), [selected])

  const mappingErrors = useMemo(
    () => (sheet ? validateRequiredMappings(mapping) : []),
    [mapping, sheet],
  )
  const needsChoiceFields = useMemo(
    () => MAPPING_FIELDS.filter((f) => mapping[f].needsAuditorChoice),
    [mapping],
  )

  const stepIndex = STEPS.indexOf(step)

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
   * Must be called whenever an upstream input changes so stale calculations,
   * selections, testing results, or Path B provisional sizing cannot survive
   * an upstream edit.
   */
  function invalidateFrom(fromStep: WizardStep) {
    const idx = STEPS.indexOf(fromStep)
    const confirmIdx = STEPS.indexOf('confirm')
    const sampleSizeIdx = STEPS.indexOf('sampleSize')
    const selectionIdx = STEPS.indexOf('selection')
    const testingIdx = STEPS.indexOf('testing')

    if (idx < confirmIdx) {
      setTransactions([])
      setExcludeDrafts({})
    }
    if (idx < sampleSizeIdx) {
      setPathB(null)
      setConfirmedSize(0)
      setSizeRationale(DEFAULT_SIZE_RATIONALE)
      setReviewerApproved(false)
      setSizeWarning('')
    }
    if (idx <= selectionIdx) {
      setSelected([])
      setSelectionMeta(null)
    }
    if (idx < selectionIdx) {
      setMethod(DEFAULT_SELECTION_METHOD)
      setMethodChangeReason('')
      setBlockStart(0)
      setBlockRationale('')
      setHaphazardIds([])
      setHaphazardBiasConfirmed(false)
    }
    if (idx <= testingIdx) {
      setTesting([])
      setEvaluation(defaultEvaluation())
      setConfigSnapshot(null)
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
    const errors = validateRequiredMappings(mapping)
    if (errors.length) {
      setError(errors.join('  •  '))
      return
    }

    const mapIndexes = MAPPING_FIELDS.reduce((acc, field) => {
      acc[field] = mapping[field].columnIndex
      return acc
    }, {} as Record<StandardField, number | null>)

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

    invalidateFrom('mapping')
    setError('')
    setWarnings(result.warnings)
    setTransactions(result.transactions)
    setStep('confirm')
  }

  function resolveRow(id: string, resolution: CoverageResolution) {
    setTransactions((prev) =>
      prev.map((t) => (t.id === id ? resolveTransactionCoverage(t, resolution) : t)),
    )
    invalidateFrom('confirm')
  }

  function excludeRow(id: string) {
    const reason = (excludeDrafts[id] ?? '').trim()
    if (!reason) {
      setError('Please enter a reason before excluding this row.')
      return
    }
    setTransactions((prev) =>
      prev.map((t) => (t.id === id ? { ...t, excluded: true, exclusionReason: reason } : t)),
    )
    setExcludeDrafts((prev) => ({ ...prev, [id]: '' }))
    invalidateFrom('confirm')
    setError('')
  }

  function restoreRow(id: string) {
    setTransactions((prev) =>
      prev.map((t) => (t.id === id ? { ...t, excluded: false, exclusionReason: '' } : t)),
    )
    invalidateFrom('confirm')
  }

  function confirmPopulation() {
    if (unresolvedCount > 0) {
      setError(
        `${unresolvedCount} row(s) still need Debit/Credit resolution before continuing.`,
      )
      return
    }
    if (activePop.length === 0) {
      setError('No active transactions remain. Restore or fix rows before continuing.')
      return
    }
    setError('')
    setStep('objective')
  }

  function updatePath(next: SampleSizePath) {
    invalidateFrom('objective')
    setPath(next)
  }

  function updatePathA(key: keyof PathAInputs, value: RiskScore) {
    invalidateFrom('objective')
    setPathA((prev) => ({ ...prev, [key]: value }))
  }

  function continueFromObjective() {
    if (
      !engagement.wpReference.trim() ||
      !engagement.clientName.trim() ||
      !engagement.auditArea.trim() ||
      !engagement.period.trim()
    ) {
      setError('Please complete the WP reference, client, audit area, and period.')
      return
    }
    if (!objective.trim() || !samplingUnit.trim()) {
      setError('Please enter the audit objective and sampling unit.')
      return
    }
    if (path === 'pathB' && coverageTotal <= 0) {
      setError('Path B cannot be used when total coverage value is zero.')
      return
    }

    setError('')
    if (path === 'pathB') {
      const result = pathBSizing(activePop)
      setPathB(result)
      setConfirmedSize(Math.min(result.suggestedSampleSize, activePop.length))
    } else {
      setPathB(null)
      setConfirmedSize(pathASampleSize(pathA, activePop.length).finalSize)
    }
    setSizeRationale(DEFAULT_SIZE_RATIONALE)
    setReviewerApproved(false)
    setSizeWarning('')
    setStep('sampleSize')
  }

  function updateConfirmedSize(value: number) {
    invalidateFrom('sampleSize')
    setConfirmedSize(value)
    setSizeWarning('')
  }

  function updateSizeRationale(value: string) {
    invalidateFrom('sampleSize')
    setSizeRationale(value)
  }

  function updateReviewerApproved(value: boolean) {
    invalidateFrom('sampleSize')
    setReviewerApproved(value)
  }

  function confirmSampleSize() {
    const result = validateSampleSizeOverride({
      proposed: confirmedSize,
      calculated: suggestedSize,
      minimumFloor,
      population: activePop.length,
      rationale: sizeRationale,
      reviewerApproved,
    })
    if (!result.ok) {
      setError(result.error ?? 'Invalid sample size.')
      return
    }
    setError('')
    setSizeWarning(result.warning ?? '')
    setStep('selection')
  }

  function updateMethod(next: SelectionMethod) {
    invalidateFrom('selection')
    setMethod(next)
    if (next === DEFAULT_SELECTION_METHOD) setMethodChangeReason('')
  }

  function toggleHaphazard(id: string) {
    invalidateFrom('selection')
    setHaphazardIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= confirmedSize) return prev
      return [...prev, id]
    })
  }

  function runSelection() {
    if (confirmedSize < 1) return

    if (method !== DEFAULT_SELECTION_METHOD && !methodChangeReason.trim()) {
      setError(
        'Please record a reason for changing the selection method from the default (Random).',
      )
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
      if (haphazardIds.length !== confirmedSize) {
        setError(`Please select exactly ${confirmedSize} transactions.`)
        return
      }
    }

    let outcome: { selected: LedgerTransaction[]; meta: SelectionMeta }
    try {
      if (method === 'random') {
        outcome = selectRandom(activePop, confirmedSize)
      } else if (method === 'systematic') {
        outcome = selectSystematic(activePop, confirmedSize)
      } else if (method === 'block') {
        outcome = selectBlock(activePop, confirmedSize, blockStart, blockRationale)
      } else {
        outcome = selectHaphazard(activePop, haphazardIds, haphazardBiasConfirmed)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Selection failed.')
      return
    }

    if (outcome.selected.length !== confirmedSize) {
      setError('Selected item count must equal the confirmed sample size.')
      return
    }

    setError('')
    setSelected(outcome.selected)
    setSelectionMeta(outcome.meta)
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
    setStep('testing')
  }

  function finishTesting() {
    if (!evaluation.conclusion.trim()) {
      setError('Please record an auditor conclusion before generating the working paper.')
      return
    }
    setError('')
    const exceptionCount = testing.filter((t) => t.exception).length
    const exceptionValue = testing.reduce(
      (sum, t) => sum + (t.exception ? t.exceptionValue : 0),
      0,
    )
    setEvaluation((prev) => ({ ...prev, exceptionCount, exceptionValue }))
    setConfigSnapshot(captureFirmConfigSnapshot())
    setStep('workingPaper')
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
    setExcludeDrafts({})
    setEngagement(defaultEngagement())
    setObjective('')
    setSamplingUnit('Individual transaction / voucher')
    setPath('pathA')
    setPathA({ riskLevel: 2, expectedError: 2, otherEvidence: 2 })
    setPathB(null)
    setConfirmedSize(0)
    setSizeRationale(DEFAULT_SIZE_RATIONALE)
    setReviewerApproved(false)
    setSizeWarning('')
    setMethod(DEFAULT_SELECTION_METHOD)
    setMethodChangeReason('')
    setBlockStart(0)
    setBlockRationale('')
    setHaphazardIds([])
    setHaphazardBiasConfirmed(false)
    setSelected([])
    setSelectionMeta(null)
    setTesting([])
    setEvaluation(defaultEvaluation())
    setConfigSnapshot(null)
  }

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
            {warnings.slice(0, 4).map((w) => (
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
              The header row and where data starts are detected automatically.
              Data begins on the row right after the header. You only need to check
              the column mapping below.
            </p>

            <div className="auto-note">
              <div>
                <span>Header row</span>
                <strong>Row {headerRow + 1} (auto)</strong>
              </div>
              <div>
                <span>Data starts</span>
                <strong>Row {dataStart + 1} (auto)</strong>
              </div>
              <div>
                <span>Data ends</span>
                <strong>Row {dataEnd + 1} (auto)</strong>
              </div>
              <div>
                <span>Rows used</span>
                <strong>{Math.max(0, dataEnd - dataStart + 1)}</strong>
              </div>
            </div>

            <details className="fix-header">
              <summary>Header looks wrong? Change it here</summary>
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
              <p className="hint">
                If you change the header row, data start/end update automatically.
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
                    .slice(headerRow, Math.min(headerRow + 5, sheet.rows.length))
                    .map((row, i) => (
                      <tr
                        key={`map-preview-${headerRow + i}`}
                        className={i === 0 ? 'header-row' : ''}
                      >
                        <td>{headerRow + i + 1}</td>
                        {row.slice(0, 8).map((cell, j) => (
                          <td key={`${i}-${j}`}>{cellToText(cell)}</td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <h3 className="map-heading">Column mapping</h3>
            <p className="lead-inline">
              Account No and Amount are optional alternatives — use Amount if the ledger
              has no Debit/Credit, and Account No if there is no Voucher No.
            </p>

            {needsChoiceFields.length > 0 && (
              <div className="banner warn">
                These fields have more than one strong match and need your confirmation:{' '}
                {needsChoiceFields.map((f) => STANDARD_FIELD_LABELS[f]).join(', ')}.
              </div>
            )}

            {MAPPING_FIELDS.map((field) => {
              const state = mapping[field]
              return (
                <div className="map-row" key={field}>
                  <div>
                    <strong>{STANDARD_FIELD_LABELS[field]}</strong>
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
                      <option value="">Leave empty</option>
                      {headers.map((header, index) => (
                        <option key={`${header}-${index}`} value={index}>
                          {header}
                        </option>
                      ))}
                    </select>
                    {state.candidates.length > 1 && (
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
                            {c.header} ({Math.round(c.score)}%)
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
                disabled={mappingErrors.length > 0}
              >
                Looks correct — continue
              </button>
            </div>
          </section>
        )}

        {step === 'confirm' && (
          <section className="card">
            <div className="stat-grid">
              <div>
                <span>Total rows built</span>
                <strong>{transactions.length}</strong>
              </div>
              <div>
                <span>Active transactions</span>
                <strong>{activePop.length}</strong>
              </div>
              <div>
                <span>Excluded rows</span>
                <strong>{transactions.length - activePop.length}</strong>
              </div>
              <div>
                <span>Total coverage value</span>
                <strong>{formatMoney(coverageTotal)}</strong>
              </div>
            </div>

            {unresolvedCount > 0 && (
              <div className="banner error">
                {unresolvedCount} row(s) have both Debit and Credit values. Resolve each
                row below before confirming.
              </div>
            )}
            {activePop.length === 0 && (
              <div className="banner error">
                No active transactions remain. Restore or fix rows before continuing.
              </div>
            )}

            <p className="lead-inline">
              Review all {transactions.length} transactions below before confirming.
            </p>
            <div className="preview-table-wrap preview-table-all">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Date</th>
                    <th>Account</th>
                    <th>Voucher</th>
                    <th>Description</th>
                    <th>Debit</th>
                    <th>Credit</th>
                    <th>Coverage</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t) => (
                    <tr key={t.id} className={t.excluded ? 'excluded-row' : ''}>
                      <td>{t.id}</td>
                      <td>{t.date || '—'}</td>
                      <td>{t.accountNo || '—'}</td>
                      <td>{t.voucherNo || '—'}</td>
                      <td>{t.description || '—'}</td>
                      <td>{formatMoney(t.debit)}</td>
                      <td>{formatMoney(t.credit)}</td>
                      <td>{formatMoney(t.coverageAmount)}</td>
                      <td>
                        {t.needsCoverageResolution
                          ? 'Needs resolution'
                          : t.excluded
                            ? `Excluded: ${t.exclusionReason || 'no reason recorded'}`
                            : 'Active'}
                      </td>
                      <td>
                        {t.needsCoverageResolution ? (
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
                              Use Higher
                            </button>
                            <button
                              type="button"
                              className="small-btn"
                              onClick={() => resolveRow(t.id, 'exclude')}
                            >
                              Exclude
                            </button>
                          </div>
                        ) : t.excluded ? (
                          <button
                            type="button"
                            className="small-btn"
                            onClick={() => restoreRow(t.id)}
                          >
                            Restore
                          </button>
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
            <div className="actions">
              <button type="button" className="ghost" onClick={goBack}>
                Back
              </button>
              <button
                type="button"
                className="primary"
                onClick={confirmPopulation}
                disabled={unresolvedCount > 0 || activePop.length === 0}
              >
                Confirm population
              </button>
            </div>
          </section>
        )}

        {step === 'objective' && (
          <section className="card">
            <div className="grid-3">
              <div>
                <label htmlFor="wpRef">WP reference</label>
                <input
                  id="wpRef"
                  value={engagement.wpReference}
                  onChange={(e) =>
                    setEngagement((prev) => ({ ...prev, wpReference: e.target.value }))
                  }
                />
              </div>
              <div>
                <label htmlFor="clientName">Client name</label>
                <input
                  id="clientName"
                  value={engagement.clientName}
                  onChange={(e) =>
                    setEngagement((prev) => ({ ...prev, clientName: e.target.value }))
                  }
                />
              </div>
              <div>
                <label htmlFor="auditArea">Audit area</label>
                <input
                  id="auditArea"
                  value={engagement.auditArea}
                  onChange={(e) =>
                    setEngagement((prev) => ({ ...prev, auditArea: e.target.value }))
                  }
                />
              </div>
            </div>

            <label htmlFor="period">Period</label>
            <input
              id="period"
              value={engagement.period}
              onChange={(e) =>
                setEngagement((prev) => ({ ...prev, period: e.target.value }))
              }
              placeholder="e.g. Year ended 30 June 2026"
            />

            <label htmlFor="objective">Audit objective</label>
            <textarea
              id="objective"
              rows={4}
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="e.g. Test occurrence and accuracy of purchase transactions"
            />
            <label htmlFor="unit">Sampling unit</label>
            <input
              id="unit"
              value={samplingUnit}
              onChange={(e) => setSamplingUnit(e.target.value)}
            />

            <label htmlFor="path">Sample-size path</label>
            <select
              id="path"
              value={path}
              onChange={(e) => updatePath(e.target.value as SampleSizePath)}
            >
              <option value="pathA">Path A — Risk score model</option>
              <option value="pathB">Path B — Value coverage rule</option>
            </select>

            {path === 'pathA' && (
              <div className="grid-3">
                {([
                  ['riskLevel', 'Risk level'],
                  ['expectedError', 'Expected error'],
                  ['otherEvidence', 'Other audit evidence'],
                ] as const).map(([key, label]) => (
                  <div key={key}>
                    <label htmlFor={key}>{label}</label>
                    <select
                      id={key}
                      value={pathA[key]}
                      onChange={(e) =>
                        updatePathA(key, Number(e.target.value) as RiskScore)
                      }
                    >
                      {([1, 2, 3, 4] as const).map((score) => (
                        <option key={score} value={score}>
                          {score} — {scoreLabel(score, key)}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}

            {path === 'pathB' && (
              <p className="lead-inline">
                Path B sizes the sample using cumulative value coverage against active
                transactions ({formatMoney(coverageTotal)} total).
              </p>
            )}

            <div className="actions">
              <button type="button" className="ghost" onClick={goBack}>
                Back
              </button>
              <button type="button" className="primary" onClick={continueFromObjective}>
                Calculate sample size
              </button>
            </div>
          </section>
        )}

        {step === 'sampleSize' && (
          <section className="card">
            <div className="stat-grid">
              <div>
                <span>Active transactions</span>
                <strong>{activePop.length}</strong>
              </div>
              <div>
                <span>Calculated / suggested size</span>
                <strong>{suggestedSize}</strong>
              </div>
              <div>
                <span>Minimum item floor</span>
                <strong>{minimumFloor}</strong>
              </div>
              {path === 'pathB' && pathB && (
                <div>
                  <span>Required coverage</span>
                  <strong>{formatMoney(pathB.requiredCoverageValue)}</strong>
                </div>
              )}
            </div>

            {path === 'pathA' && (
              <p className="lead-inline">
                Risk score {pathAResult.score} → calculated size {pathAResult.calculated}
                {pathAResult.calculated !== pathAResult.finalSize
                  ? ` (capped to ${pathAResult.finalSize} active transactions)`
                  : ''}
              </p>
            )}

            {path === 'pathB' && pathB && (
              <p className="lead-inline">
                Tier {pathB.tier}: {(pathB.coveragePercent * 100).toFixed(0)}% coverage
                rule, floor {formatMoney(pathB.minimumRequired)}. Provisional top-value
                items suggest {pathB.suggestedSampleSize} items covering{' '}
                {formatMoney(pathB.provisionalCoverageValue)}.
              </p>
            )}

            <label htmlFor="confirmedSize">Confirmed sample size</label>
            <input
              id="confirmedSize"
              type="number"
              min={1}
              max={activePop.length}
              value={confirmedSize}
              onChange={(e) => updateConfirmedSize(Number(e.target.value))}
            />

            <label htmlFor="sizeRationale">Sample-size rationale</label>
            <textarea
              id="sizeRationale"
              rows={3}
              value={sizeRationale}
              onChange={(e) => updateSizeRationale(e.target.value)}
            />

            {confirmedSize < minimumFloor && confirmedSize < activePop.length && (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={reviewerApproved}
                  onChange={(e) => updateReviewerApproved(e.target.checked)}
                />
                <span>
                  Reviewer approves reduction below the minimum item floor (
                  {minimumFloor}).
                </span>
              </label>
            )}

            {sizeWarning && <div className="banner warn">{sizeWarning}</div>}

            {isHundredPercent && (
              <div className="banner warn">
                This will be treated as 100% examination, not sample-based testing.
              </div>
            )}

            <div className="actions">
              <button type="button" className="ghost" onClick={goBack}>
                Back
              </button>
              <button type="button" className="primary" onClick={confirmSampleSize}>
                Confirm sample size
              </button>
            </div>
          </section>
        )}

        {step === 'selection' && (
          <section className="card">
            <p className="lead-inline">
              Select exactly {confirmedSize} of {activePop.length} active transactions.
            </p>

            <label htmlFor="method">Selection method</label>
            <select
              id="method"
              value={method}
              onChange={(e) => updateMethod(e.target.value as SelectionMethod)}
            >
              <option value="random">Random</option>
              <option value="systematic">Systematic</option>
              <option value="haphazard">Haphazard / Manual</option>
              <option value="block">Block</option>
            </select>

            {method !== DEFAULT_SELECTION_METHOD && (
              <>
                <label htmlFor="methodReason">
                  Reason for changing from the default method (Random)
                </label>
                <textarea
                  id="methodReason"
                  rows={2}
                  value={methodChangeReason}
                  onChange={(e) => setMethodChangeReason(e.target.value)}
                />
              </>
            )}

            {method === 'systematic' && (
              <div className="banner warn">
                Systematic selection may follow a periodicity pattern in the ledger.
                Review for pattern risk.
              </div>
            )}

            {method === 'block' && (
              <>
                <label htmlFor="blockStart">Block start row (0-based, active list)</label>
                <input
                  id="blockStart"
                  type="number"
                  min={0}
                  max={Math.max(0, activePop.length - confirmedSize)}
                  value={blockStart}
                  onChange={(e) => setBlockStart(Number(e.target.value))}
                />
                <label htmlFor="blockRationale">Rationale for block selection</label>
                <textarea
                  id="blockRationale"
                  rows={2}
                  value={blockRationale}
                  onChange={(e) => setBlockRationale(e.target.value)}
                />
                <div className="banner warn">
                  Block selection concentrates risk. Rationale is required.
                </div>
              </>
            )}

            {method === 'haphazard' && (
              <>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={haphazardBiasConfirmed}
                    onChange={(e) => setHaphazardBiasConfirmed(e.target.checked)}
                  />
                  <span>I confirm this selection was made without conscious bias.</span>
                </label>
                <p className="lead-inline">
                  Select exactly {confirmedSize} items ({haphazardIds.length} selected).
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
                        {t.id} · {t.accountNo || t.voucherNo || 'No ref'} ·{' '}
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
                Select {confirmedSize} items
              </button>
            </div>
          </section>
        )}

        {step === 'testing' && (
          <section className="card">
            <div className="stat-grid">
              <div>
                <span>Selected</span>
                <strong>{selected.length}</strong>
              </div>
              <div>
                <span>Selected coverage</span>
                <strong>{formatMoney(selectedCoverage)}</strong>
              </div>
              {path === 'pathB' && coverageTotal > 0 && (
                <div>
                  <span>Coverage achieved</span>
                  <strong>
                    {((selectedCoverage / coverageTotal) * 100).toFixed(1)}%
                  </strong>
                </div>
              )}
              <div>
                <span>Exceptions so far</span>
                <strong>{testing.filter((t) => t.exception).length}</strong>
              </div>
            </div>

            <div className="preview-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Account</th>
                    <th>Voucher</th>
                    <th>Coverage</th>
                    <th>Exception?</th>
                    <th>Exception value</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.map((item) => {
                    const row = testing.find((t) => t.transactionId === item.id)
                    if (!row) return null
                    return (
                      <tr key={item.id}>
                        <td>{item.id}</td>
                        <td>{item.accountNo || '—'}</td>
                        <td>{item.voucherNo || '—'}</td>
                        <td>{formatMoney(item.coverageAmount)}</td>
                        <td>
                          <input
                            type="checkbox"
                            checked={row.exception}
                            onChange={(e) =>
                              setTesting((prev) =>
                                prev.map((t) =>
                                  t.transactionId === item.id
                                    ? { ...t, exception: e.target.checked, tested: true }
                                    : t,
                                ),
                              )
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            value={row.exceptionValue}
                            onChange={(e) =>
                              setTesting((prev) =>
                                prev.map((t) =>
                                  t.transactionId === item.id
                                    ? { ...t, exceptionValue: Number(e.target.value) }
                                    : t,
                                ),
                              )
                            }
                          />
                        </td>
                        <td>
                          <input
                            value={row.notes}
                            onChange={(e) =>
                              setTesting((prev) =>
                                prev.map((t) =>
                                  t.transactionId === item.id
                                    ? { ...t, notes: e.target.value, nature: e.target.value }
                                    : t,
                                ),
                              )
                            }
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <label htmlFor="natureSummary">Nature of exceptions (summary)</label>
            <textarea
              id="natureSummary"
              rows={2}
              value={evaluation.natureSummary}
              onChange={(e) =>
                setEvaluation((prev) => ({ ...prev, natureSummary: e.target.value }))
              }
            />

            <div className="grid-3">
              <div>
                <label htmlFor="furtherTesting">Further testing required?</label>
                <select
                  id="furtherTesting"
                  value={evaluation.furtherTesting}
                  onChange={(e) =>
                    setEvaluation((prev) => ({
                      ...prev,
                      furtherTesting: e.target.value as 'yes' | 'no',
                    }))
                  }
                >
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </div>
              <div>
                <label htmlFor="widerIssue">Indicative of a wider issue?</label>
                <select
                  id="widerIssue"
                  value={evaluation.widerIssue}
                  onChange={(e) =>
                    setEvaluation((prev) => ({
                      ...prev,
                      widerIssue: e.target.value as 'yes' | 'no' | 'unclear',
                    }))
                  }
                >
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                  <option value="unclear">Unclear</option>
                </select>
              </div>
            </div>

            <label htmlFor="conclusion">Auditor conclusion</label>
            <textarea
              id="conclusion"
              rows={3}
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
                setEvaluation((prev) => ({ ...prev, reviewerComments: e.target.value }))
              }
            />

            {path === 'pathB' && (
              <>
                <label htmlFor="remainder">Untested remainder basis</label>
                <textarea
                  id="remainder"
                  rows={2}
                  value={evaluation.untestedRemainderBasis}
                  onChange={(e) =>
                    setEvaluation((prev) => ({
                      ...prev,
                      untestedRemainderBasis: e.target.value,
                    }))
                  }
                />
              </>
            )}

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
          <section className="card paper">
            <div className="paper-actions">
              <button type="button" className="ghost" onClick={() => window.print()}>
                Print / Export
              </button>
              <button type="button" className="primary" onClick={resetAll}>
                New engagement
              </button>
            </div>

            <article className="working-paper">
              <h2>Non-Statistical Audit Sampling Working Paper</h2>

              <div className="wp-grid">
                <p>
                  <strong>WP reference:</strong> {engagement.wpReference || '—'}
                </p>
                <p>
                  <strong>Client:</strong> {engagement.clientName || '—'}
                </p>
                <p>
                  <strong>Audit area:</strong> {engagement.auditArea || '—'}
                </p>
                <p>
                  <strong>Period:</strong> {engagement.period || '—'}
                </p>
                <p>
                  <strong>Tool version:</strong> {TOOL_VERSION}
                </p>
                <p>
                  <strong>Source file:</strong> {ledger?.fileName} / {sheet?.name}
                </p>
              </div>

              <p>
                <strong>Audit objective:</strong> {objective}
              </p>
              <p>
                <strong>Sampling unit:</strong> {samplingUnit}
              </p>

              <h3>Population</h3>
              <p>
                <strong>Header row:</strong> {headerRow + 1} (auto-detected) ·{' '}
                <strong>Data rows used:</strong> {dataStart + 1}–{dataEnd + 1}
              </p>
              <p>
                <strong>Total rows built:</strong> {transactions.length} ·{' '}
                <strong>Active transactions:</strong> {activePop.length} ·{' '}
                <strong>Excluded:</strong> {transactions.length - activePop.length}
              </p>
              <p>
                <strong>Total coverage value (active):</strong> {formatMoney(coverageTotal)}
              </p>

              <h3>Sample size</h3>
              <p>
                <strong>Path:</strong>{' '}
                {path === 'pathA' ? 'Path A — Risk score model' : 'Path B — Value coverage rule'}
              </p>
              {path === 'pathA' && (
                <p>
                  Risk {pathA.riskLevel}, Expected error {pathA.expectedError}, Other
                  evidence {pathA.otherEvidence} → score {pathAResult.score}, calculated
                  size {pathAResult.calculated}
                </p>
              )}
              {path === 'pathB' && pathB && (
                <p>
                  Tier {pathB.tier}, coverage rule {(pathB.coveragePercent * 100).toFixed(0)}
                  %, required coverage {formatMoney(pathB.requiredCoverageValue)}, minimum
                  floor {formatMoney(pathB.minimumRequired)}
                </p>
              )}
              <p>
                <strong>Confirmed sample size:</strong> {confirmedSize}
                {isHundredPercent ? ' (100% examination — not sample-based testing)' : ''}
              </p>
              <p>
                <strong>Sample-size rationale:</strong> {sizeRationale}
              </p>
              {reviewerApproved && (
                <p>
                  <strong>Reviewer approval:</strong> Confirmed for reduction below the
                  minimum item floor.
                </p>
              )}

              <h3>Selection</h3>
              <p>
                <strong>Method:</strong>{' '}
                {selectionMeta ? methodLabel(selectionMeta.method) : methodLabel(method)}
              </p>
              {methodChangeReason && (
                <p>
                  <strong>Reason for method change:</strong> {methodChangeReason}
                </p>
              )}
              {selectionMeta?.rationale && (
                <p>
                  <strong>Block rationale:</strong> {selectionMeta.rationale}
                </p>
              )}
              {selectionMeta?.patternWarning && (
                <p>
                  <strong>Pattern note:</strong> {selectionMeta.patternWarning}
                </p>
              )}
              {selectionMeta && (
                <p>
                  <strong>Reproducibility:</strong>{' '}
                  {JSON.stringify({
                    seed: selectionMeta.seed,
                    rng: selectionMeta.rngAlgorithm,
                    interval: selectionMeta.interval,
                    start: selectionMeta.randomStart ?? selectionMeta.blockStart,
                    biasConfirmed: selectionMeta.biasConfirmed,
                    at: selectionMeta.timestamp,
                    version: selectionMeta.toolVersion,
                  })}
                </p>
              )}
              <p>
                <strong>Extracted-data hash:</strong> {dataHash}
              </p>

              <h3>Selected transactions ({selected.length})</h3>
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Date</th>
                    <th>Account</th>
                    <th>Voucher</th>
                    <th>Description</th>
                    <th>Debit</th>
                    <th>Credit</th>
                    <th>Coverage</th>
                    <th>Exception</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.map((item) => {
                    const row = testing.find((t) => t.transactionId === item.id)
                    return (
                      <tr key={item.id}>
                        <td>{item.id}</td>
                        <td>{item.date || '—'}</td>
                        <td>{item.accountNo || '—'}</td>
                        <td>{item.voucherNo || '—'}</td>
                        <td>{item.description || '—'}</td>
                        <td>{formatMoney(item.debit)}</td>
                        <td>{formatMoney(item.credit)}</td>
                        <td>{formatMoney(item.coverageAmount)}</td>
                        <td>
                          {row?.exception
                            ? `Yes (${formatMoney(row.exceptionValue)}) ${row.notes}`
                            : 'No'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {path === 'pathB' && (
                <>
                  <h3>Untested remainder (Path B)</h3>
                  <p>
                    Selected coverage {formatMoney(selectedCoverage)} (
                    {coverageTotal
                      ? ((selectedCoverage / coverageTotal) * 100).toFixed(1)
                      : '0'}
                    %) of total active coverage {formatMoney(coverageTotal)}.
                  </p>
                  <p>
                    Untested remainder value:{' '}
                    {formatMoney(Math.max(coverageTotal - selectedCoverage, 0))}
                  </p>
                  <p>
                    <strong>Basis for accepting untested remainder:</strong>{' '}
                    {evaluation.untestedRemainderBasis}
                  </p>
                </>
              )}

              <h3>Testing &amp; evaluation</h3>
              <p>
                Exceptions: {evaluation.exceptionCount} · Exception value:{' '}
                {formatMoney(evaluation.exceptionValue)}
              </p>
              <p>
                <strong>Nature of exceptions:</strong> {evaluation.natureSummary || '—'}
              </p>
              <p>
                <strong>Further testing required:</strong>{' '}
                {evaluation.furtherTesting === 'yes' ? 'Yes' : 'No'} ·{' '}
                <strong>Wider issue indicated:</strong> {evaluation.widerIssue}
              </p>
              <p>
                <strong>Conclusion:</strong> {evaluation.conclusion || '—'}
              </p>
              <p>
                <strong>Reviewer comments:</strong> {evaluation.reviewerComments || '—'}
              </p>

              <h3>Firm configuration snapshot</h3>
              {configSnapshot && (
                <pre className="config-json">
                  {JSON.stringify(configSnapshot, null, 2)}
                </pre>
              )}

              <h3>Sign-off</h3>
              <p>Prepared by: ______________________ Date: __________</p>
              <p>Reviewed by: ______________________ Date: __________</p>
            </article>
          </section>
        )}
      </main>
    </div>
  )
}
