import { useMemo, useRef, useState } from 'react'
import { buildTransactions, totalCoverageValue } from './lib/coverage'
import { cellToText, parseLedgerFile } from './lib/excel'
import { detectHeaderRow, suggestMappings } from './lib/headers'
import {
  formatMoney,
  pathASampleSize,
  pathBSizing,
  scoreLabel,
} from './lib/sampleSize'
import {
  methodLabel,
  selectBlock,
  selectHaphazard,
  selectRandom,
  selectSystematic,
} from './lib/selection'
import type {
  EvaluationState,
  LedgerTransaction,
  MappingConfidence,
  PathAInputs,
  PathBResult,
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
  'header',
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
  header: 'Confirm header & range',
  mapping: 'Map columns',
  confirm: 'Confirm population',
  objective: 'Audit objective',
  sampleSize: 'Sample size',
  selection: 'Select items',
  testing: 'Testing results',
  workingPaper: 'Working paper',
}

function confidenceClass(confidence: MappingConfidence): string {
  return `confidence ${confidence}`
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
  const [mapping, setMapping] = useState<
    Record<StandardField, { columnIndex: number | null; confidence: MappingConfidence }>
  >({
    date: { columnIndex: null, confidence: 'none' },
    voucherNo: { columnIndex: null, confidence: 'none' },
    description: { columnIndex: null, confidence: 'none' },
    debit: { columnIndex: null, confidence: 'none' },
    credit: { columnIndex: null, confidence: 'none' },
    amount: { columnIndex: null, confidence: 'none' },
  })

  const [transactions, setTransactions] = useState<LedgerTransaction[]>([])
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
  const [sizeRationale, setSizeRationale] = useState('Accepted calculated / suggested sample size.')
  const [method, setMethod] = useState<SelectionMethod>('random')
  const [blockStart, setBlockStart] = useState(0)
  const [haphazardIds, setHaphazardIds] = useState<string[]>([])
  const [selected, setSelected] = useState<LedgerTransaction[]>([])
  const [selectionMeta, setSelectionMeta] = useState<SelectionMeta | null>(null)
  const [testing, setTesting] = useState<TestingResult[]>([])
  const [evaluation, setEvaluation] = useState<EvaluationState>({
    exceptionCount: 0,
    exceptionValue: 0,
    natureSummary: '',
    widerIssue: 'no',
    furtherTesting: 'no',
    conclusion: '',
    reviewerComments: '',
    untestedRemainderBasis:
      'Remainder accepted based on audit risk assessment and other audit procedures performed.',
  })

  const sheet = ledger?.sheets[sheetIndex]
  const headers = useMemo(() => {
    if (!sheet) return []
    return (sheet.rows[headerRow] ?? []).map((cell, index) => {
      const text = cellToText(cell)
      return text || `Column ${index + 1}`
    })
  }, [sheet, headerRow])

  const coverageTotal = useMemo(
    () => totalCoverageValue(transactions),
    [transactions],
  )

  const pathAResult = useMemo(
    () => pathASampleSize(pathA, transactions.length),
    [pathA, transactions.length],
  )

  const suggestedSize =
    path === 'pathA'
      ? pathAResult.finalSize
      : Math.min(pathB?.suggestedSampleSize ?? 0, transactions.length)

  const isHundredPercent =
    transactions.length > 0 && confirmedSize === transactions.length

  const selectedCoverage = useMemo(
    () => totalCoverageValue(selected),
    [selected],
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

  async function onUpload(file: File) {
    setBusy(true)
    setError('')
    try {
      const parsed = await parseLedgerFile(file)
      if (!parsed.sheets.length) {
        setError('No worksheets found in this file.')
        return
      }
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
    const active = source.sheets[index]
    const detected = detectHeaderRow(active.rows)
    const start = Math.min(detected + 1, Math.max(active.rows.length - 1, 0))
    const end = Math.max(active.rows.length - 1, start)
    const headerTexts = (active.rows[detected] ?? []).map((c) => cellToText(c))
    const suggestions = suggestMappings(headerTexts)

    setHeaderRow(detected)
    setDataStart(start)
    setDataEnd(end)
    setMapping(suggestions)
    setTransactions([])
    setSelected([])
    setSelectionMeta(null)
    setTesting([])
    setPathB(null)
    setConfirmedSize(0)
    setWarnings([])
  }

  function confirmMappingAndBuild() {
    if (!sheet) return
    const mapIndexes = {
      date: mapping.date.columnIndex,
      voucherNo: mapping.voucherNo.columnIndex,
      description: mapping.description.columnIndex,
      debit: mapping.debit.columnIndex,
      credit: mapping.credit.columnIndex,
      amount: mapping.amount.columnIndex,
    }

    const hasAnyValueColumn =
      mapIndexes.debit != null || mapIndexes.credit != null || mapIndexes.amount != null

    if (!hasAnyValueColumn) {
      setWarnings([
        'No Debit, Credit, or Amount mapped. You can continue for Path A count-based sampling; Path B needs a value column.',
      ])
    }

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

    setError('')
    setWarnings(result.warnings)
    setTransactions(result.transactions)
    setStep('confirm')
  }

  function confirmPopulation() {
    if (!transactions.length) {
      setError('No transactions found in the selected range.')
      return
    }
    setError('')
    setStep('objective')
  }

  function continueFromObjective() {
    if (!objective.trim() || !samplingUnit.trim()) {
      setError('Please enter the audit objective and sampling unit.')
      return
    }
    setError('')
    if (path === 'pathB') {
      if (coverageTotal <= 0) {
        setError('Path B cannot be used when total coverage value is zero.')
        return
      }
      setPathB(pathBSizing(transactions))
    }
    const size =
      path === 'pathA'
        ? pathASampleSize(pathA, transactions.length).finalSize
        : pathBSizing(transactions).suggestedSampleSize
    setConfirmedSize(size)
    setStep('sampleSize')
  }

  function confirmSampleSize() {
    if (confirmedSize < 1) {
      setError('Sample size must be at least 1.')
      return
    }
    if (confirmedSize > transactions.length) {
      setError('Sample size cannot exceed transaction count.')
      return
    }
    if (!sizeRationale.trim()) {
      setError('Please record a sample-size rationale.')
      return
    }
    setError('')
    setStep('selection')
  }

  function runSelection() {
    if (confirmedSize < 1) return

    let outcome:
      | { selected: LedgerTransaction[]; meta: SelectionMeta }
      | null = null

    if (method === 'random') {
      outcome = selectRandom(transactions, confirmedSize)
    } else if (method === 'systematic') {
      outcome = selectSystematic(transactions, confirmedSize)
    } else if (method === 'block') {
      outcome = selectBlock(transactions, confirmedSize, blockStart)
    } else {
      if (haphazardIds.length !== confirmedSize) {
        setError(`Please select exactly ${confirmedSize} transactions.`)
        return
      }
      outcome = selectHaphazard(transactions, haphazardIds)
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
    const exceptionCount = testing.filter((t) => t.exception).length
    const exceptionValue = testing.reduce(
      (sum, t) => sum + (t.exception ? t.exceptionValue : 0),
      0,
    )
    setEvaluation((prev) => ({
      ...prev,
      exceptionCount,
      exceptionValue,
    }))
    setStep('workingPaper')
  }

  function resetAll() {
    setStep('upload')
    setLedger(null)
    setTransactions([])
    setSelected([])
    setSelectionMeta(null)
    setTesting([])
    setError('')
    setWarnings([])
    setObjective('')
    setPathB(null)
  }

  function toggleHaphazard(id: string) {
    setHaphazardIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= confirmedSize) return prev
      return [...prev, id]
    })
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
              onChange={(e) => {
                const index = Number(e.target.value)
                setSheetIndex(index)
                prepareSheet(ledger, index)
              }}
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

        {step === 'header' && sheet && (
          <section className="card">
            <div className="grid-3">
              <div>
                <label htmlFor="headerRow">Header row</label>
                <input
                  id="headerRow"
                  type="number"
                  min={1}
                  max={sheet.rows.length}
                  value={headerRow + 1}
                  onChange={(e) => {
                    const value = Math.max(1, Number(e.target.value)) - 1
                    setHeaderRow(value)
                    setDataStart(Math.max(value + 1, dataStart))
                    const texts = (sheet.rows[value] ?? []).map((c) => cellToText(c))
                    setMapping(suggestMappings(texts))
                  }}
                />
              </div>
              <div>
                <label htmlFor="dataStart">Data starts at row</label>
                <input
                  id="dataStart"
                  type="number"
                  min={headerRow + 2}
                  max={sheet.rows.length}
                  value={dataStart + 1}
                  onChange={(e) => setDataStart(Math.max(0, Number(e.target.value) - 1))}
                />
              </div>
              <div>
                <label htmlFor="dataEnd">Data ends at row</label>
                <input
                  id="dataEnd"
                  type="number"
                  min={dataStart + 1}
                  max={sheet.rows.length}
                  value={dataEnd + 1}
                  onChange={(e) => setDataEnd(Math.max(0, Number(e.target.value) - 1))}
                />
              </div>
            </div>

            <div className="preview-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    {headers.slice(0, 8).map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sheet.rows.slice(headerRow, Math.min(headerRow + 6, sheet.rows.length)).map((row, i) => (
                    <tr key={`preview-${headerRow + i}`} className={i === 0 ? 'header-row' : ''}>
                      <td>{headerRow + i + 1}</td>
                      {row.slice(0, 8).map((cell, j) => (
                        <td key={`${i}-${j}`}>{cellToText(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="actions">
              <button type="button" className="ghost" onClick={goBack}>
                Back
              </button>
              <button type="button" className="primary" onClick={goNext}>
                Confirm range
              </button>
            </div>
          </section>
        )}

        {step === 'mapping' && (
          <section className="card">
            <p className="lead-inline">
              All columns are optional. Leave unmapped fields empty if the ledger does not have them.
              If there is no Debit/Credit, map a single Amount column instead.
            </p>
            {(Object.keys(STANDARD_FIELD_LABELS) as StandardField[]).map((field) => (
              <div className="map-row" key={field}>
                <div>
                  <strong>{STANDARD_FIELD_LABELS[field]}</strong>
                  <span className={confidenceClass(mapping[field].confidence)}>
                    {mapping[field].confidence === 'none' && mapping[field].columnIndex == null
                      ? 'not mapped'
                      : mapping[field].confidence}
                  </span>
                </div>
                <select
                  value={mapping[field].columnIndex ?? ''}
                  onChange={(e) => {
                    const value = e.target.value === '' ? null : Number(e.target.value)
                    setMapping((prev) => ({
                      ...prev,
                      [field]: {
                        columnIndex: value,
                        confidence: value == null ? 'none' : 'high',
                      },
                    }))
                  }}
                >
                  <option value="">Leave empty (not in this ledger)</option>
                  {headers.map((header, index) => (
                    <option key={`${header}-${index}`} value={index}>
                      {header}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <div className="actions">
              <button type="button" className="ghost" onClick={goBack}>
                Back
              </button>
              <button type="button" className="primary" onClick={confirmMappingAndBuild}>
                Confirm mapping
              </button>
            </div>
          </section>
        )}

        {step === 'confirm' && (
          <section className="card">
            <div className="stat-grid">
              <div>
                <span>Transactions</span>
                <strong>{transactions.length}</strong>
              </div>
              <div>
                <span>Total coverage value</span>
                <strong>{formatMoney(coverageTotal)}</strong>
              </div>
            </div>
            <div className="preview-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Date</th>
                    <th>Voucher</th>
                    <th>Description</th>
                    <th>Coverage</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.slice(0, 8).map((t) => (
                    <tr key={t.id}>
                      <td>{t.id}</td>
                      <td>{t.date || '—'}</td>
                      <td>{t.voucherNo || '—'}</td>
                      <td>{t.description || '—'}</td>
                      <td>{formatMoney(t.coverageAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {transactions.length > 8 && (
              <p className="hint">Showing first 8 of {transactions.length} transactions.</p>
            )}
            <div className="actions">
              <button type="button" className="ghost" onClick={goBack}>
                Back
              </button>
              <button type="button" className="primary" onClick={confirmPopulation}>
                Confirm population
              </button>
            </div>
          </section>
        )}

        {step === 'objective' && (
          <section className="card">
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
              onChange={(e) => setPath(e.target.value as SampleSizePath)}
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
                        setPathA((prev) => ({
                          ...prev,
                          [key]: Number(e.target.value) as 1 | 2 | 3 | 4,
                        }))
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
                <span>Transactions</span>
                <strong>{transactions.length}</strong>
              </div>
              <div>
                <span>Suggested size</span>
                <strong>{suggestedSize}</strong>
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
                  ? ` (capped to ${pathAResult.finalSize})`
                  : ''}
              </p>
            )}

            {path === 'pathB' && pathB && (
              <p className="lead-inline">
                Tier {pathB.tier}: {(pathB.coveragePercent * 100).toFixed(0)}% coverage,
                floor {formatMoney(pathB.minimumRequired)}. Provisional sizing suggests{' '}
                {pathB.suggestedSampleSize} items.
              </p>
            )}

            <label htmlFor="confirmedSize">Confirmed sample size</label>
            <input
              id="confirmedSize"
              type="number"
              min={1}
              max={transactions.length}
              value={confirmedSize}
              onChange={(e) => setConfirmedSize(Number(e.target.value))}
            />

            <label htmlFor="sizeRationale">Rationale</label>
            <textarea
              id="sizeRationale"
              rows={3}
              value={sizeRationale}
              onChange={(e) => setSizeRationale(e.target.value)}
            />

            {confirmedSize === transactions.length && (
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
            <label htmlFor="method">Selection method</label>
            <select
              id="method"
              value={method}
              onChange={(e) => setMethod(e.target.value as SelectionMethod)}
            >
              <option value="random">Random</option>
              <option value="systematic">Systematic</option>
              <option value="haphazard">Haphazard / Manual</option>
              <option value="block">Block</option>
            </select>

            {method === 'block' && (
              <>
                <label htmlFor="blockStart">Block start row index (0-based in list)</label>
                <input
                  id="blockStart"
                  type="number"
                  min={0}
                  max={Math.max(0, transactions.length - confirmedSize)}
                  value={blockStart}
                  onChange={(e) => setBlockStart(Number(e.target.value))}
                />
                <div className="banner warn">
                  Block selection concentrates risk. Record why this is appropriate.
                </div>
              </>
            )}

            {method === 'haphazard' && (
              <>
                <p className="lead-inline">
                  Select exactly {confirmedSize} items ({haphazardIds.length} selected).
                </p>
                <div className="pick-list">
                  {transactions.map((t) => (
                    <label key={t.id} className="pick-item">
                      <input
                        type="checkbox"
                        checked={haphazardIds.includes(t.id)}
                        onChange={() => toggleHaphazard(t.id)}
                      />
                      <span>
                        {t.id} · {t.voucherNo || 'No voucher'} · {formatMoney(t.coverageAmount)}
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
            </div>

            <div className="preview-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
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

            <label htmlFor="conclusion">Auditor conclusion</label>
            <textarea
              id="conclusion"
              rows={3}
              value={evaluation.conclusion}
              onChange={(e) =>
                setEvaluation((prev) => ({ ...prev, conclusion: e.target.value }))
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
              <p>
                <strong>Tool version:</strong> {TOOL_VERSION}
              </p>
              <p>
                <strong>Source file:</strong> {ledger?.fileName} /{' '}
                {ledger?.sheets[sheetIndex]?.name}
              </p>
              <p>
                <strong>Header row:</strong> {headerRow + 1} · <strong>Data range:</strong>{' '}
                {dataStart + 1}–{dataEnd + 1}
              </p>
              <p>
                <strong>Audit objective:</strong> {objective}
              </p>
              <p>
                <strong>Sampling unit:</strong> {samplingUnit}
              </p>
              <p>
                <strong>Confirmed transactions:</strong> {transactions.length}
              </p>
              <p>
                <strong>Confirmed total coverage value:</strong> {formatMoney(coverageTotal)}
              </p>
              <p>
                <strong>Sample-size path:</strong>{' '}
                {path === 'pathA' ? 'Path A — Risk score model' : 'Path B — Value coverage'}
              </p>
              {path === 'pathA' && (
                <p>
                  Risk {pathA.riskLevel}, Expected error {pathA.expectedError}, Other evidence{' '}
                  {pathA.otherEvidence} (score {pathAResult.score})
                </p>
              )}
              {path === 'pathB' && pathB && (
                <>
                  <p>
                    Tier {pathB.tier}, coverage {(pathB.coveragePercent * 100).toFixed(0)}%,
                    required {formatMoney(pathB.requiredCoverageValue)}
                  </p>
                  <p>
                    Selected coverage {formatMoney(selectedCoverage)} (
                    {coverageTotal
                      ? ((selectedCoverage / coverageTotal) * 100).toFixed(1)
                      : '0'}
                    %) · Untested remainder{' '}
                    {formatMoney(Math.max(coverageTotal - selectedCoverage, 0))}
                  </p>
                  <p>
                    <strong>Untested remainder basis:</strong>{' '}
                    {evaluation.untestedRemainderBasis}
                  </p>
                </>
              )}
              <p>
                <strong>Confirmed sample size:</strong> {confirmedSize}
                {isHundredPercent ? ' (100% examination)' : ''}
              </p>
              <p>
                <strong>Sample-size rationale:</strong> {sizeRationale}
              </p>
              <p>
                <strong>Selection method:</strong>{' '}
                {selectionMeta ? methodLabel(selectionMeta.method) : methodLabel(method)}
              </p>
              {selectionMeta && (
                <p>
                  <strong>Reproducibility:</strong>{' '}
                  {JSON.stringify({
                    seed: selectionMeta.seed,
                    rng: selectionMeta.rngAlgorithm,
                    interval: selectionMeta.interval,
                    start: selectionMeta.randomStart ?? selectionMeta.blockStart,
                    at: selectionMeta.timestamp,
                    version: selectionMeta.toolVersion,
                  })}
                </p>
              )}

              <h3>Selected transactions</h3>
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Date</th>
                    <th>Voucher</th>
                    <th>Description</th>
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
                        <td>{item.voucherNo || '—'}</td>
                        <td>{item.description || '—'}</td>
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

              <h3>Evaluation</h3>
              <p>
                Exceptions: {evaluation.exceptionCount} · Value:{' '}
                {formatMoney(evaluation.exceptionValue)}
              </p>
              <p>
                <strong>Conclusion:</strong> {evaluation.conclusion || '—'}
              </p>

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
