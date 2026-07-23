/**
 * ISA 530 Projection and Evaluation Module — calculation and validation library.
 * Implements the "ISA 530 Projection and Evaluation Module: Software Brief v2".
 *
 * Non-statistical premise: every figure produced here is a point estimate.
 * No allowance for sampling risk is computed anywhere in this module.
 */

export type ProjTestType = 'details' | 'controls'
export type ProjDirection = 'Overstatement' | 'Understatement' | 'Both'
export type ProjRisk = 'Low' | 'Moderate' | 'High' | 'Significant'
export type ProjReliance = 'None' | 'Partial' | 'Full'
export type ProjSampleSizeBasis =
  | 'Firm sampling table'
  | 'Firm formula'
  | 'Professional judgement'

export type ProjSelectionMethod =
  | 'random'
  | 'systematicRandomStart'
  | 'monetaryUnit'
  | 'haphazard'
  | 'block'

export type ProjectionMethodId = 'ratio' | 'difference' | 'meanPerUnit' | 'deviationRate'

export type RegisterBucket = 'residualSample' | 'tested100' | 'specific'

export type MethodAvailability = 'available' | 'warning' | 'blocked'

export const PROJ_ASSERTIONS = [
  'Existence',
  'Occurrence',
  'Completeness',
  'Accuracy',
  'Valuation',
  'Cut off',
  'Rights and obligations',
  'Classification',
] as const

export const PROJ_CURRENCIES = ['PKR', 'USD', 'EUR', 'GBP', 'AED', 'SAR'] as const

export const SELECTION_METHOD_LABELS: Record<ProjSelectionMethod, string> = {
  random: 'Random',
  systematicRandomStart: 'Systematic with random start',
  monetaryUnit: 'Monetary unit / value weighted',
  haphazard: 'Haphazard',
  block: 'Block',
}

export const PROJECTION_METHOD_LABELS: Record<ProjectionMethodId, string> = {
  ratio: 'Method 1 — Ratio projection',
  difference: 'Method 2 — Difference projection (average misstatement per item)',
  meanPerUnit: 'Method 3 — Mean per Unit projection (restricted)',
  deviationRate: 'Method 4 — Rate of deviation (tests of controls)',
}

/** Appendix B — configurable parameters (firm level). */
export const PROJ_CONFIG = {
  meanPerUnitEnabled: false,
  meanPerUnitToleranceBandPct: 25,
  meanPerUnitMinSampleSize: 30,
  methodDivergenceThresholdPct: 25,
  bestEstimateSoftTriggerPctOfTolerable: 65,
  deviationRateSoftTriggerPctOfTolerable: 50,
  reconciliationDifferenceWarnPct: 0.5,
  minSampleSizeWarnHighRisk: 25,
  minValueCoverageWarnPctHighRisk: 2,
  highCoverageEfficiencyWarnPct: 25,
  anomalyProceduresMinLength: 30,
} as const

/** 17.8 — printed on every working paper. */
export const PROJ_LIMITATION_STATEMENT =
  'This working paper records a non statistical projection. Sampling risk has not been ' +
  'measured and no allowance for sampling risk is included in any figure shown. The ' +
  'projected misstatement is a point estimate. Actual misstatement in the population may ' +
  'be higher or lower.'

// ---------------------------------------------------------------------------
// Register entries
// ---------------------------------------------------------------------------

export interface AnomalyJustification {
  proceduresPerformed: string
  basisForCertainty: string
  evidenceReference: string
  preparerName: string
  preparerDate: string
  reviewerName: string
  reviewerDate: string
}

export function emptyAnomalyJustification(): AnomalyJustification {
  return {
    proceduresPerformed: '',
    basisForCertainty: '',
    evidenceReference: '',
    preparerName: '',
    preparerDate: '',
    reviewerName: '',
    reviewerDate: '',
  }
}

export interface MisstatementEntry {
  id: string
  itemRef: string
  bucket: RegisterBucket
  recordedValue: number
  auditedValue: number
  correctedByManagement: boolean
  fraudIndicator: boolean
  anomalyFlagged: boolean
  anomaly: AnomalyJustification
  description: string
}

export interface DeviationEntry {
  id: string
  itemRef: string
  bucket: RegisterBucket
  natureOfDeviation: string
  fraudIndicator: boolean
  anomalyFlagged: boolean
  anomaly: AnomalyJustification
}

/** Difference: positive = overstatement, negative = understatement (8.1). */
export function entryDifference(e: MisstatementEntry): number {
  return e.recordedValue - e.auditedValue
}

