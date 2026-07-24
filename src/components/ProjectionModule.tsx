import { useMemo, useState, type ReactNode } from 'react'
import {
  amountToSum,
  anomalyFlaggedButNotApproved,
  bestEstimate,
  computeDetailsAggregates,
  deviationRateProjection,
  differenceProjection,
  emptyAnomalyJustification,
  entryDifference,
  evaluateControls,
  evaluateDetails,
  isAnomalyApproved,
  meanPerUnitGateFailures,
  meanPerUnitProjection,
  methodAvailabilityFor,
  methodDivergence,
  NIL_RESULT_NOTE_CONTROLS,
  NIL_RESULT_NOTE_DETAILS,
  PLANNED_RESPONSE_OPTIONS,
  PROJ_ASSERTIONS,
  PROJ_CONFIG,
  PROJ_CURRENCIES,
  PROJ_LIMITATION_STATEMENT,
  PROJECTION_METHOD_LABELS,
  ratioProjection,
  SELECTION_METHOD_LABELS,
  type DetailsAggregates,
  type DeviationEntry,
  type EvaluationTrigger,
  type MisstatementEntry,
  type ProjectionAmounts,
  type ProjectionMethodId,
  type ProjDirection,
  type ProjReliance,
  type ProjRisk,
  type ProjSampleSizeBasis,
  type ProjSelectionMethod,
  type ProjTestType,
  type RegisterBucket,
} from '../lib/projection'
import { NumberTextInput } from './FormFields'

// ---------------------------------------------------------------------------
// Local state shapes
// ---------------------------------------------------------------------------

interface EngagementBlock {
  clientName: string
  auditPeriod: string
  wpReference: string
  accountTested: string
  fsLineItem: string
  populationSource: string
  samplingUnit: string
  assertion: string
  direction: ProjDirection
  testType: ProjTestType
  stratumRef: string
  currency: string
}

interface ReconciliationBlock {
  reconciledTo: string
  valuePerListing: number
  valuePerGL: number
  explanation: string
  verifiedBy: string
  verifiedDate: string
}

interface CompositionBlock {
  totalValue: number
  totalCount: number
  tested100Value: number
  tested100Count: number
  specificValue: number
  specificCount: number
}

type YesNo = '' | 'yes' | 'no'

interface QualityCheck {
  answer: YesNo
  note: string
}

interface QualityBlock {
  noItemExceedsTolerable: QualityCheck
  noNegativeBalances: QualityCheck
  noZeroValueItems: QualityCheck
  homogeneous: QualityCheck
}

interface PlanningBlock {
  assessedRisk: ProjRisk
  reliance: ProjReliance
  performanceMateriality: number
  tolerableMisstatement: number
  tolerableMisstatementBasis: string
  tolerableDeviationRatePct: number
  tolerableDeviationRateBasis: string
  expectedMisstatement: number
  expectedDeviationRatePct: number
  sampleSizeBasis: ProjSampleSizeBasis
  sampleSizeRationale: string
  selectionMethod: ProjSelectionMethod
  offsettingAppropriate: YesNo
  offsettingReason: string
}

interface SampleBlock {
  itemCount: number
  recordedValue: number
  auditedValueTotal: number
  periodCovered: string
  drawnFromResidualConfirmed: boolean
  sameBasisConfirmed: boolean
}

interface QualitativeBlock {
  natureAndCause: string
  systematicOrIsolated: string
  fraudIndicator: boolean
  effectOnOtherAreas: string
  effectOnRisk: string
  controlDeficiency: string
  escalationResponse: string
}

interface SignOffBlock {
  methodSelectionReason: string
  auditorComments: string
  plannedResponses: string[]
  finalConclusion: string
  preparedBy: string
  preparedDate: string
  reviewedBy: string
  reviewedDate: string
  finalized: boolean
}

interface Warning {
  id: string
  text: string
}

let entrySeq = 0
function nextEntryId(): string {
  entrySeq += 1
  return `pe-${Date.now().toString(36)}-${entrySeq}`
}

function newMisstatementEntry(): MisstatementEntry {
  return {
    id: nextEntryId(),
    itemRef: '',
    bucket: 'residualSample',
    recordedValue: 0,
    auditedValue: 0,
    correctedByManagement: false,
    fraudIndicator: false,
    anomalyFlagged: false,
    anomaly: emptyAnomalyJustification(),
    description: '',
  }
}

function newDeviationEntry(): DeviationEntry {
  return {
    id: nextEntryId(),
    itemRef: '',
    bucket: 'residualSample',
    natureOfDeviation: '',
    fraudIndicator: false,
    anomalyFlagged: false,
    anomaly: emptyAnomalyJustification(),
  }
}

const BUCKET_LABELS: Record<RegisterBucket, string> = {
  residualSample: 'Residual sample',
  tested100: 'Tested 100%',
  specific: 'Specifically selected',
}

type ProjStepId =
  | 'setup'
  | 'population'
  | 'planning'
  | 'sample'
  | 'register'
  | 'method'
  | 'review'

const PROJ_STEPS: Array<{ id: ProjStepId; title: string; blurb: string }> = [
  { id: 'setup', title: '1. Setup', blurb: 'What are you testing?' },
  { id: 'population', title: '2. Population', blurb: 'Totals and residual' },
  { id: 'planning', title: '3. Planning', blurb: 'Risk and limits' },
  { id: 'sample', title: '4. Sample', blurb: 'Size and confirmations' },
  { id: 'register', title: '5. Findings', blurb: 'Misstatements / deviations' },
  { id: 'method', title: '6. Method', blurb: 'Project and review results' },
  { id: 'review', title: '7. Working paper', blurb: 'Checks, then generate' },
]

