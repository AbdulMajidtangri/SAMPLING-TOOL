import { describe, expect, it } from 'vitest'
import {
  amountToSum,
  bestEstimate,
  computeDetailsAggregates,
  deviationRateProjection,
  differenceProjection,
  emptyAnomalyJustification,
  evaluateControls,
  evaluateDetails,
  isAnomalyApproved,
  meanPerUnitGateFailures,
  methodAvailabilityFor,
  methodDivergence,
  ratioProjection,
  roundAwayFromZero,
  type MisstatementEntry,
} from './projection'

function approvedAnomaly() {
  return {
    proceduresPerformed:
      'Performed additional procedures: inspected the underlying contract and confirmed the one-off nature of the posting error with the service organisation.',
    basisForCertainty: 'Error arose from a one-off system migration affecting only this item.',
    evidenceReference: 'WP D-14',
    preparerName: 'AB',
    preparerDate: '2026-01-15',
    reviewerName: 'CD',
    reviewerDate: '2026-01-16',
  }
}

function entry(partial: Partial<MisstatementEntry>): MisstatementEntry {
  return {
    id: partial.id ?? 'x',
    itemRef: 'ref',
    bucket: 'residualSample',
    recordedValue: 0,
    auditedValue: 0,
    correctedByManagement: false,
    fraudIndicator: false,
    anomalyFlagged: false,
    anomaly: emptyAnomalyJustification(),
    description: 'd',
    ...partial,
  }
}

describe('ISA 530 projection — worked illustration (brief section 13.4)', () => {
  // Population 100m / 5,000. Tested 100%: 30m / 20 items with 400,000 factual
  // overstatement (uncorrected). Residual 70m / 4,980. Sample 60 items, 8m
  // recorded. Sample misstatement 250,000 overstatement of which 100,000 is an
  // approved anomaly. Tolerable misstatement 1,500,000.
  const entries: MisstatementEntry[] = [
    entry({
      id: 'factual',
      bucket: 'tested100',
      recordedValue: 1_000_000,
      auditedValue: 600_000, // +400,000 factual overstatement
    }),
    entry({
      id: 'representative',
      recordedValue: 500_000,
      auditedValue: 350_000, // +150,000 representative
    }),
    entry({
      id: 'anomaly',
      recordedValue: 300_000,
      auditedValue: 200_000, // +100,000 approved anomaly
      anomalyFlagged: true,
      anomaly: approvedAnomaly(),
    }),
  ]

  const agg = computeDetailsAggregates(entries)

  it('splits factual, representative and anomalous amounts', () => {
    expect(agg.FO).toBe(400_000)
    expect(agg.GO).toBe(250_000)
    expect(agg.AO).toBe(100_000)
    expect(agg.RO).toBe(150_000)
    expect(agg.RN).toBe(150_000)
  })

  it('ratio projection: k = 8.75 and PO = 1,312,500', () => {
    const proj = ratioProjection({
      residualValue: 70_000_000,
      sampleRecordedValue: 8_000_000,
      RO: agg.RO,
      RU: agg.RU,
    })
    expect(proj.factor).toBeCloseTo(8.75)
    expect(proj.PO).toBeCloseTo(1_312_500)

    // v2 best estimate includes the factual component: 400,000 + 1,312,500 + 100,000
    const best = bestEstimate(agg, proj)
    expect(best.net).toBeCloseTo(1_812_500)
    expect(best.over).toBeCloseTo(1_812_500)

    // The v2 total fails a tolerable misstatement of 1,500,000
    const triggers = evaluateDetails({
      best,
      tolerableMisstatement: 1_500_000,
      offsettingAppropriate: true,
      expectedMisstatement: 100_000,
      projectedNet: proj.PN,
    })
    expect(triggers.some((t) => t.severity === 'hard')).toBe(true)
  })

  it('amount to SUM: projection never reduced by correction', () => {
    const corrected = entries.map((e) =>
      e.id === 'factual' ? { ...e, correctedByManagement: true } : e,
    )
    const aggC = computeDetailsAggregates(corrected)
    const proj = ratioProjection({
      residualValue: 70_000_000,
      sampleRecordedValue: 8_000_000,
      RO: aggC.RO,
      RU: aggC.RU,
    })
    const sum = amountToSum(aggC, proj)
    // Factual 400,000 corrected → removed; projected 1,312,500 stays; anomaly 100,000 stays
    expect(sum.net).toBeCloseTo(1_412_500)
    // Best estimate is unchanged by correction
    expect(bestEstimate(aggC, proj).net).toBeCloseTo(1_812_500)
  })
})