/**
 * Block F gate (Section 9): the anomaly flag has NO effect on any calculation
 * until the justification is complete and reviewer approval is recorded.
 * A fraud item may never be an approved anomaly (9.1 hard block).
 */
export function isAnomalyApproved(e: {
  anomalyFlagged: boolean
  fraudIndicator: boolean
  anomaly: AnomalyJustification
}): boolean {
  if (!e.anomalyFlagged || e.fraudIndicator) return false
  const a = e.anomaly
  return (
    a.proceduresPerformed.trim().length >= PROJ_CONFIG.anomalyProceduresMinLength &&
    a.basisForCertainty.trim().length > 0 &&
    a.evidenceReference.trim().length > 0 &&
    a.preparerName.trim().length > 0 &&
    a.preparerDate.trim().length > 0 &&
    a.reviewerName.trim().length > 0 &&
    a.reviewerDate.trim().length > 0
  )
}

/** Justification incomplete while the flag is set (14.1 rule 9). */
export function anomalyFlaggedButNotApproved(e: {
  anomalyFlagged: boolean
  fraudIndicator: boolean
  anomaly: AnomalyJustification
}): boolean {
  return e.anomalyFlagged && !e.fraudIndicator && !isAnomalyApproved(e)
}

// ---------------------------------------------------------------------------
// Sample aggregates (8.3)
// ---------------------------------------------------------------------------

export interface DetailsAggregates {
  /** Gross sample (residual sample bucket only) */
  GO: number
  GU: number
  NSM: number
  /** Approved anomalous within the sample */
  AO: number
  AU: number
  AN: number
  /** Representative within the sample */
  RO: number
  RU: number
  RN: number
  /** Factual — tested 100% and specifically selected buckets combined */
  FO: number
  FU: number
  FN: number
  /** Corrected amounts (as found values of corrected items) */
  correctedFactualOver: number
  correctedFactualUnder: number
  correctedFactualNet: number
  correctedAnomalousOver: number
  correctedAnomalousUnder: number
  correctedAnomalousNet: number
  /** Counts */
  sampleMisstatementCount: number
  approvedAnomalyCount: number
  flaggedAnomalyCount: number
  factualMisstatementCount: number
  allCorrected: boolean
}

export function computeDetailsAggregates(entries: MisstatementEntry[]): DetailsAggregates {
  let GO = 0
  let GU = 0
  let AO = 0
  let AU = 0
  let FO = 0
  let FU = 0
  let correctedFactualOver = 0
  let correctedFactualUnder = 0
  let correctedAnomalousOver = 0
  let correctedAnomalousUnder = 0
  let sampleMisstatementCount = 0
  let approvedAnomalyCount = 0
  let flaggedAnomalyCount = 0
  let factualMisstatementCount = 0
  let anyUncorrected = false
  let anyEntry = false

  for (const e of entries) {
    const d = entryDifference(e)
    if (d === 0) continue
    anyEntry = true
    if (!e.correctedByManagement) anyUncorrected = true

    if (e.bucket === 'residualSample') {
      sampleMisstatementCount += 1
      if (e.anomalyFlagged) flaggedAnomalyCount += 1
      if (d > 0) GO += d
      else GU += Math.abs(d)
      if (isAnomalyApproved(e)) {
        approvedAnomalyCount += 1
        if (d > 0) AO += d
        else AU += Math.abs(d)
        if (e.correctedByManagement) {
          if (d > 0) correctedAnomalousOver += d
          else correctedAnomalousUnder += Math.abs(d)
        }
      }
    } else {
      factualMisstatementCount += 1
      if (d > 0) FO += d
      else FU += Math.abs(d)
      if (e.correctedByManagement) {
        if (d > 0) correctedFactualOver += d
        else correctedFactualUnder += Math.abs(d)
      }
    }
  }

  const RO = GO - AO
  const RU = GU - AU
  return {
    GO,
    GU,
    NSM: GO - GU,
    AO,
    AU,
    AN: AO - AU,
    RO,
    RU,
    RN: RO - RU,
    FO,
    FU,
    FN: FO - FU,
    correctedFactualOver,
    correctedFactualUnder,
    correctedFactualNet: correctedFactualOver - correctedFactualUnder,
    correctedAnomalousOver,
    correctedAnomalousUnder,
    correctedAnomalousNet: correctedAnomalousOver - correctedAnomalousUnder,
    sampleMisstatementCount,
    approvedAnomalyCount,
    flaggedAnomalyCount,
    factualMisstatementCount,
    allCorrected: anyEntry && !anyUncorrected,
  }
}