function FieldLabel({
  children,
  required,
  optional,
}: {
  children: ReactNode
  required?: boolean
  optional?: boolean
}) {
  return (
    <label className="proj-field-label">
      <span>{children}</span>
      {required ? <span className="proj-badge proj-badge-req">Required</span> : null}
      {optional ? <span className="proj-badge proj-badge-opt">Optional</span> : null}
    </label>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProjectionModule() {
  const [screen, setScreen] = useState<'inputs' | 'workingPaper'>('inputs')
  const [step, setStep] = useState<ProjStepId>('setup')
  const [showExtraBuckets, setShowExtraBuckets] = useState(false)
  const [showMorePlanning, setShowMorePlanning] = useState(false)

  const [eng, setEng] = useState<EngagementBlock>({
    clientName: '',
    auditPeriod: '',
    wpReference: '',
    accountTested: '',
    fsLineItem: '',
    populationSource: '',
    samplingUnit: '',
    assertion: PROJ_ASSERTIONS[0],
    direction: 'Both',
    testType: 'details',
    stratumRef: '',
    currency: 'PKR',
  })

  const [recon, setRecon] = useState<ReconciliationBlock>({
    reconciledTo: '',
    valuePerListing: 0,
    valuePerGL: 0,
    explanation: '',
    verifiedBy: '',
    verifiedDate: '',
  })

  const [comp, setComp] = useState<CompositionBlock>({
    totalValue: 0,
    totalCount: 0,
    tested100Value: 0,
    tested100Count: 0,
    specificValue: 0,
    specificCount: 0,
  })

  const emptyCheck: QualityCheck = { answer: '', note: '' }
  const [quality, setQuality] = useState<QualityBlock>({
    noItemExceedsTolerable: { ...emptyCheck },
    noNegativeBalances: { ...emptyCheck },
    noZeroValueItems: { ...emptyCheck },
    homogeneous: { ...emptyCheck },
  })

  const [plan, setPlan] = useState<PlanningBlock>({
    assessedRisk: 'Moderate',
    reliance: 'None',
    performanceMateriality: 0,
    tolerableMisstatement: 0,
    tolerableMisstatementBasis: '',
    tolerableDeviationRatePct: 0,
    tolerableDeviationRateBasis: '',
    expectedMisstatement: 0,
    expectedDeviationRatePct: 0,
    sampleSizeBasis: 'Professional judgement',
    sampleSizeRationale: '',
    selectionMethod: 'random',
    offsettingAppropriate: '',
    offsettingReason: '',
  })

  const [sample, setSample] = useState<SampleBlock>({
    itemCount: 0,
    recordedValue: 0,
    auditedValueTotal: 0,
    periodCovered: '',
    drawnFromResidualConfirmed: false,
    sameBasisConfirmed: false,
  })

  const [mEntries, setMEntries] = useState<MisstatementEntry[]>([])
  const [dEntries, setDEntries] = useState<DeviationEntry[]>([])
  const [openAnomalyId, setOpenAnomalyId] = useState<string | null>(null)

  const [qual, setQual] = useState<QualitativeBlock>({
    natureAndCause: '',
    systematicOrIsolated: '',
    fraudIndicator: false,
    effectOnOtherAreas: '',
    effectOnRisk: '',
    controlDeficiency: '',
    escalationResponse: '',
  })

  const [method, setMethod] = useState<ProjectionMethodId | ''>('')
  const [warningResponses, setWarningResponses] = useState<Record<string, string>>({})
  const [signOff, setSignOff] = useState<SignOffBlock>({
    methodSelectionReason: '',
    auditorComments: '',
    plannedResponses: [],
    finalConclusion: '',
    preparedBy: '',
    preparedDate: '',
    reviewedBy: '',
    reviewedDate: '',
    finalized: false,
  })

  const isDetails = eng.testType === 'details'

  // -------------------------------------------------------------------------
  // Derived values
  // -------------------------------------------------------------------------

  const residualValue =
    comp.totalValue - comp.tested100Value - comp.specificValue
  const residualCount =
    comp.totalCount - comp.tested100Count - comp.specificCount
  const reconDifference = recon.valuePerListing - recon.valuePerGL

  const agg: DetailsAggregates = useMemo(
    () => computeDetailsAggregates(mEntries),
    [mEntries],
  )

  const representativeDeviations = useMemo(
    () =>
      dEntries.filter(
        (d) => d.bucket === 'residualSample' && !isAnomalyApproved(d),
      ).length,
    [dEntries],
  )
  const sampleDeviations = useMemo(
    () => dEntries.filter((d) => d.bucket === 'residualSample').length,
    [dEntries],
  )

  const fraudPresent =
    qual.fraudIndicator ||
    mEntries.some((e) => e.fraudIndicator) ||
    dEntries.some((e) => e.fraudIndicator)

  const availability = methodAvailabilityFor(plan.selectionMethod)

  const mpuGateFailures = useMemo(
    () =>
      meanPerUnitGateFailures({
        enabled: PROJ_CONFIG.meanPerUnitEnabled,
        selectionMethod: plan.selectionMethod,
        sampleCount: sample.itemCount,
        sampleRecordedValue: sample.recordedValue,
        residualValue,
        residualCount,
        negativesOrZerosConfirmedAbsent:
          quality.noNegativeBalances.answer === 'yes' &&
          quality.noZeroValueItems.answer === 'yes',
      }),
    [plan.selectionMethod, sample.itemCount, sample.recordedValue, residualValue, residualCount, quality],
  )

  const ratioResult = useMemo(
    () =>
      ratioProjection({
        residualValue,
        sampleRecordedValue: sample.recordedValue,
        RO: agg.RO,
        RU: agg.RU,
      }),
    [residualValue, sample.recordedValue, agg],
  )

  const differenceResult = useMemo(
    () =>
      differenceProjection({
        residualCount,
        sampleCount: sample.itemCount,
        RO: agg.RO,
        RU: agg.RU,
      }),
    [residualCount, sample.itemCount, agg],
  )

  const mpuResult = useMemo(
    () =>
      meanPerUnitProjection({
        residualValue,
        residualCount,
        sampleCount: sample.itemCount,
        sampleAuditedTotal: sample.auditedValueTotal,
        entries: mEntries,
      }),
    [residualValue, residualCount, sample.itemCount, sample.auditedValueTotal, mEntries],
  )

  const deviationRate = useMemo(
    () =>
      deviationRateProjection({
        sampleCount: sample.itemCount,
        representativeDeviations,
      }),
    [sample.itemCount, representativeDeviations],
  )

  const projection: ProjectionAmounts = useMemo(() => {
    if (!isDetails || method === '' || method === 'deviationRate') {
      return { factor: null, PO: 0, PU: 0, PN: 0 }
    }
    if (method === 'ratio') return ratioResult
    if (method === 'difference') return differenceResult
    return { factor: null, PO: 0, PU: 0, PN: mpuResult.PN }
  }, [isDetails, method, ratioResult, differenceResult, mpuResult])

  const divergence = useMemo(
    () => methodDivergence(ratioResult.PN, differenceResult.PN),
    [ratioResult.PN, differenceResult.PN],
  )

  const best = useMemo(() => bestEstimate(agg, projection), [agg, projection])
  const toSum = useMemo(() => amountToSum(agg, projection), [agg, projection])

  const evaluationTriggers: EvaluationTrigger[] = useMemo(() => {
    if (isDetails) {
      if (method === '' || method === 'deviationRate') return []
      return evaluateDetails({
        best,
        tolerableMisstatement: plan.tolerableMisstatement,
        offsettingAppropriate: plan.offsettingAppropriate === 'yes',
        expectedMisstatement: plan.expectedMisstatement,
        projectedNet: projection.PN,
      })
    }
    return evaluateControls({
      deviationRate,
      tolerableRatePct: plan.tolerableDeviationRatePct,
      expectedRatePct: plan.expectedDeviationRatePct,
      deviationsFound: representativeDeviations,
    })
  }, [isDetails, method, best, plan, projection.PN, deviationRate, representativeDeviations])

  const hardTriggers = evaluationTriggers.filter((t) => t.severity === 'hard')
  const nilResult = isDetails
    ? agg.sampleMisstatementCount === 0 && agg.factualMisstatementCount === 0
    : sampleDeviations === 0

  // -------------------------------------------------------------------------
  // Hard blocks (14.1)
  // -------------------------------------------------------------------------

  const hardBlocks: string[] = useMemo(() => {
    const blocks: string[] = []

    // 1. Mandatory fields, Blocks A to H. Identification text, descriptions and
    // narrative are written on the working paper and gate finalisation instead.
    const missing: string[] = []
    if (isDetails && plan.offsettingAppropriate === '')
      missing.push('Offsetting appropriate (yes/no)')
    if (missing.length) blocks.push(`Mandatory fields incomplete: ${missing.join(', ')}.`)

    // 2–3. Sample counts
    if (sample.itemCount <= 0) blocks.push('Sample item count must be greater than zero.')
    if (residualCount > 0 && sample.itemCount > residualCount)
      blocks.push('Sample item count exceeds the residual population item count.')

    // 4. Sample value
    if (isDetails && residualValue > 0 && sample.recordedValue > residualValue)
      blocks.push('Sample recorded value exceeds the residual population value.')

    // 5–6. Residual population
    if (residualValue < 0 || residualCount < 0)
      blocks.push(
        'Items tested 100% plus specifically selected items exceed the total population (residual population is negative).',
      )

    // 7. TM vs PM
    if (
      isDetails &&
      plan.performanceMateriality > 0 &&
      plan.tolerableMisstatement > plan.performanceMateriality
    )
      blocks.push('Tolerable misstatement may not exceed performance materiality.')
    if (isDetails && plan.tolerableMisstatement <= 0)
      blocks.push('Tolerable misstatement for this population is required.')
    if (!isDetails && plan.tolerableDeviationRatePct <= 0)
      blocks.push('Tolerable rate of deviation is required.')

    // 8. Reconciliation
    if (reconDifference !== 0 && !recon.explanation.trim())
      blocks.push(
        'The population reconciling difference is not nil and no explanation has been entered.',
      )

    // 9. Anomaly flag without approval
    const unapproved = [...mEntries, ...dEntries].filter((e) =>
      anomalyFlaggedButNotApproved(e),
    )
    if (unapproved.length)
      blocks.push(
        `${unapproved.length} anomaly flag(s) set without completed justification and reviewer approval (Block F). Until approved these items are projected as representative.`,
      )

    // 10. Anomaly on fraud item
    const fraudAnomaly = [...mEntries, ...dEntries].filter(
      (e) => e.anomalyFlagged && e.fraudIndicator,
    )
    if (fraudAnomaly.length)
      blocks.push(
        'A misstatement or deviation arising from suspected fraud may not be classified as an anomaly in this module. Fraud is an indicator of a pervasive risk and requires reassessment under ISA 240.',
      )

    // 11–13. Method availability and required inputs
    if (method !== '') {
      if (isDetails && method === 'deviationRate')
        blocks.push('Method 4 applies to tests of controls only.')
      if (!isDetails && method !== 'deviationRate')
        blocks.push('Tests of controls use Method 4 (rate of deviation) only.')
      if (isDetails && method !== 'deviationRate') {
        if (availability[method] === 'blocked')
          blocks.push(
            `${PROJECTION_METHOD_LABELS[method]} is not available for ${SELECTION_METHOD_LABELS[plan.selectionMethod]} selection (Section 11.6).`,
          )
        if (method === 'meanPerUnit' && mpuGateFailures.length)
          blocks.push(...mpuGateFailures.map((f) => `Mean per Unit blocked — ${f}`))
        if (method === 'ratio' && sample.recordedValue <= 0)
          blocks.push('Ratio projection requires the sample recorded value.')
        if (method === 'meanPerUnit' && sample.auditedValueTotal <= 0)
          blocks.push('Mean per Unit requires the total audited value of the sample.')
      }
    }

    // 14. Fraud escalation is completed on the working paper itself and blocks
    // finalisation there (Section 10.1), not working paper generation.

    // 16. Same basis / currency
    if (!sample.sameBasisConfirmed)
      blocks.push(
        'Confirm that the population and the sample are stated on the same basis (recorded values, same currency, same period).',
      )
    if (!sample.drawnFromResidualConfirmed)
      blocks.push('Confirm that the sample was drawn only from the residual population.')

    return blocks
  }, [
    eng,
    recon,
    reconDifference,
    isDetails,
    plan,
    sample,
    residualValue,
    residualCount,
    mEntries,
    dEntries,
    method,
    availability,
    mpuGateFailures,
  ])

  // Blocks A–F gate for the method selector (Screen 1 rule)
  const methodSelectorLocked = useMemo(() => {
    return (
      comp.totalValue <= 0 ||
      comp.totalCount <= 0 ||
      residualValue < 0 ||
      residualCount < 0 ||
      sample.itemCount <= 0 ||
      (isDetails && plan.tolerableMisstatement <= 0) ||
      (!isDetails && plan.tolerableDeviationRatePct <= 0) ||
      quality.noItemExceedsTolerable.answer === '' ||
      quality.noNegativeBalances.answer === '' ||
      quality.noZeroValueItems.answer === '' ||
      quality.homogeneous.answer === ''
    )
  }, [comp, residualValue, residualCount, sample.itemCount, isDetails, plan, quality])

  // -------------------------------------------------------------------------
  // Soft warnings (14.2), each with a stable id so a response can be recorded
  // -------------------------------------------------------------------------

  const warnings: Warning[] = useMemo(() => {
    const list: Warning[] = []

    if (
      recon.valuePerListing > 0 &&
      Math.abs(reconDifference) >
        (PROJ_CONFIG.reconciliationDifferenceWarnPct / 100) * recon.valuePerListing
    ) {
      list.push({
        id: 'recon-large',
        text: 'The population may not be complete. Projection from an incomplete population is not reliable.',
      })
    }
    if (eng.assertion === 'Completeness') {
      list.push({
        id: 'completeness-assertion',
        text: 'A population of recorded items cannot ordinarily support a completeness conclusion. Confirm that the population selected is appropriate for the assertion tested.',
      })
    }
    if (quality.noItemExceedsTolerable.answer === 'no') {
      list.push({
        id: 'q-item-exceeds',
        text: 'Items exceeding tolerable misstatement should be tested 100 percent, not sampled. Move them to Bucket 1.',
      })
    }
    if (quality.noNegativeBalances.answer === 'no') {
      list.push({
        id: 'q-negatives',
        text: 'Negative balances distort ratio and mean per unit projection. Consider a separate population.',
      })
    }
    if (quality.noZeroValueItems.answer === 'no') {
      list.push({
        id: 'q-zeros',
        text: 'Zero value items inflate the item count and distort projection by item count.',
      })
    }
    if (quality.homogeneous.answer === 'no') {
      list.push({
        id: 'q-dispersed',
        text: 'A widely dispersed population should be stratified. Run the module once per stratum (Section 12).',
      })
    }
    if (
      isDetails &&
      plan.performanceMateriality > 0 &&
      plan.tolerableMisstatement === plan.performanceMateriality
    ) {
      list.push({
        id: 'tm-equals-pm',
        text: 'Where more than one population is tested within the same financial statement line item, setting tolerable misstatement equal to performance materiality does not allow for aggregation risk.',
      })
    }
    if (plan.selectionMethod === 'block') {
      list.push({
        id: 'sel-block',
        text: 'Block selection can rarely be used as an appropriate sample selection technique. Selected items are unlikely to be representative of the population. Record the justification.',
      })
    }
    if (plan.selectionMethod === 'haphazard') {
      list.push({
        id: 'sel-haphazard',
        text: 'Haphazard selection is not appropriate when using statistical sampling and may carry unconscious bias. Confirm no conscious bias in selection.',
      })
    }
    if (
      isDetails &&
      residualValue > 0 &&
      sample.recordedValue >
        (PROJ_CONFIG.highCoverageEfficiencyWarnPct / 100) * residualValue
    ) {
      list.push({
        id: 'coverage-high',
        text: 'At this coverage, consider whether extending to 100 percent testing is more efficient than projecting.',
      })
    }
    if (agg.flaggedAnomalyCount > 1) {
      list.push({
        id: 'multi-anomaly',
        text: 'ISA 530 contemplates anomalies in extremely rare circumstances. Flagging multiple anomalies in one population is difficult to sustain. Reconsider whether these misstatements are in fact representative of a systematic issue.',
      })
    }
    const grossSample = agg.GO + agg.GU
    const anomalousTotal = agg.AO + agg.AU
    if (grossSample > 0 && anomalousTotal > 0.5 * grossSample) {
      list.push({
        id: 'anomaly-majority',
        text: 'A single item driving the majority of the sample misstatement is more likely to indicate a population characteristic than an anomaly.',
      })
    }
    if (
      isDetails &&
      (method === 'ratio' || method === 'difference') &&
      divergence.differs
    ) {
      list.push({
        id: 'divergence',
        text: `Ratio projection and difference projection produce materially different results (Ratio: ${fmtNum(ratioResult.PN)}, Difference: ${fmtNum(differenceResult.PN)}). This indicates that the relationship between item size and misstatement is not as assumed. Reconsider the method selected and record the reason for the selection.`,
      })
    }
    if (isDetails && method === 'ratio' && plan.selectionMethod === 'monetaryUnit') {
      list.push({
        id: 'mus-ratio',
        text: 'Where selection was value weighted, larger items had a higher chance of selection. Ratio projection using recorded values may not reflect the residual population. Record the basis on which the projection is considered appropriate.',
      })
    }
    if (
      isDetails &&
      method !== '' &&
      method !== 'deviationRate' &&
      availability[method] === 'warning' &&
      plan.selectionMethod !== 'monetaryUnit'
    ) {
      list.push({
        id: 'method-selection-warning',
        text: `${PROJECTION_METHOD_LABELS[method]} with ${SELECTION_METHOD_LABELS[plan.selectionMethod]} selection: item selection probability was not equal and the projection may not reflect the residual population. Record the basis on which the projection is considered appropriate.`,
      })
    }
    if (isDetails && agg.allCorrected && agg.sampleMisstatementCount > 0) {
      list.push({
        id: 'all-corrected',
        text: 'Management has corrected all identified misstatements. The projected misstatement in the untested population remains uncorrected and is carried forward. Consider whether the correction of identified items indicates a wider issue requiring further investigation.',
      })
    }
    const highRisk = plan.assessedRisk === 'High' || plan.assessedRisk === 'Significant'
    if (highRisk && sample.itemCount > 0 && sample.itemCount < PROJ_CONFIG.minSampleSizeWarnHighRisk) {
      list.push({
        id: 'small-sample-high-risk',
        text: `Sample size is below the firm floor of ${PROJ_CONFIG.minSampleSizeWarnHighRisk} items for a population assessed as High or Significant risk.`,
      })
    }
    if (
      highRisk &&
      isDetails &&
      residualValue > 0 &&
      sample.recordedValue > 0 &&
      sample.recordedValue <
        (PROJ_CONFIG.minValueCoverageWarnPctHighRisk / 100) * residualValue
    ) {
      list.push({
        id: 'low-coverage-high-risk',
        text: `The sample covers less than ${PROJ_CONFIG.minValueCoverageWarnPctHighRisk} percent of the residual population by value for a High or Significant risk population.`,
      })
    }
    if (nilResult) {
      list.push({
        id: 'nil-result',
        text: isDetails ? NIL_RESULT_NOTE_DETAILS : NIL_RESULT_NOTE_CONTROLS,
      })
    }
    for (const t of evaluationTriggers.filter((t) => t.severity === 'soft')) {
      list.push({ id: t.id, text: t.text })
    }
    return list
  }, [
    recon.valuePerListing,
    reconDifference,
    eng.assertion,
    quality,
    isDetails,
    plan,
    residualValue,
    sample.recordedValue,
    sample.itemCount,
    agg,
    method,
    divergence,
    ratioResult.PN,
    differenceResult.PN,
    availability,
    nilResult,
    evaluationTriggers,
  ])

  // -------------------------------------------------------------------------
  // Formatting helpers
  // -------------------------------------------------------------------------

  function fmtNum(v: number): string {
    return `${eng.currency} ${Math.round(v).toLocaleString('en-PK')}`
  }
  function fmtRate(v: number | null): string {
    return v == null ? '—' : `${(v * 100).toFixed(2)}%`
  }

  // -------------------------------------------------------------------------
  // Register helpers
  // -------------------------------------------------------------------------

  function updateMEntry(id: string, patch: Partial<MisstatementEntry>) {
    setMEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }
  function updateDEntry(id: string, patch: Partial<DeviationEntry>) {
    setDEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }
  function updateAnomaly(
    id: string,
    kind: 'm' | 'd',
    patch: Partial<MisstatementEntry['anomaly']>,
  ) {
    if (kind === 'm') {
      setMEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, anomaly: { ...e.anomaly, ...patch } } : e)),
      )
    } else {
      setDEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, anomaly: { ...e.anomaly, ...patch } } : e)),
      )
    }
  }

  const canGenerateWp = hardBlocks.length === 0

  const hasExtraBuckets =
    comp.tested100Value > 0 ||
    comp.tested100Count > 0 ||
    comp.specificValue > 0 ||
    comp.specificCount > 0

  const stepDone: Record<ProjStepId, boolean> = {
    setup: true,
    population:
      comp.totalValue > 0 &&
      comp.totalCount > 0 &&
      residualValue >= 0 &&
      residualCount >= 0 &&
      quality.noItemExceedsTolerable.answer !== '' &&
      quality.noNegativeBalances.answer !== '' &&
      quality.noZeroValueItems.answer !== '' &&
      quality.homogeneous.answer !== '',
    planning:
      (isDetails
        ? plan.tolerableMisstatement > 0 && plan.offsettingAppropriate !== ''
        : plan.tolerableDeviationRatePct > 0) &&
      !(
        isDetails &&
        plan.performanceMateriality > 0 &&
        plan.tolerableMisstatement > plan.performanceMateriality
      ),
    sample:
      sample.itemCount > 0 &&
      sample.drawnFromResidualConfirmed &&
      sample.sameBasisConfirmed &&
      !(isDetails && residualValue > 0 && sample.recordedValue > residualValue) &&
      !(residualCount > 0 && sample.itemCount > residualCount),
    register: true,
    method: method !== '' || !isDetails,
    review: canGenerateWp,
  }

  const stepOrder = PROJ_STEPS.map((s) => s.id)
  const stepIndex = stepOrder.indexOf(step)

  function stepUnlocked(id: ProjStepId): boolean {
    const idx = stepOrder.indexOf(id)
    if (idx <= 0) return true
    for (let i = 0; i < idx; i++) {
      if (!stepDone[stepOrder[i]]) return false
    }
    return true
  }

  function goNext() {
    const next = stepOrder[stepIndex + 1]
    if (next && stepUnlocked(next)) setStep(next)
  }

  function goBack() {
    const prev = stepOrder[stepIndex - 1]
    if (prev) setStep(prev)
  }

  function stepActions(opts?: { nextDisabled?: boolean; nextLabel?: string }) {
    const isLast = step === 'review'
    return (
      <div className="actions proj-step-actions">
        {stepIndex > 0 ? (
          <button type="button" className="ghost" onClick={goBack}>
            ← Back
          </button>
        ) : (
          <span />
        )}
        {!isLast ? (
          <button
            type="button"
            className="primary"
            disabled={opts?.nextDisabled ?? !stepDone[step]}
            onClick={goNext}
          >
            {opts?.nextLabel ?? 'Continue'}
          </button>
        ) : null}
      </div>
    )
  }

  const missingNarrative: string[] = useMemo(() => {
    const gaps: string[] = []
    if (!eng.clientName.trim()) gaps.push('Client name')
    if (!eng.auditPeriod.trim()) gaps.push('Audit period')
    if (!eng.wpReference.trim()) gaps.push('Working paper reference')
    if (!eng.accountTested.trim()) gaps.push('Account or population tested')
    if (!eng.fsLineItem.trim()) gaps.push('Financial statement line item')
    if (!eng.samplingUnit.trim()) gaps.push('Sampling unit')
    if (!eng.populationSource.trim()) gaps.push('Population source description')
    if (!recon.reconciledTo.trim()) gaps.push('Population reconciled to')
    if (!recon.verifiedBy.trim()) gaps.push('Completeness verified by')
    if (!sample.periodCovered.trim()) gaps.push('Period covered by the sample')
    if (method !== '' && !signOff.methodSelectionReason.trim())
      gaps.push('Reason for method selection')
    if (isDetails && !plan.tolerableMisstatementBasis.trim())
      gaps.push('Basis for tolerable misstatement')
    if (!isDetails && !plan.tolerableDeviationRateBasis.trim())
      gaps.push('Basis for tolerable rate of deviation')
    if (!plan.sampleSizeRationale.trim()) gaps.push('Sample size rationale')
    if (isDetails && plan.offsettingAppropriate === 'no' && !plan.offsettingReason.trim())
      gaps.push('Offsetting reason')
    if (
      (agg.sampleMisstatementCount > 0 || sampleDeviations > 0) &&
      !qual.natureAndCause.trim()
    )
      gaps.push('Nature and cause of misstatements or deviations')
    for (const w of warnings) {
      if (!(warningResponses[w.id] ?? '').trim()) gaps.push(`Response to warning: ${w.id}`)
    }
    if (hardTriggers.length > 0 && signOff.plannedResponses.length === 0)
      gaps.push('Planned audit response (at least one required — a hard trigger has fired)')
    if (fraudPresent && !qual.escalationResponse.trim())
      gaps.push('Escalation and ISA 240 response (suspected fraud identified)')
    if (!signOff.finalConclusion.trim()) gaps.push('Final conclusion')
    if (!signOff.preparedBy.trim()) gaps.push('Preparer signature')
    if (!signOff.reviewedBy.trim()) gaps.push('Reviewer signature')
    return gaps
  }, [eng, recon.reconciledTo, recon.verifiedBy, sample.periodCovered, method, signOff, isDetails, plan.tolerableMisstatementBasis, plan.tolerableDeviationRateBasis, plan.sampleSizeRationale, plan.offsettingAppropriate, plan.offsettingReason, agg.sampleMisstatementCount, sampleDeviations, qual.natureAndCause, qual.escalationResponse, fraudPresent, warnings, warningResponses, hardTriggers.length])

  // -------------------------------------------------------------------------
  // Anomaly editor
  // -------------------------------------------------------------------------

  function anomalyEditor(
    e: MisstatementEntry | DeviationEntry,
    kind: 'm' | 'd',
  ) {
    const approved = isAnomalyApproved(e)
    return (
      <tr key={`${e.id}-anomaly`} className="proj-anomaly-row">
        <td colSpan={kind === 'm' ? 10 : 6}>
          <div className="proj-anomaly-editor">
            <p className="hint">
              Block F — anomaly justification gate (ISA 530.13). The flag has no effect on
              any calculation until every field below is complete and reviewer approval is
              recorded by a separate user.{' '}
              {approved ? (
                <strong>Status: approved — excluded from projection.</strong>
              ) : (
                <strong>Status: not approved — still projected as representative.</strong>
              )}
            </p>
            <label>Additional audit procedures performed (minimum {PROJ_CONFIG.anomalyProceduresMinLength} characters)</label>
            <textarea
              rows={2}
              value={e.anomaly.proceduresPerformed}
              onChange={(ev) => updateAnomaly(e.id, kind, { proceduresPerformed: ev.target.value })}
            />
            <label>Basis for concluding a high degree of certainty that the item is not representative</label>
            <textarea
              rows={2}
              value={e.anomaly.basisForCertainty}
              onChange={(ev) => updateAnomaly(e.id, kind, { basisForCertainty: ev.target.value })}
            />
            <div className="form-grid grid-3">
              <div>
                <label>Evidence reference on the audit file</label>
                <input
                  value={e.anomaly.evidenceReference}
                  onChange={(ev) => updateAnomaly(e.id, kind, { evidenceReference: ev.target.value })}
                />
              </div>
              <div>
                <label>Preparer (name)</label>
                <input
                  value={e.anomaly.preparerName}
                  onChange={(ev) => updateAnomaly(e.id, kind, { preparerName: ev.target.value })}
                />
              </div>
              <div>
                <label>Preparer date</label>
                <input
                  type="date"
                  value={e.anomaly.preparerDate}
                  onChange={(ev) => updateAnomaly(e.id, kind, { preparerDate: ev.target.value })}
                />
              </div>
              <div>
                <label>Reviewer (separate user)</label>
                <input
                  value={e.anomaly.reviewerName}
                  onChange={(ev) => updateAnomaly(e.id, kind, { reviewerName: ev.target.value })}
                />
              </div>
              <div>
                <label>Reviewer date</label>
                <input
                  type="date"
                  value={e.anomaly.reviewerDate}
                  onChange={(ev) => updateAnomaly(e.id, kind, { reviewerDate: ev.target.value })}
                />
              </div>
            </div>
          </div>
        </td>
      </tr>
    )
  }

  // -------------------------------------------------------------------------
  // Screen 2: Working paper
  // -------------------------------------------------------------------------

  if (screen === 'workingPaper') {
    const methodLabel = method === '' ? '—' : PROJECTION_METHOD_LABELS[method]
    /** Editable box on screen, plain text (or blank line) when printed. */
    const wpBox = (value: string, set: (v: string) => void, placeholder: string) => (
      <>
        <input
          className="screen-only wp-inline-input"
          placeholder={placeholder}
          value={value}
          disabled={signOff.finalized}
          onChange={(e) => set(e.target.value)}
        />
        <span className="print-only">{value || '\u00A0'}</span>
      </>
    )
    return (
      <div className="wp-screen">
        <div className="wp-toolbar no-print">
          <button type="button" className="ghost" onClick={() => setScreen('inputs')}>
            ← Back to inputs
          </button>
          <div className="wp-toolbar-actions">
            <button type="button" className="primary" onClick={() => window.print()}>
              Print / Save as PDF
            </button>
            <button
              type="button"
              className="primary"
              disabled={signOff.finalized || missingNarrative.length > 0}
              onClick={() => setSignOff((p) => ({ ...p, finalized: true }))}
            >
              {signOff.finalized ? 'Final (locked)' : 'Mark as Final'}
            </button>
          </div>
        </div>

        {missingNarrative.length > 0 && (
          <div className="banner warn no-print">
            The working paper may not be marked Final while mandatory narrative is blank:{' '}
            {missingNarrative.join('; ')}
          </div>
        )}

        <article className="working-paper isa230-wp">
          <header className="wp-masthead">
            <div className="wp-std-line">
              <span>Projection and evaluation</span>
              <span>ISA 530</span>
            </div>
            <h1>ISA 530 Projection and Evaluation Working Paper</h1>
            <p className="wp-subtitle">
              Non statistical projection — point estimates only
              {signOff.finalized ? ' · FINAL' : ' · DRAFT'}
            </p>
            <table className="wp-id-table">
              <tbody>
                <tr>
                  <th scope="row">Client</th>
                  <td>{wpBox(eng.clientName, (v) => setEng((p) => ({ ...p, clientName: v })), 'Client name')}</td>
                  <th scope="row">Audit period</th>
                  <td>{wpBox(eng.auditPeriod, (v) => setEng((p) => ({ ...p, auditPeriod: v })), 'e.g. 1 Jan – 31 Dec 2025')}</td>
                </tr>
                <tr>
                  <th scope="row">Account / population</th>
                  <td>{wpBox(eng.accountTested, (v) => setEng((p) => ({ ...p, accountTested: v })), 'Account or population tested')}</td>
                  <th scope="row">FS line item</th>
                  <td>{wpBox(eng.fsLineItem, (v) => setEng((p) => ({ ...p, fsLineItem: v })), 'FS line item affected')}</td>
                </tr>
                <tr>
                  <th scope="row">WP reference</th>
                  <td>{wpBox(eng.wpReference, (v) => setEng((p) => ({ ...p, wpReference: v })), 'WP reference')}</td>
                  <th scope="row">Stratum reference</th>
                  <td>{wpBox(eng.stratumRef, (v) => setEng((p) => ({ ...p, stratumRef: v })), 'Optional')}</td>
                </tr>
                <tr>
                  <th scope="row">Test type</th>
                  <td>{isDetails ? 'Test of details' : 'Test of controls'}</td>
                  <th scope="row">Assertion / direction</th>
                  <td>
                    {eng.assertion} / {eng.direction}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Sampling unit</th>
                  <td>{wpBox(eng.samplingUnit, (v) => setEng((p) => ({ ...p, samplingUnit: v })), 'e.g. individual invoice')}</td>
                  <th scope="row">Currency</th>
                  <td>{eng.currency}</td>
                </tr>
              </tbody>
            </table>
          </header>

          {fraudPresent && (
            <div className="banner error">
              Suspected fraud identified. Refer to the engagement fraud risk assessment and
              communication requirements under ISA 240.
            </div>
          )}

          <section>
            <h2>1. Population and completeness</h2>
            <p>
              <strong>Population source:</strong>{' '}
              {wpBox(
                eng.populationSource,
                (v) => setEng((p) => ({ ...p, populationSource: v })),
                'e.g. sales ledger detail report dated 31 December 2025',
              )}
            </p>
            <p>
              <strong>Reconciled to:</strong>{' '}
              {wpBox(
                recon.reconciledTo,
                (v) => setRecon((p) => ({ ...p, reconciledTo: v })),
                'GL account or FS line',
              )}
            </p>
            <p>
              <strong>Reconciliation:</strong> listing {fmtNum(recon.valuePerListing)} vs
              GL/FS {fmtNum(recon.valuePerGL)} · difference {fmtNum(reconDifference)}
              {reconDifference !== 0 ? ` — ${recon.explanation}` : ''}
            </p>
            <p>
              <strong>Completeness verified by:</strong>{' '}
              {wpBox(
                recon.verifiedBy,
                (v) => setRecon((p) => ({ ...p, verifiedBy: v })),
                'Name',
              )}{' '}
              <input
                className="screen-only wp-inline-input wp-inline-date"
                type="date"
                aria-label="Date verified"
                value={recon.verifiedDate}
                disabled={signOff.finalized}
                onChange={(e) => setRecon((p) => ({ ...p, verifiedDate: e.target.value }))}
              />
              <span className="print-only">{recon.verifiedDate || '\u00A0'}</span>
            </p>
            <div className="preview-table-wrap wp-table">
              <table>
                <thead>
                  <tr>
                    <th>Bucket</th>
                    <th>Value</th>
                    <th>Count</th>
                    <th>Projected?</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>1. Items tested 100%</td>
                    <td>{fmtNum(comp.tested100Value)}</td>
                    <td>{comp.tested100Count}</td>
                    <td>Never</td>
                  </tr>
                  <tr>
                    <td>2. Specifically selected items</td>
                    <td>{fmtNum(comp.specificValue)}</td>
                    <td>{comp.specificCount}</td>
                    <td>Never</td>
                  </tr>
                  <tr>
                    <td>3. Residual population</td>
                    <td>{fmtNum(residualValue)}</td>
                    <td>{residualCount}</td>
                    <td>Yes</td>
                  </tr>
                  <tr>
                    <td><strong>Total population</strong></td>
                    <td><strong>{fmtNum(comp.totalValue)}</strong></td>
                    <td><strong>{comp.totalCount}</strong></td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p><strong>Data quality pre checks (Section 5.1):</strong></p>
            <ul>
              <li>
                No single item exceeds tolerable misstatement:{' '}
                {quality.noItemExceedsTolerable.answer || '—'}{' '}
                {quality.noItemExceedsTolerable.note}
              </li>
              <li>
                No negative or credit balances: {quality.noNegativeBalances.answer || '—'}{' '}
                {quality.noNegativeBalances.note}
              </li>
              <li>
                No zero value items: {quality.noZeroValueItems.answer || '—'}{' '}
                {quality.noZeroValueItems.note}
              </li>
              <li>
                Reasonably homogeneous in value: {quality.homogeneous.answer || '—'}{' '}
                {quality.homogeneous.note}
              </li>
            </ul>
          </section>

          <section>
            <h2>2. Planning parameters</h2>
            <p>
              <strong>Assessed risk:</strong> {plan.assessedRisk} ·{' '}
              <strong>Reliance on controls:</strong> {plan.reliance}
            </p>
            {isDetails ? (
              <>
                <p>
                  <strong>Performance materiality:</strong> {fmtNum(plan.performanceMateriality)} ·{' '}
                  <strong>Tolerable misstatement:</strong> {fmtNum(plan.tolerableMisstatement)}
                </p>
                <div className="screen-only">
                  <label>Basis for tolerable misstatement (completed by the auditor)</label>
                  <textarea
                    rows={2}
                    value={plan.tolerableMisstatementBasis}
                    disabled={signOff.finalized}
                    onChange={(e) =>
                      setPlan((p) => ({ ...p, tolerableMisstatementBasis: e.target.value }))
                    }
                  />
                </div>
                <p className="print-only"><strong>Basis:</strong> {plan.tolerableMisstatementBasis || '—'}</p>
                <p>
                  <strong>Expected misstatement used in sizing:</strong>{' '}
                  {fmtNum(plan.expectedMisstatement)}
                </p>
                <p>
                  <strong>Offsetting appropriate:</strong> {plan.offsettingAppropriate || '—'}
                </p>
                {plan.offsettingAppropriate !== '' && (
                  <>
                    <div className="screen-only">
                      <label>Reason for the offsetting decision (completed by the auditor)</label>
                      <input
                        value={plan.offsettingReason}
                        disabled={signOff.finalized}
                        onChange={(e) =>
                          setPlan((p) => ({ ...p, offsettingReason: e.target.value }))
                        }
                      />
                    </div>
                    <p className="print-only">
                      <strong>Reason (offsetting):</strong> {plan.offsettingReason || '—'}
                    </p>
                  </>
                )}
              </>
            ) : (
              <>
                <p>
                  <strong>Tolerable rate of deviation:</strong>{' '}
                  {plan.tolerableDeviationRatePct.toFixed(2)}% ·{' '}
                  <strong>Expected rate:</strong> {plan.expectedDeviationRatePct.toFixed(2)}%
                </p>
                <div className="screen-only">
                  <label>Basis for tolerable rate of deviation (completed by the auditor)</label>
                  <textarea
                    rows={2}
                    value={plan.tolerableDeviationRateBasis}
                    disabled={signOff.finalized}
                    onChange={(e) =>
                      setPlan((p) => ({ ...p, tolerableDeviationRateBasis: e.target.value }))
                    }
                  />
                </div>
                <p className="print-only"><strong>Basis:</strong> {plan.tolerableDeviationRateBasis || '—'}</p>
              </>
            )}
            <p>
              <strong>Basis for sample size:</strong> {plan.sampleSizeBasis}
            </p>
            <div className="screen-only">
              <label>Sample size rationale (completed by the auditor)</label>
              <textarea
                rows={2}
                value={plan.sampleSizeRationale}
                disabled={signOff.finalized}
                onChange={(e) =>
                  setPlan((p) => ({ ...p, sampleSizeRationale: e.target.value }))
                }
              />
            </div>
            <p className="print-only">
              <strong>Sample size rationale:</strong> {plan.sampleSizeRationale || '—'}
            </p>
            <p>
              <strong>Selection method:</strong>{' '}
              {SELECTION_METHOD_LABELS[plan.selectionMethod]}
            </p>
          </section>

          <section>
            <h2>3. Sample and results</h2>
            <p>
              <strong>Sample:</strong> {sample.itemCount} items
              {isDetails ? ` · recorded value ${fmtNum(sample.recordedValue)}` : ''} · period{' '}
              {wpBox(
                sample.periodCovered,
                (v) => setSample((p) => ({ ...p, periodCovered: v })),
                'Date range covered by the sample',
              )}
            </p>
            {isDetails && residualValue > 0 && (
              <p>
                <strong>Coverage of residual population:</strong>{' '}
                {((sample.recordedValue / residualValue) * 100).toFixed(2)}% by value ·{' '}
                {residualCount > 0
                  ? ((sample.itemCount / residualCount) * 100).toFixed(2)
                  : '—'}
                % by count
              </p>
            )}
            {isDetails ? (
              <>
                <div className="preview-table-wrap wp-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Ref</th>
                        <th>Bucket</th>
                        <th>Recorded</th>
                        <th>Audited</th>
                        <th>Difference</th>
                        <th>Direction</th>
                        <th>Anomaly</th>
                        <th>Corrected</th>
                        <th>Fraud</th>
                        <th>Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mEntries.length === 0 ? (
                        <tr><td colSpan={10}>No misstatements identified.</td></tr>
                      ) : (
                        mEntries.map((e) => {
                          const d = entryDifference(e)
                          return (
                            <tr key={`wp-${e.id}`}>
                              <td>{e.itemRef || '—'}</td>
                              <td>{BUCKET_LABELS[e.bucket]}</td>
                              <td>{fmtNum(e.recordedValue)}</td>
                              <td>{fmtNum(e.auditedValue)}</td>
                              <td>{fmtNum(d)}</td>
                              <td>{d >= 0 ? 'Overstatement' : 'Understatement'}</td>
                              <td>{isAnomalyApproved(e) ? 'Approved' : e.anomalyFlagged ? 'Not approved' : 'No'}</td>
                              <td>{e.correctedByManagement ? 'Yes' : 'No'}</td>
                              <td>{e.fraudIndicator ? 'Yes' : 'No'}</td>
                              <td>{e.description || '—'}</td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="stat-grid">
                  <div><span>Gross overstatement (GO)</span><strong>{fmtNum(agg.GO)}</strong></div>
                  <div><span>Gross understatement (GU)</span><strong>{fmtNum(agg.GU)}</strong></div>
                  <div><span>Net sample misstatement</span><strong>{fmtNum(agg.NSM)}</strong></div>
                  <div><span>Factual net (buckets 1–2)</span><strong>{fmtNum(agg.FN)}</strong></div>
                  <div><span>Anomalous net (approved)</span><strong>{fmtNum(agg.AN)}</strong></div>
                  <div><span>Representative net</span><strong>{fmtNum(agg.RN)}</strong></div>
                </div>
              </>
            ) : (
              <>
                <div className="preview-table-wrap wp-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Ref</th>
                        <th>Bucket</th>
                        <th>Nature of deviation</th>
                        <th>Anomaly</th>
                        <th>Fraud</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dEntries.length === 0 ? (
                        <tr><td colSpan={5}>No deviations identified.</td></tr>
                      ) : (
                        dEntries.map((e) => (
                          <tr key={`wp-${e.id}`}>
                            <td>{e.itemRef || '—'}</td>
                            <td>{BUCKET_LABELS[e.bucket]}</td>
                            <td>{e.natureOfDeviation || '—'}</td>
                            <td>{isAnomalyApproved(e) ? 'Approved' : e.anomalyFlagged ? 'Not approved' : 'No'}</td>
                            <td>{e.fraudIndicator ? 'Yes' : 'No'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <p>
                  <strong>Representative deviations:</strong> {representativeDeviations} of{' '}
                  {sample.itemCount} items
                </p>
              </>
            )}
            {[...mEntries, ...dEntries]
              .filter((e) => isAnomalyApproved(e))
              .map((e) => (
                <p key={`wp-anom-${e.id}`} className="hint">
                  <strong>Approved anomaly {e.itemRef}:</strong> {e.anomaly.proceduresPerformed}{' '}
                  Basis: {e.anomaly.basisForCertainty} Evidence: {e.anomaly.evidenceReference}.
                  Prepared {e.anomaly.preparerName} {e.anomaly.preparerDate}; approved{' '}
                  {e.anomaly.reviewerName} {e.anomaly.reviewerDate}.
                </p>
              ))}
          </section>

          <section>
            <h2>4. Projection</h2>
            <p><strong>Method:</strong> {methodLabel}</p>
            <div className="screen-only">
              <label>Reason for method selection (completed by the auditor)</label>
              <textarea
                rows={2}
                value={signOff.methodSelectionReason}
                disabled={signOff.finalized}
                onChange={(e) =>
                  setSignOff((p) => ({ ...p, methodSelectionReason: e.target.value }))
                }
              />
            </div>
            <p className="print-only">
              <strong>Reason for method selection:</strong> {signOff.methodSelectionReason || '—'}
            </p>
            {isDetails && method === 'ratio' && (
              <>
                <p>Projection factor k = Residual population value ÷ Sample recorded value = {fmtNum(residualValue)} ÷ {fmtNum(sample.recordedValue)} = <strong>{ratioResult.factor?.toFixed(4) ?? '—'}</strong></p>
                <p>Projected overstatement PO = RO × k = {fmtNum(agg.RO)} × {ratioResult.factor?.toFixed(4)} = <strong>{fmtNum(ratioResult.PO)}</strong></p>
                <p>Projected understatement PU = RU × k = {fmtNum(agg.RU)} × {ratioResult.factor?.toFixed(4)} = <strong>{fmtNum(ratioResult.PU)}</strong></p>
                <p>Projected net PN = PO − PU = <strong>{fmtNum(ratioResult.PN)}</strong></p>
              </>
            )}
            {isDetails && method === 'difference' && (
              <>
                <p>Projection factor m = Residual population item count ÷ Sample item count = {residualCount} ÷ {sample.itemCount} = <strong>{differenceResult.factor?.toFixed(4) ?? '—'}</strong></p>
                <p>Projected overstatement PO = RO × m = <strong>{fmtNum(differenceResult.PO)}</strong></p>
                <p>Projected understatement PU = RU × m = <strong>{fmtNum(differenceResult.PU)}</strong></p>
                <p>Projected net PN = PO − PU = <strong>{fmtNum(differenceResult.PN)}</strong></p>
              </>
            )}
            {isDetails && method === 'meanPerUnit' && (
              <>
                <p>Mean audited value per item = <strong>{mpuResult.meanAuditedValue == null ? '—' : fmtNum(mpuResult.meanAuditedValue)}</strong></p>
                <p>Estimated residual population value EV = <strong>{fmtNum(mpuResult.estimatedValue)}</strong></p>
                <p>Projected net misstatement PN = Residual population value − EV = <strong>{fmtNum(mpuResult.PN)}</strong></p>
                <p className="hint">
                  Mean per Unit produces a net estimate only. The anomalous item is excluded
                  from the sample mean and the uncorrected anomalous misstatement is added to
                  the total. This treatment approximates; consider corroborating the result
                  using Method 1 or Method 2.
                </p>
              </>
            )}
            {!isDetails && (
              <p>
                Sample deviation rate, being the projected population rate of deviation ={' '}
                {representativeDeviations} ÷ {sample.itemCount} ={' '}
                <strong>{fmtRate(deviationRate)}</strong>
              </p>
            )}
            {isDetails && (method === 'ratio' || method === 'difference') && (
              <p className="hint">
                Divergence check (11.3): Ratio net {fmtNum(ratioResult.PN)} vs Difference net{' '}
                {fmtNum(differenceResult.PN)} — divergence{' '}
                {divergence.divergencePct == null ? '—' : divergence.divergencePct.toFixed(1)}%
                {divergence.differs ? ' (exceeds threshold — see warnings)' : ' (within threshold)'}
              </p>
            )}
          </section>

          <section>
            <h2>5. Evaluation</h2>
            {isDetails ? (
              <>
                <div className="preview-table-wrap wp-table">
                  <table>
                    <thead>
                      <tr>
                        <th></th>
                        <th>Overstatement</th>
                        <th>Understatement</th>
                        <th>Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td><strong>Best estimate of misstatement (pre correction, ISA 530)</strong></td>
                        <td>{fmtNum(best.over)}</td>
                        <td>{fmtNum(best.under)}</td>
                        <td>{fmtNum(best.net)}</td>
                      </tr>
                      <tr>
                        <td><strong>Amount carried to the Summary of Uncorrected Misstatements (ISA 450)</strong></td>
                        <td>{fmtNum(toSum.over)}</td>
                        <td>{fmtNum(toSum.under)}</td>
                        <td>{fmtNum(toSum.net)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p>
                  <strong>Tolerable misstatement:</strong> {fmtNum(plan.tolerableMisstatement)} ·
                  best estimate net is{' '}
                  {plan.tolerableMisstatement > 0
                    ? `${((Math.abs(best.net) / plan.tolerableMisstatement) * 100).toFixed(1)}%`
                    : '—'}{' '}
                  of the tolerable limit
                </p>
              </>
            ) : (
              <p>
                <strong>Sample deviation rate:</strong> {fmtRate(deviationRate)} ·{' '}
                <strong>Tolerable rate:</strong> {plan.tolerableDeviationRatePct.toFixed(2)}% ·
                the rate is{' '}
                {plan.tolerableDeviationRatePct > 0 && deviationRate != null
                  ? `${(((deviationRate * 100) / plan.tolerableDeviationRatePct) * 100).toFixed(1)}%`
                  : '—'}{' '}
                of the tolerable rate
              </p>
            )}

            {nilResult && (
              <p className="hint">{isDetails ? NIL_RESULT_NOTE_DETAILS : NIL_RESULT_NOTE_CONTROLS}</p>
            )}

            {hardTriggers.map((t) => (
              <div className="banner error" key={`wp-hard-${t.id}`}>
                {t.text}
              </div>
            ))}
            {warnings.length > 0 && (
              <>
                <h3>Warnings raised and auditor responses</h3>
                <ul>
                  {warnings.map((w) => (
                    <li key={`wp-w-${w.id}`}>
                      {w.text}
                      <div className="screen-only">
                        <input
                          className="wp-inline-input"
                          placeholder="Auditor response (required before the working paper can be marked Final)"
                          value={warningResponses[w.id] ?? ''}
                          disabled={signOff.finalized}
                          onChange={(e) =>
                            setWarningResponses((prev) => ({
                              ...prev,
                              [w.id]: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <em className="print-only">Response: {warningResponses[w.id] || '—'}</em>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {hardTriggers.length > 0 && (
              <>
                <h3>Planned audit response (15.3) — at least one required</h3>
                <div className="screen-only">
                  {PLANNED_RESPONSE_OPTIONS.map((opt) => (
                    <label className="check-row" key={opt}>
                      <input
                        type="checkbox"
                        checked={signOff.plannedResponses.includes(opt)}
                        disabled={signOff.finalized}
                        onChange={(e) =>
                          setSignOff((p) => ({
                            ...p,
                            plannedResponses: e.target.checked
                              ? [...p.plannedResponses, opt]
                              : p.plannedResponses.filter((r) => r !== opt),
                          }))
                        }
                      />
                      <span>{opt}</span>
                    </label>
                  ))}
                </div>
                <ul className="print-only">
                  {signOff.plannedResponses.length === 0 ? (
                    <li>—</li>
                  ) : (
                    signOff.plannedResponses.map((r) => <li key={r}>{r}</li>)
                  )}
                </ul>
              </>
            )}
          </section>

          <section>
            <h2>6. Qualitative evaluation</h2>
            <div className="screen-only">
              <label>Nature and cause of the misstatements or deviations</label>
              <textarea
                rows={2}
                value={qual.natureAndCause}
                disabled={signOff.finalized}
                onChange={(e) => setQual((p) => ({ ...p, natureAndCause: e.target.value }))}
              />
              <label>Systematic or isolated, with reasoning</label>
              <textarea
                rows={2}
                value={qual.systematicOrIsolated}
                disabled={signOff.finalized}
                onChange={(e) => setQual((p) => ({ ...p, systematicOrIsolated: e.target.value }))}
              />
              <div className="form-grid grid-2">
                <div>
                  <label>Effect on other audit areas</label>
                  <input
                    value={qual.effectOnOtherAreas}
                    disabled={signOff.finalized}
                    onChange={(e) => setQual((p) => ({ ...p, effectOnOtherAreas: e.target.value }))}
                  />
                </div>
                <div>
                  <label>Effect on the assessed risk of material misstatement</label>
                  <input
                    value={qual.effectOnRisk}
                    disabled={signOff.finalized}
                    onChange={(e) => setQual((p) => ({ ...p, effectOnRisk: e.target.value }))}
                  />
                </div>
              </div>
              <label>Control deficiency indicated (and severity)</label>
              <input
                value={qual.controlDeficiency}
                disabled={signOff.finalized}
                onChange={(e) => setQual((p) => ({ ...p, controlDeficiency: e.target.value }))}
              />
              {fraudPresent && (
                <>
                  <label>Escalation and ISA 240 response (mandatory — suspected fraud)</label>
                  <textarea
                    rows={2}
                    value={qual.escalationResponse}
                    disabled={signOff.finalized}
                    onChange={(e) => setQual((p) => ({ ...p, escalationResponse: e.target.value }))}
                  />
                </>
              )}
            </div>
            <div className="print-only">
              <p><strong>Nature and cause:</strong> {qual.natureAndCause || '—'}</p>
              <p><strong>Systematic or isolated:</strong> {qual.systematicOrIsolated || '—'}</p>
              <p><strong>Effect on other audit areas:</strong> {qual.effectOnOtherAreas || '—'}</p>
              <p><strong>Effect on assessed risk:</strong> {qual.effectOnRisk || '—'}</p>
              <p><strong>Control deficiency:</strong> {qual.controlDeficiency || '—'}</p>
              {fraudPresent && (
                <p><strong>Escalation and ISA 240 response:</strong> {qual.escalationResponse || '—'}</p>
              )}
            </div>
          </section>

          <section>
            <h2>7. Conclusion and sign off</h2>
            <div className="screen-only">
              <label>Auditor comments</label>
              <textarea
                rows={2}
                value={signOff.auditorComments}
                disabled={signOff.finalized}
                onChange={(e) => setSignOff((p) => ({ ...p, auditorComments: e.target.value }))}
              />
              <label>Final conclusion (auditor)</label>
              <textarea
                rows={3}
                value={signOff.finalConclusion}
                disabled={signOff.finalized}
                onChange={(e) => setSignOff((p) => ({ ...p, finalConclusion: e.target.value }))}
              />
              <div className="form-grid grid-2">
                <div>
                  <label>Prepared by</label>
                  <input
                    value={signOff.preparedBy}
                    disabled={signOff.finalized}
                    onChange={(e) => setSignOff((p) => ({ ...p, preparedBy: e.target.value }))}
                  />
                </div>
                <div>
                  <label>Date</label>
                  <input
                    type="date"
                    value={signOff.preparedDate}
                    disabled={signOff.finalized}
                    onChange={(e) => setSignOff((p) => ({ ...p, preparedDate: e.target.value }))}
                  />
                </div>
                <div>
                  <label>Reviewed by</label>
                  <input
                    value={signOff.reviewedBy}
                    disabled={signOff.finalized}
                    onChange={(e) => setSignOff((p) => ({ ...p, reviewedBy: e.target.value }))}
                  />
                </div>
                <div>
                  <label>Date</label>
                  <input
                    type="date"
                    value={signOff.reviewedDate}
                    disabled={signOff.finalized}
                    onChange={(e) => setSignOff((p) => ({ ...p, reviewedDate: e.target.value }))}
                  />
                </div>
              </div>
            </div>
            <p className="print-only"><strong>Auditor comments:</strong> {signOff.auditorComments || '—'}</p>
            <p className="print-only"><strong>Final conclusion:</strong> {signOff.finalConclusion || '—'}</p>
            <p className="print-only">
              <strong>Prepared by:</strong> {signOff.preparedBy || '\u00A0'} {signOff.preparedDate} ·{' '}
              <strong>Reviewed by:</strong> {signOff.reviewedBy || '\u00A0'} {signOff.reviewedDate}
            </p>
          </section>

          <section>
            <h2>8. Statement of limitation</h2>
            <p>{PROJ_LIMITATION_STATEMENT}</p>
            <p className="hint">
              Configurable parameters applied (Appendix B): Mean per Unit{' '}
              {PROJ_CONFIG.meanPerUnitEnabled ? 'enabled' : 'disabled'}; divergence threshold{' '}
              {PROJ_CONFIG.methodDivergenceThresholdPct}%; best estimate soft trigger{' '}
              {PROJ_CONFIG.bestEstimateSoftTriggerPctOfTolerable}% of tolerable; deviation soft
              trigger {PROJ_CONFIG.deviationRateSoftTriggerPctOfTolerable}% of tolerable rate;
              reconciliation warning {PROJ_CONFIG.reconciliationDifferenceWarnPct}%; minimum
              sample warning (high risk) {PROJ_CONFIG.minSampleSizeWarnHighRisk} items; minimum
              coverage warning (high risk) {PROJ_CONFIG.minValueCoverageWarnPctHighRisk}%; high
              coverage warning {PROJ_CONFIG.highCoverageEfficiencyWarnPct}%.
            </p>
          </section>
        </article>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Screen 1: Inputs — one simple step at a time (like Sampling)
  // -------------------------------------------------------------------------

  const qualityItems: Array<[keyof QualityBlock, string]> = [
    ['noItemExceedsTolerable', 'No item exceeds tolerable misstatement'],
    ['noNegativeBalances', 'No negative / credit balances'],
    ['noZeroValueItems', 'No zero-value items'],
    ['homogeneous', 'Population is reasonably homogeneous'],
  ]

  return (
    <div className="workspace-layout proj-layout">
      <aside className="progress-rail" aria-label="Projection steps">
        <p className="rail-title">Your steps</p>
        <p className="next-hint">
          Fill required fields only. Client name and narratives go on the working paper.
        </p>
        <ol className="rail-list">
          {PROJ_STEPS.map((s, index) => {
            const unlocked = stepUnlocked(s.id)
            const done = stepDone[s.id]
            const active = step === s.id
            return (
              <li key={s.id}>
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
                  onClick={() => setStep(s.id)}
                >
                  <span className="rail-num">{done && !active ? '✓' : index + 1}</span>
                  <span>
                    <strong>{s.title}</strong>
                    <em>{s.blurb}</em>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </aside>

      <main className="workspace-main proj-main">
        <p className="proj-legend hint">
          <span className="proj-badge proj-badge-req">Required</span> must be filled to continue ·{' '}
          <span className="proj-badge proj-badge-opt">Optional</span> can be skipped
        </p>

        {step === 'setup' && (
          <section className="ws-card is-active">
            <div className="ws-card-head">
              <div>
                <p className="section-kicker">Step 1</p>
                <h2>What are you testing?</h2>
                <p className="section-lead">
                  Four choices. Everything else (client, period, WP ref) is filled on the working paper.
                </p>
              </div>
            </div>
            <div className="form-grid grid-2">
              <div>
                <FieldLabel required>Test type</FieldLabel>
                <select
                  value={eng.testType}
                  onChange={(e) => {
                    const tt = e.target.value as ProjTestType
                    setEng((p) => ({ ...p, testType: tt }))
                    setMethod(tt === 'controls' ? 'deviationRate' : '')
                  }}
                >
                  <option value="details">Test of details</option>
                  <option value="controls">Test of controls</option>
                </select>
              </div>
              <div>
                <FieldLabel required>Assertion</FieldLabel>
                <select
                  value={eng.assertion}
                  onChange={(e) => setEng((p) => ({ ...p, assertion: e.target.value }))}
                >
                  {PROJ_ASSERTIONS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel required>Direction</FieldLabel>
                <select
                  value={eng.direction}
                  onChange={(e) =>
                    setEng((p) => ({ ...p, direction: e.target.value as ProjDirection }))
                  }
                >
                  <option>Overstatement</option>
                  <option>Understatement</option>
                  <option>Both</option>
                </select>
              </div>
              <div>
                <FieldLabel required>Currency</FieldLabel>
                <select
                  value={eng.currency}
                  onChange={(e) => setEng((p) => ({ ...p, currency: e.target.value }))}
                >
                  {PROJ_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {stepActions()}
          </section>
        )}

        {step === 'population' && (
          <section className="ws-card is-active">
            <div className="ws-card-head">
              <div>
                <p className="section-kicker">Step 2</p>
                <h2>Population</h2>
                <p className="section-lead">
                  Enter the total population. Residual is calculated automatically.
                </p>
              </div>
            </div>

            <div className="form-grid grid-2">
              <div>
                <FieldLabel required>Total population value</FieldLabel>
                <NumberTextInput
                  integer={false}
                  value={comp.totalValue}
                  onValueChange={(v) => setComp((p) => ({ ...p, totalValue: v }))}
                />
              </div>
              <div>
                <FieldLabel required>Total item count</FieldLabel>
                <NumberTextInput
                  value={comp.totalCount}
                  onValueChange={(v) => setComp((p) => ({ ...p, totalCount: v }))}
                />
              </div>
            </div>

            <div className="stat-grid">
              <div>
                <span>Residual value (projected)</span>
                <strong>{fmtNum(residualValue)}</strong>
              </div>
              <div>
                <span>Residual count</span>
                <strong>{residualCount}</strong>
              </div>
            </div>

            <button
              type="button"
              className="ghost proj-toggle-btn"
              onClick={() => setShowExtraBuckets((v) => !v)}
            >
              {showExtraBuckets || hasExtraBuckets
                ? 'Hide 100% / specific items'
                : '+ Add 100% tested or specifically selected items (optional)'}
            </button>

            {(showExtraBuckets || hasExtraBuckets) && (
              <div className="form-grid grid-2 proj-optional-panel">
                <div>
                  <FieldLabel optional>Value tested 100%</FieldLabel>
                  <NumberTextInput
                    integer={false}
                    value={comp.tested100Value}
                    onValueChange={(v) => setComp((p) => ({ ...p, tested100Value: v }))}
                  />
                </div>
                <div>
                  <FieldLabel optional>Count tested 100%</FieldLabel>
                  <NumberTextInput
                    value={comp.tested100Count}
                    onValueChange={(v) => setComp((p) => ({ ...p, tested100Count: v }))}
                  />
                </div>
                <div>
                  <FieldLabel optional>Value specifically selected</FieldLabel>
                  <NumberTextInput
                    integer={false}
                    value={comp.specificValue}
                    onValueChange={(v) => setComp((p) => ({ ...p, specificValue: v }))}
                  />
                </div>
                <div>
                  <FieldLabel optional>Count specifically selected</FieldLabel>
                  <NumberTextInput
                    value={comp.specificCount}
                    onValueChange={(v) => setComp((p) => ({ ...p, specificCount: v }))}
                  />
                </div>
              </div>
            )}

            {(residualValue < 0 || residualCount < 0) && (
              <div className="banner error">
                100% tested + specifically selected items exceed the total population.
              </div>
            )}

            <h3 className="proj-subhead">Quick checks (required)</h3>
            <p className="hint">Answer Yes or No for each. Notes are optional.</p>
            {qualityItems.map(([key, label]) => (
              <div className="proj-quality-simple" key={key}>
                <span className="proj-quality-label">{label}</span>
                <div className="proj-yesno">
                  <button
                    type="button"
                    className={quality[key].answer === 'yes' ? 'is-on' : ''}
                    onClick={() =>
                      setQuality((p) => ({
                        ...p,
                        [key]: { ...p[key], answer: 'yes' },
                      }))
                    }
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    className={quality[key].answer === 'no' ? 'is-on' : ''}
                    onClick={() =>
                      setQuality((p) => ({
                        ...p,
                        [key]: { ...p[key], answer: 'no' },
                      }))
                    }
                  >
                    No
                  </button>
                </div>
              </div>
            ))}

            <h3 className="proj-subhead">Reconciliation (optional)</h3>
            <div className="form-grid grid-2">
              <div>
                <FieldLabel optional>Value per listing</FieldLabel>
                <NumberTextInput
                  integer={false}
                  value={recon.valuePerListing}
                  onValueChange={(v) => setRecon((p) => ({ ...p, valuePerListing: v }))}
                />
              </div>
              <div>
                <FieldLabel optional>Value per GL / FS</FieldLabel>
                <NumberTextInput
                  integer={false}
                  value={recon.valuePerGL}
                  onValueChange={(v) => setRecon((p) => ({ ...p, valuePerGL: v }))}
                />
              </div>
            </div>
            {reconDifference !== 0 && (
              <>
                <FieldLabel required>Explain difference ({fmtNum(reconDifference)})</FieldLabel>
                <textarea
                  rows={2}
                  value={recon.explanation}
                  onChange={(e) => setRecon((p) => ({ ...p, explanation: e.target.value }))}
                />
              </>
            )}

            {stepActions({
              nextDisabled:
                !stepDone.population ||
                (reconDifference !== 0 && !recon.explanation.trim()),
            })}
          </section>
        )}

        {step === 'planning' && (
          <section className="ws-card is-active">
            <div className="ws-card-head">
              <div>
                <p className="section-kicker">Step 3</p>
                <h2>Planning</h2>
                <p className="section-lead">Only the numbers that drive evaluation.</p>
              </div>
            </div>

            <div className="form-grid grid-2">
              <div>
                <FieldLabel required>Assessed risk</FieldLabel>
                <select
                  value={plan.assessedRisk}
                  onChange={(e) =>
                    setPlan((p) => ({ ...p, assessedRisk: e.target.value as ProjRisk }))
                  }
                >
                  <option>Low</option>
                  <option>Moderate</option>
                  <option>High</option>
                  <option>Significant</option>
                </select>
              </div>
              <div>
                <FieldLabel required>Selection method</FieldLabel>
                <select
                  value={plan.selectionMethod}
                  onChange={(e) =>
                    setPlan((p) => ({
                      ...p,
                      selectionMethod: e.target.value as ProjSelectionMethod,
                    }))
                  }
                >
                  {(Object.keys(SELECTION_METHOD_LABELS) as ProjSelectionMethod[]).map((m) => (
                    <option key={m} value={m}>
                      {SELECTION_METHOD_LABELS[m]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {isDetails ? (
              <div className="form-grid grid-2">
                <div>
                  <FieldLabel required>Tolerable misstatement</FieldLabel>
                  <NumberTextInput
                    integer={false}
                    value={plan.tolerableMisstatement}
                    max={
                      plan.performanceMateriality > 0
                        ? plan.performanceMateriality
                        : undefined
                    }
                    onValueChange={(v) => setPlan((p) => ({ ...p, tolerableMisstatement: v }))}
                  />
                </div>
                <div>
                  <FieldLabel required>Offsetting over/under OK?</FieldLabel>
                  <select
                    value={plan.offsettingAppropriate}
                    onChange={(e) =>
                      setPlan((p) => ({
                        ...p,
                        offsettingAppropriate: e.target.value as YesNo,
                      }))
                    }
                  >
                    <option value="">— choose —</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </div>
              </div>
            ) : (
              <div className="form-grid grid-2">
                <div>
                  <FieldLabel required>Tolerable deviation rate (%)</FieldLabel>
                  <NumberTextInput
                    integer={false}
                    max={100}
                    value={plan.tolerableDeviationRatePct}
                    onValueChange={(v) =>
                      setPlan((p) => ({ ...p, tolerableDeviationRatePct: v }))
                    }
                  />
                </div>
              </div>
            )}

            <button
              type="button"
              className="ghost proj-toggle-btn"
              onClick={() => setShowMorePlanning((v) => !v)}
            >
              {showMorePlanning ? 'Hide optional planning fields' : '+ More planning fields (optional)'}
            </button>

            {showMorePlanning && (
              <div className="form-grid grid-2 proj-optional-panel">
                <div>
                  <FieldLabel optional>Reliance on controls</FieldLabel>
                  <select
                    value={plan.reliance}
                    onChange={(e) =>
                      setPlan((p) => ({ ...p, reliance: e.target.value as ProjReliance }))
                    }
                  >
                    <option>None</option>
                    <option>Partial</option>
                    <option>Full</option>
                  </select>
                </div>
                <div>
                  <FieldLabel optional>Sample size basis</FieldLabel>
                  <select
                    value={plan.sampleSizeBasis}
                    onChange={(e) =>
                      setPlan((p) => ({
                        ...p,
                        sampleSizeBasis: e.target.value as ProjSampleSizeBasis,
                      }))
                    }
                  >
                    <option>Firm sampling table</option>
                    <option>Firm formula</option>
                    <option>Professional judgement</option>
                  </select>
                </div>
                {isDetails ? (
                  <>
                    <div>
                      <FieldLabel optional>Performance materiality</FieldLabel>
                      <NumberTextInput
                        integer={false}
                        value={plan.performanceMateriality}
                        onValueChange={(v) =>
                          setPlan((p) => ({ ...p, performanceMateriality: v }))
                        }
                      />
                    </div>
                    <div>
                      <FieldLabel optional>Expected misstatement</FieldLabel>
                      <NumberTextInput
                        integer={false}
                        value={plan.expectedMisstatement}
                        onValueChange={(v) =>
                          setPlan((p) => ({ ...p, expectedMisstatement: v }))
                        }
                      />
                    </div>
                  </>
                ) : (
                  <div>
                    <FieldLabel optional>Expected deviation rate (%)</FieldLabel>
                    <NumberTextInput
                      integer={false}
                      max={100}
                      value={plan.expectedDeviationRatePct}
                      onValueChange={(v) =>
                        setPlan((p) => ({ ...p, expectedDeviationRatePct: v }))
                      }
                    />
                  </div>
                )}
              </div>
            )}

            {isDetails &&
              plan.performanceMateriality > 0 &&
              plan.tolerableMisstatement > plan.performanceMateriality && (
                <div className="banner error">
                  Tolerable misstatement may not exceed performance materiality.
                </div>
              )}

            {stepActions()}
          </section>
        )}

        {step === 'sample' && (
          <section className="ws-card is-active">
            <div className="ws-card-head">
              <div>
                <p className="section-kicker">Step 4</p>
                <h2>Sample</h2>
                <p className="section-lead">How many items you tested from the residual population.</p>
              </div>
            </div>

            <div className="form-grid grid-2">
              <div>
                <FieldLabel required>Sample item count</FieldLabel>
                <NumberTextInput
                  value={sample.itemCount}
                  onValueChange={(v) => setSample((p) => ({ ...p, itemCount: v }))}
                />
              </div>
              {isDetails && (
                <div>
                  <FieldLabel required>Sample recorded value</FieldLabel>
                  <NumberTextInput
                    integer={false}
                    value={sample.recordedValue}
                    onValueChange={(v) => setSample((p) => ({ ...p, recordedValue: v }))}
                  />
                </div>
              )}
            </div>

            <label className="check-row">
              <input
                type="checkbox"
                checked={sample.drawnFromResidualConfirmed}
                onChange={(e) =>
                  setSample((p) => ({ ...p, drawnFromResidualConfirmed: e.target.checked }))
                }
              />
              <span>
                Sample drawn only from residual population{' '}
                <span className="proj-badge proj-badge-req">Required</span>
              </span>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={sample.sameBasisConfirmed}
                onChange={(e) =>
                  setSample((p) => ({ ...p, sameBasisConfirmed: e.target.checked }))
                }
              />
              <span>
                Same basis (currency / period / recorded values){' '}
                <span className="proj-badge proj-badge-req">Required</span>
              </span>
            </label>

            {stepActions()}
          </section>
        )}

        {step === 'register' && (
          <section className="ws-card is-active">
            <div className="ws-card-head">
              <div>
                <p className="section-kicker">Step 5</p>
                <h2>{isDetails ? 'Misstatements found' : 'Deviations found'}</h2>
                <p className="section-lead">
                  Optional — skip if none. Add a row only when you found something.
                </p>
              </div>
            </div>

            {isDetails ? (
              <>
                <div className="preview-table-wrap preview-table-all">
                  <table className="proj-register">
                    <thead>
                      <tr>
                        <th>Ref</th>
                        <th>Bucket</th>
                        <th>Recorded</th>
                        <th>Audited</th>
                        <th>Diff</th>
                        <th>Anomaly</th>
                        <th>Corrected</th>
                        <th>Fraud</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {mEntries.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="hint">
                            No misstatements yet — that is fine.
                          </td>
                        </tr>
                      ) : (
                        mEntries.map((e) => {
                          const d = entryDifference(e)
                          const rows = [
                            <tr key={e.id}>
                              <td>
                                <input
                                  className="proj-cell"
                                  placeholder="Ref"
                                  value={e.itemRef}
                                  onChange={(ev) =>
                                    updateMEntry(e.id, { itemRef: ev.target.value })
                                  }
                                />
                              </td>
                              <td>
                                <select
                                  value={e.bucket}
                                  onChange={(ev) =>
                                    updateMEntry(e.id, {
                                      bucket: ev.target.value as RegisterBucket,
                                    })
                                  }
                                >
                                  {(Object.keys(BUCKET_LABELS) as RegisterBucket[]).map((b) => (
                                    <option key={b} value={b}>
                                      {BUCKET_LABELS[b]}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td>
                                <NumberTextInput
                                  className="proj-cell"
                                  integer={false}
                                  value={e.recordedValue}
                                  onValueChange={(v) =>
                                    updateMEntry(e.id, { recordedValue: v })
                                  }
                                />
                              </td>
                              <td>
                                <NumberTextInput
                                  className="proj-cell"
                                  integer={false}
                                  value={e.auditedValue}
                                  onValueChange={(v) =>
                                    updateMEntry(e.id, { auditedValue: v })
                                  }
                                />
                              </td>
                              <td className={d >= 0 ? '' : 'proj-under'}>
                                {fmtNum(d)}
                              </td>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={e.anomalyFlagged}
                                  onChange={(ev) => {
                                    updateMEntry(e.id, { anomalyFlagged: ev.target.checked })
                                    setOpenAnomalyId(ev.target.checked ? e.id : null)
                                  }}
                                />
                              </td>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={e.correctedByManagement}
                                  onChange={(ev) =>
                                    updateMEntry(e.id, {
                                      correctedByManagement: ev.target.checked,
                                    })
                                  }
                                />
                              </td>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={e.fraudIndicator}
                                  onChange={(ev) =>
                                    updateMEntry(e.id, { fraudIndicator: ev.target.checked })
                                  }
                                />
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="small-btn"
                                  onClick={() =>
                                    setMEntries((prev) => prev.filter((x) => x.id !== e.id))
                                  }
                                >
                                  Remove
                                </button>
                                {e.anomalyFlagged && (
                                  <button
                                    type="button"
                                    className="small-btn"
                                    onClick={() =>
                                      setOpenAnomalyId(openAnomalyId === e.id ? null : e.id)
                                    }
                                  >
                                    {openAnomalyId === e.id ? 'Hide' : 'Justify'}
                                  </button>
                                )}
                              </td>
                            </tr>,
                          ]
                          if (e.anomalyFlagged && openAnomalyId === e.id) {
                            rows.push(anomalyEditor(e, 'm'))
                          }
                          return rows
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setMEntries((prev) => [...prev, newMisstatementEntry()])}
                  >
                    + Add misstatement
                  </button>
                </div>
                {mEntries.length > 0 && (
                  <div className="stat-grid">
                    <div>
                      <span>Gross over</span>
                      <strong>{fmtNum(agg.GO)}</strong>
                    </div>
                    <div>
                      <span>Gross under</span>
                      <strong>{fmtNum(agg.GU)}</strong>
                    </div>
                    <div>
                      <span>Representative net</span>
                      <strong>{fmtNum(agg.RN)}</strong>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="preview-table-wrap preview-table-all">
                  <table className="proj-register">
                    <thead>
                      <tr>
                        <th>Ref</th>
                        <th>Bucket</th>
                        <th>Nature</th>
                        <th>Anomaly</th>
                        <th>Fraud</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {dEntries.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="hint">
                            No deviations yet — that is fine.
                          </td>
                        </tr>
                      ) : (
                        dEntries.map((e) => {
                          const rows = [
                            <tr key={e.id}>
                              <td>
                                <input
                                  className="proj-cell"
                                  value={e.itemRef}
                                  onChange={(ev) =>
                                    updateDEntry(e.id, { itemRef: ev.target.value })
                                  }
                                />
                              </td>
                              <td>
                                <select
                                  value={e.bucket}
                                  onChange={(ev) =>
                                    updateDEntry(e.id, {
                                      bucket: ev.target.value as RegisterBucket,
                                    })
                                  }
                                >
                                  {(Object.keys(BUCKET_LABELS) as RegisterBucket[]).map((b) => (
                                    <option key={b} value={b}>
                                      {BUCKET_LABELS[b]}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td>
                                <input
                                  className="proj-cell"
                                  value={e.natureOfDeviation}
                                  onChange={(ev) =>
                                    updateDEntry(e.id, {
                                      natureOfDeviation: ev.target.value,
                                    })
                                  }
                                />
                              </td>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={e.anomalyFlagged}
                                  onChange={(ev) => {
                                    updateDEntry(e.id, { anomalyFlagged: ev.target.checked })
                                    setOpenAnomalyId(ev.target.checked ? e.id : null)
                                  }}
                                />
                              </td>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={e.fraudIndicator}
                                  onChange={(ev) =>
                                    updateDEntry(e.id, { fraudIndicator: ev.target.checked })
                                  }
                                />
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="small-btn"
                                  onClick={() =>
                                    setDEntries((prev) => prev.filter((x) => x.id !== e.id))
                                  }
                                >
                                  Remove
                                </button>
                                {e.anomalyFlagged && (
                                  <button
                                    type="button"
                                    className="small-btn"
                                    onClick={() =>
                                      setOpenAnomalyId(openAnomalyId === e.id ? null : e.id)
                                    }
                                  >
                                    {openAnomalyId === e.id ? 'Hide' : 'Justify'}
                                  </button>
                                )}
                              </td>
                            </tr>,
                          ]
                          if (e.anomalyFlagged && openAnomalyId === e.id) {
                            rows.push(anomalyEditor(e, 'd'))
                          }
                          return rows
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setDEntries((prev) => [...prev, newDeviationEntry()])}
                  >
                    + Add deviation
                  </button>
                </div>
              </>
            )}

            <label className="check-row">
              <input
                type="checkbox"
                checked={qual.fraudIndicator}
                onChange={(e) => setQual((p) => ({ ...p, fraudIndicator: e.target.checked }))}
              />
              <span>
                Fraud indicator at population level{' '}
                <span className="proj-badge proj-badge-opt">Optional</span>
              </span>
            </label>
            {fraudPresent && (
              <div className="banner error">
                Suspected fraud identified. Complete the ISA 240 response on the working paper
                before marking Final.
              </div>
            )}

            {stepActions({ nextDisabled: false, nextLabel: 'Continue' })}
          </section>
        )}

        {step === 'method' && (
          <section className="ws-card is-active">
            <div className="ws-card-head">
              <div>
                <p className="section-kicker">Step 6</p>
                <h2>Projection method</h2>
                <p className="section-lead">
                  {methodSelectorLocked
                    ? 'Complete earlier steps first.'
                    : 'Pick a method to see projected results.'}
                </p>
              </div>
            </div>

            {isDetails ? (
              <>
                <FieldLabel required>Method</FieldLabel>
                <select
                  value={method}
                  disabled={methodSelectorLocked}
                  onChange={(e) => setMethod(e.target.value as ProjectionMethodId | '')}
                >
                  <option value="">— select —</option>
                  <option value="ratio" disabled={availability.ratio === 'blocked'}>
                    {PROJECTION_METHOD_LABELS.ratio}
                    {availability.ratio === 'warning' ? ' (warning)' : ''}
                  </option>
                  <option
                    value="difference"
                    disabled={availability.difference === 'blocked'}
                  >
                    {PROJECTION_METHOD_LABELS.difference}
                    {availability.difference === 'blocked'
                      ? ' (blocked)'
                      : availability.difference === 'warning'
                        ? ' (warning)'
                        : ''}
                  </option>
                  <option
                    value="meanPerUnit"
                    disabled={
                      availability.meanPerUnit === 'blocked' || mpuGateFailures.length > 0
                    }
                  >
                    {PROJECTION_METHOD_LABELS.meanPerUnit}
                  </option>
                </select>

                {method === 'meanPerUnit' && (
                  <div className="form-grid grid-2" style={{ marginTop: 12 }}>
                    <div>
                      <FieldLabel required>Total audited value of sample</FieldLabel>
                      <NumberTextInput
                        integer={false}
                        value={sample.auditedValueTotal}
                        onValueChange={(v) =>
                          setSample((p) => ({ ...p, auditedValueTotal: v }))
                        }
                      />
                    </div>
                  </div>
                )}

                {method !== '' && method !== 'deviationRate' && (
                  <div className="stat-grid" style={{ marginTop: 14 }}>
                    <div>
                      <span>Projected net</span>
                      <strong>{fmtNum(projection.PN)}</strong>
                    </div>
                    <div>
                      <span>Best estimate (net)</span>
                      <strong>{fmtNum(best.net)}</strong>
                    </div>
                    <div>
                      <span>Amount to SUM (net)</span>
                      <strong>{fmtNum(toSum.net)}</strong>
                    </div>
                    <div>
                      <span>Tolerable</span>
                      <strong>{fmtNum(plan.tolerableMisstatement)}</strong>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="stat-grid">
                <div>
                  <span>Representative deviations</span>
                  <strong>{representativeDeviations}</strong>
                </div>
                <div>
                  <span>Sample items</span>
                  <strong>{sample.itemCount}</strong>
                </div>
                <div>
                  <span>Projected deviation rate</span>
                  <strong>{fmtRate(deviationRate)}</strong>
                </div>
                <div>
                  <span>Tolerable rate</span>
                  <strong>{plan.tolerableDeviationRatePct.toFixed(2)}%</strong>
                </div>
              </div>
            )}

            {hardTriggers.map((t) => (
              <div className="banner error" key={t.id}>
                {t.text}
              </div>
            ))}

            {stepActions({
              nextDisabled: isDetails ? method === '' : false,
            })}
          </section>
        )}

        {step === 'review' && (
          <section className="ws-card is-active">
            <div className="ws-card-head">
              <div>
                <p className="section-kicker">Step 7</p>
                <h2>Generate working paper</h2>
                <p className="section-lead">
                  Fix any hard blocks below. Narratives and client details are completed on the
                  working paper itself.
                </p>
              </div>
            </div>

            {hardBlocks.length > 0 ? (
              <div className="banner error">
                <strong>Fix these before generating:</strong>
                {hardBlocks.map((b) => (
                  <div key={b}>• {b}</div>
                ))}
              </div>
            ) : (
              <div className="banner warn" style={{ borderColor: 'transparent' }}>
                Ready — no hard blocks.
              </div>
            )}

            {warnings.length > 0 && (
              <>
                <h3 className="proj-subhead">Warnings ({warnings.length})</h3>
                <p className="hint">Respond to each on the working paper (required before Final).</p>
                {warnings.map((w) => (
                  <div className="proj-warning" key={w.id}>
                    <div className="banner warn">{w.text}</div>
                  </div>
                ))}
              </>
            )}

            <div className="actions proj-step-actions">
              <button type="button" className="ghost" onClick={goBack}>
                ← Back
              </button>
              <button
                type="button"
                className="primary"
                disabled={!canGenerateWp}
                onClick={() => setScreen('workingPaper')}
              >
                Generate working paper →
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