describe('projection methods', () => {
  it('difference projection uses item counts', () => {
    const proj = differenceProjection({
      residualCount: 4_980,
      sampleCount: 60,
      RO: 150_000,
      RU: 0,
    })
    expect(proj.factor).toBeCloseTo(83)
    expect(proj.PO).toBeCloseTo(12_450_000)
  })

  it('projects overstatement and understatement separately', () => {
    const proj = ratioProjection({
      residualValue: 1_000_000,
      sampleRecordedValue: 100_000,
      RO: 5_000,
      RU: 2_000,
    })
    expect(proj.PO).toBeCloseTo(50_000)
    expect(proj.PU).toBeCloseTo(20_000)
    expect(proj.PN).toBeCloseTo(30_000)
  })

  it('divergence check flags materially different results', () => {
    expect(methodDivergence(100_000, 50_000).differs).toBe(true)
    expect(methodDivergence(100_000, 90_000).differs).toBe(false)
    expect(methodDivergence(0, 0).differs).toBe(false)
  })

  it('deviation rate reports one figure only', () => {
    expect(deviationRateProjection({ sampleCount: 50, representativeDeviations: 2 })).toBeCloseTo(
      0.04,
    )
    expect(deviationRateProjection({ sampleCount: 0, representativeDeviations: 0 })).toBeNull()
  })

  it('mean per unit is disabled by default and gated', () => {
    const failures = meanPerUnitGateFailures({
      enabled: false,
      selectionMethod: 'haphazard',
      sampleCount: 10,
      sampleRecordedValue: 100,
      residualValue: 10_000,
      residualCount: 100,
      negativesOrZerosConfirmedAbsent: false,
    })
    expect(failures.length).toBeGreaterThanOrEqual(4)
  })

  it('method availability matrix follows section 11.6', () => {
    expect(methodAvailabilityFor('random').difference).toBe('available')
    expect(methodAvailabilityFor('monetaryUnit').difference).toBe('blocked')
    expect(methodAvailabilityFor('monetaryUnit').ratio).toBe('warning')
    expect(methodAvailabilityFor('haphazard').meanPerUnit).toBe('blocked')
    expect(methodAvailabilityFor('block').deviationRate).toBe('warning')
  })
})

describe('anomaly gate (block F)', () => {
  it('flag has no effect until justification complete and reviewed', () => {
    const e = entry({
      recordedValue: 100,
      auditedValue: 0,
      anomalyFlagged: true,
    })
    expect(isAnomalyApproved(e)).toBe(false)
    const agg = computeDetailsAggregates([e])
    expect(agg.AO).toBe(0)
    expect(agg.RO).toBe(100) // still projected as representative
  })

  it('fraud items may never be anomalies', () => {
    const e = entry({
      recordedValue: 100,
      auditedValue: 0,
      anomalyFlagged: true,
      fraudIndicator: true,
      anomaly: approvedAnomaly(),
    })
    expect(isAnomalyApproved(e)).toBe(false)
  })
})

describe('evaluation triggers', () => {
  it('soft trigger near the tolerable limit', () => {
    const triggers = evaluateDetails({
      best: { over: 700, under: 0, net: 700 },
      tolerableMisstatement: 1_000,
      offsettingAppropriate: true,
      expectedMisstatement: 10_000,
      projectedNet: 700,
    })
    expect(triggers.some((t) => t.id === 'details-near-tolerable')).toBe(true)
    expect(triggers.every((t) => t.severity === 'soft')).toBe(true)
  })

  it('gross evaluation when offsetting not appropriate', () => {
    const triggers = evaluateDetails({
      best: { over: 1_200, under: 1_100, net: 100 },
      tolerableMisstatement: 1_000,
      offsettingAppropriate: false,
      expectedMisstatement: 10_000,
      projectedNet: 100,
    })
    expect(triggers.filter((t) => t.severity === 'hard').length).toBe(2)
  })

  it('controls: rate at or above tolerable is a hard trigger', () => {
    const triggers = evaluateControls({
      deviationRate: 0.1,
      tolerableRatePct: 10,
      expectedRatePct: 0,
      deviationsFound: 5,
    })
    expect(triggers.some((t) => t.severity === 'hard')).toBe(true)
  })
})

describe('rounding (section 18)', () => {
  it('rounds away from zero so a fail cannot become a pass', () => {
    expect(roundAwayFromZero(999.01)).toBe(1000)
    expect(roundAwayFromZero(-999.01)).toBe(-1000)
    expect(roundAwayFromZero(1000)).toBe(1000)
  })
})