// ---------------------------------------------------------------------------
// Projection methods (Section 11)
// ---------------------------------------------------------------------------

export interface ProjectionAmounts {
  factor: number | null
  PO: number
  PU: number
  PN: number
}

/** Method 1 — Ratio projection (11.1). */
export function ratioProjection(params: {
  residualValue: number
  sampleRecordedValue: number
  RO: number
  RU: number
}): ProjectionAmounts {
  const { residualValue, sampleRecordedValue, RO, RU } = params
  if (sampleRecordedValue <= 0) return { factor: null, PO: 0, PU: 0, PN: 0 }
  const k = residualValue / sampleRecordedValue
  const PO = RO * k
  const PU = RU * k
  return { factor: k, PO, PU, PN: PO - PU }
}

/** Method 2 — Difference projection (11.2). */
export function differenceProjection(params: {
  residualCount: number
  sampleCount: number
  RO: number
  RU: number
}): ProjectionAmounts {
  const { residualCount, sampleCount, RO, RU } = params
  if (sampleCount <= 0) return { factor: null, PO: 0, PU: 0, PN: 0 }
  const m = residualCount / sampleCount
  const PO = (RO / 1) * m
  const PU = (RU / 1) * m
  return { factor: m, PO, PU, PN: PO - PU }
}

/** 11.3 — method divergence check between ratio and difference nets. */
export function methodDivergence(
  ratioNet: number,
  differenceNet: number,
  thresholdPct: number = PROJ_CONFIG.methodDivergenceThresholdPct,
): { differs: boolean; divergencePct: number | null } {
  const higher = Math.max(Math.abs(ratioNet), Math.abs(differenceNet))
  if (higher === 0) return { differs: false, divergencePct: 0 }
  const divergencePct = (Math.abs(ratioNet - differenceNet) / higher) * 100
  return { differs: divergencePct > thresholdPct, divergencePct }
}

/** Method 3 eligibility gates (11.4). Returns a list of failures (empty = pass). */
export function meanPerUnitGateFailures(params: {
  enabled: boolean
  selectionMethod: ProjSelectionMethod
  sampleCount: number
  sampleRecordedValue: number
  residualValue: number
  residualCount: number
  negativesOrZerosConfirmedAbsent: boolean
}): string[] {
  const failures: string[] = []
  if (!params.enabled) {
    failures.push('Mean per Unit is disabled in the firm configuration (Appendix B).')
  }
  if (
    params.selectionMethod !== 'random' &&
    params.selectionMethod !== 'systematicRandomStart'
  ) {
    failures.push(
      'Selection basis gate: Mean per Unit requires Random or Systematic with random start selection.',
    )
  }
  if (params.sampleCount < PROJ_CONFIG.meanPerUnitMinSampleSize) {
    failures.push(
      `Minimum sample size gate: at least ${PROJ_CONFIG.meanPerUnitMinSampleSize} items are required.`,
    )
  }
  if (params.sampleCount > 0 && params.residualCount > 0) {
    const sampleMean = params.sampleRecordedValue / params.sampleCount
    const popMean = params.residualValue / params.residualCount
    if (popMean > 0) {
      const band = PROJ_CONFIG.meanPerUnitToleranceBandPct / 100
      if (sampleMean < popMean * (1 - band) || sampleMean > popMean * (1 + band)) {
        failures.push(
          `Representativeness gate: the sample mean recorded value must be within ±${PROJ_CONFIG.meanPerUnitToleranceBandPct}% of the residual population mean.`,
        )
      }
    }
  }
  if (!params.negativesOrZerosConfirmedAbsent) {
    failures.push(
      'Population balances gate: the residual population must contain no negative or zero balances (Block B confirmations).',
    )
  }
  return failures
}

/** Method 3 — Mean per Unit projection (11.4). */
export function meanPerUnitProjection(params: {
  residualValue: number
  residualCount: number
  sampleCount: number
  sampleAuditedTotal: number
  entries: MisstatementEntry[]
}): { meanAuditedValue: number | null; estimatedValue: number; PN: number } {
  const approvedAnomalies = params.entries.filter(
    (e) => e.bucket === 'residualSample' && isAnomalyApproved(e),
  )
  const nPrime = params.sampleCount - approvedAnomalies.length
  const aPrime =
    params.sampleAuditedTotal -
    approvedAnomalies.reduce((sum, e) => sum + e.auditedValue, 0)
  if (nPrime <= 0) return { meanAuditedValue: null, estimatedValue: 0, PN: 0 }
  const mean = aPrime / nPrime
  const EV = mean * params.residualCount
  return { meanAuditedValue: mean, estimatedValue: EV, PN: params.residualValue - EV }
}

/** Method 4 — one figure only (11.5): the sample deviation rate IS the projected rate. */
export function deviationRateProjection(params: {
  sampleCount: number
  representativeDeviations: number
}): number | null {
  if (params.sampleCount <= 0) return null
  return params.representativeDeviations / params.sampleCount
}

/** 11.6 — method availability matrix. */
export function methodAvailabilityFor(
  selection: ProjSelectionMethod,
): Record<ProjectionMethodId, MethodAvailability> {
  switch (selection) {
    case 'random':
    case 'systematicRandomStart':
      return {
        ratio: 'available',
        difference: 'available',
        meanPerUnit: 'available',
        deviationRate: 'available',
      }
    case 'monetaryUnit':
      return {
        ratio: 'warning',
        difference: 'blocked',
        meanPerUnit: 'blocked',
        deviationRate: 'available',
      }
    case 'haphazard':
      return {
        ratio: 'warning',
        difference: 'warning',
        meanPerUnit: 'blocked',
        deviationRate: 'available',
      }
    case 'block':
      return {
        ratio: 'warning',
        difference: 'warning',
        meanPerUnit: 'blocked',
        deviationRate: 'warning',
      }
  }
}

// ---------------------------------------------------------------------------
// The two output totals (Section 13)
// ---------------------------------------------------------------------------

export interface EvaluationTotals {
  over: number
  under: number
  net: number
}

/** 13.2 — Total One: best estimate, before any management correction. */
export function bestEstimate(agg: DetailsAggregates, proj: ProjectionAmounts): EvaluationTotals {
  return {
    over: agg.FO + proj.PO + agg.AO,
    under: agg.FU + proj.PU + agg.AU,
    net: agg.FN + proj.PN + agg.AN,
  }
}

/**
 * 13.3 — Total Two: amount carried to the Summary of Uncorrected Misstatements.
 * After correction, but the projected component is never reduced.
 */
export function amountToSum(agg: DetailsAggregates, proj: ProjectionAmounts): EvaluationTotals {
  return {
    over: agg.FO - agg.correctedFactualOver + proj.PO + (agg.AO - agg.correctedAnomalousOver),
    under: agg.FU - agg.correctedFactualUnder + proj.PU + (agg.AU - agg.correctedAnomalousUnder),
    net: agg.FN - agg.correctedFactualNet + proj.PN + (agg.AN - agg.correctedAnomalousNet),
  }
}

// ---------------------------------------------------------------------------
// Presentation (Section 18)
// ---------------------------------------------------------------------------

/** Rounded away from zero so rounding can never convert a fail into a pass. */
export function roundAwayFromZero(value: number, unit = 1): number {
  if (unit <= 0) return value
  const scaled = Math.abs(value) / unit
  return Math.sign(value) * Math.ceil(scaled - 1e-9) * unit
}

// ---------------------------------------------------------------------------
// Evaluation against the tolerable limit (Section 15)
// ---------------------------------------------------------------------------

export interface EvaluationTrigger {
  id: string
  severity: 'hard' | 'soft'
  text: string
}

export function evaluateDetails(params: {
  best: EvaluationTotals
  tolerableMisstatement: number
  offsettingAppropriate: boolean
  expectedMisstatement: number
  projectedNet: number
}): EvaluationTrigger[] {
  const triggers: EvaluationTrigger[] = []
  const { best, tolerableMisstatement, offsettingAppropriate, expectedMisstatement } = params
  if (tolerableMisstatement <= 0) return triggers

  const netCompared = Math.abs(roundAwayFromZero(best.net))
  const overCompared = roundAwayFromZero(best.over)
  const underCompared = roundAwayFromZero(best.under)

  if (netCompared > tolerableMisstatement) {
    triggers.push({
      id: 'details-net-exceeds',
      severity: 'hard',
      text: 'The sample does not provide a reasonable basis for a conclusion about the population tested.',
    })
  }
  if (!offsettingAppropriate) {
    if (overCompared > tolerableMisstatement) {
      triggers.push({
        id: 'details-over-exceeds',
        severity: 'hard',
        text: 'The sample does not provide a reasonable basis for a conclusion about the population tested (overstatement exceeds the tolerable misstatement; offsetting recorded as not appropriate).',
      })
    }
    if (underCompared > tolerableMisstatement) {
      triggers.push({
        id: 'details-under-exceeds',
        severity: 'hard',
        text: 'The sample does not provide a reasonable basis for a conclusion about the population tested (understatement exceeds the tolerable misstatement; offsetting recorded as not appropriate).',
      })
    }
  }
  if (
    netCompared <= tolerableMisstatement &&
    netCompared >=
      (PROJ_CONFIG.bestEstimateSoftTriggerPctOfTolerable / 100) * tolerableMisstatement
  ) {
    triggers.push({
      id: 'details-near-tolerable',
      severity: 'soft',
      text:
        'The best estimate of misstatement is close to the tolerable misstatement. Because ' +
        'sampling risk is not measured under a non statistical approach, the closer the ' +
        'estimate is to the tolerable limit, the more likely it is that actual misstatement ' +
        'in the population exceeds it. Record why the sample is nonetheless considered to ' +
        'provide a reasonable basis.',
    })
  }
  if (Math.abs(params.projectedNet) > expectedMisstatement) {
    triggers.push({
      id: 'details-exceeds-expected',
      severity: 'soft',
      text:
        'The projected misstatement exceeds the misstatement expected when the sample size ' +
        'was set. Sampling risk that actual misstatement exceeds tolerable misstatement may ' +
        'be unacceptable. Consider extending the sample.',
    })
  }
  return triggers
}

export function evaluateControls(params: {
  deviationRate: number | null
  tolerableRatePct: number
  expectedRatePct: number
  deviationsFound: number
}): EvaluationTrigger[] {
  const triggers: EvaluationTrigger[] = []
  const { deviationRate, tolerableRatePct, expectedRatePct, deviationsFound } = params
  if (deviationRate == null || tolerableRatePct <= 0) return triggers
  const ratePct = deviationRate * 100

  if (ratePct >= tolerableRatePct) {
    triggers.push({
      id: 'controls-rate-exceeds',
      severity: 'hard',
      text: 'The sample does not support the planned reliance on this control. The control cannot be relied upon at the assessed level.',
    })
  } else if (
    ratePct >=
    (PROJ_CONFIG.deviationRateSoftTriggerPctOfTolerable / 100) * tolerableRatePct
  ) {
    triggers.push({
      id: 'controls-rate-near',
      severity: 'soft',
      text:
        'The sample deviation rate approaches the tolerable rate. Under a non statistical ' +
        'approach no upper deviation limit is calculated, so the actual population deviation ' +
        'rate may exceed the tolerable rate. Record why reliance remains appropriate.',
    })
  }
  if (ratePct > expectedRatePct && deviationsFound > 0) {
    triggers.push({
      id: 'controls-exceeds-expected',
      severity: 'soft',
      text: 'Deviations exceed expectation. Reconsider the assessed risk and the planned reliance.',
    })
  }
  if (deviationsFound > 0 && expectedRatePct === 0) {
    triggers.push({
      id: 'controls-nil-expected',
      severity: 'soft',
      text:
        'No deviations were expected when the sample was sized. A single deviation in a ' +
        'small non statistical sample may indicate a rate materially above the tolerable rate.',
    })
  }
  return triggers
}

/** 15.3 — planned audit responses (final option new in v2). */
export const PLANNED_RESPONSE_OPTIONS = [
  'Extend testing, increasing the sample size',
  'Test an alternative control',
  'Perform alternative or additional substantive audit procedures',
  'Modify the nature, timing or extent of related substantive procedures',
  'Request management to investigate the misstatements identified and the potential for further misstatements, and to make any necessary adjustments',
  'Conclude that the population is materially misstated, carry the amount to the Summary of Uncorrected Misstatements, and consider the effect on the audit opinion',
] as const

// ---------------------------------------------------------------------------
// Nil result (Section 16)
// ---------------------------------------------------------------------------

export const NIL_RESULT_NOTE_DETAILS =
  'No misstatements were identified in the sample. Because this is a non statistical ' +
  'sample, no upper misstatement limit has been calculated. The conclusion that the ' +
  'population is not materially misstated rests on the sufficiency of the sample size and ' +
  "the auditor's judgement, both of which are recorded above."

export const NIL_RESULT_NOTE_CONTROLS =
  'No deviations were identified in the sample. Because this is a non statistical sample, ' +
  'no upper deviation limit has been calculated. The conclusion that the control operated ' +
  "effectively rests on the sufficiency of the sample size and the auditor's judgement, " +
  'both of which are recorded above.'
