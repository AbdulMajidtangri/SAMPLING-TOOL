import { describe, expect, it } from 'vitest'
import { buildTransactions, coverageFromDebitCredit, totalCoverageValue } from './coverage'
import {
  detectHeaderRow,
  fillUnmappedByColumnOrder,
  hasDateLikeHeader,
  normalizeHeader,
  scoreHeaderMatch,
  suggestMappings,
  validateRequiredMappings,
} from './headers'
import {
  pathASampleSize,
  pathBPostSelectionReview,
  pathBSizing,
  suggestSampleSizeForPath,
  validateSampleSizeOverride,
} from './sampleSize'
import { selectRandom, selectSystematic, selectBlock, runPathBSelection } from './selection'
import type { LedgerTransaction, StandardField } from './types'

function mapOf(
  entries: Partial<Record<StandardField, number>>,
): Record<StandardField, number | null> {
  return {
    date: entries.date ?? null,
    voucherNo: entries.voucherNo ?? null,
    accountNo: entries.accountNo ?? null,
    description: entries.description ?? null,
    debit: entries.debit ?? null,
    credit: entries.credit ?? null,
    amount: entries.amount ?? null,
    riskLevel: entries.riskLevel ?? null,
  }
}

function tx(partial: Partial<LedgerTransaction> & Pick<LedgerTransaction, 'id' | 'coverageAmount'>): LedgerTransaction {
  return {
    rowIndex: 0,
    date: '2024-01-01',
    voucherNo: partial.id,
    accountNo: '',
    description: 'x',
    debit: partial.coverageAmount,
    credit: 0,
    amountRaw: 0,
    bothSidesWarning: false,
    needsCoverageResolution: false,
    isRepeatedHeader: false,
    looksLikeTotal: false,
    looksLikeOpeningClosing: false,
    isZeroOrNegative: false,
    isDuplicateVoucher: false,
    excluded: false,
    exclusionReason: '',
    highValue: false,
    stratumKey: 'all',
    riskLevel: 'Low',
    extras: {},
    ...partial,
  } as LedgerTransaction
}

describe('header edge cases', () => {
  it('Case 1: exact headers map with high confidence', () => {
    const headers = ['Date', 'Voucher No', 'Description', 'Debit', 'Credit']
    const m = suggestMappings(headers)
    expect(m.date.columnIndex).toBe(0)
    expect(m.voucherNo.columnIndex).toBe(1)
    expect(m.description.columnIndex).toBe(2)
    expect(m.debit.columnIndex).toBe(3)
    expect(m.credit.columnIndex).toBe(4)
    expect(m.date.confidence).toBe('high')
  })

  it('Case 2: different order still maps by name', () => {
    const headers = ['Credit', 'Description', 'Voucher No', 'Debit', 'Date']
    const m = suggestMappings(headers)
    expect(m.credit.columnIndex).toBe(0)
    expect(m.description.columnIndex).toBe(1)
    expect(m.voucherNo.columnIndex).toBe(2)
    expect(m.debit.columnIndex).toBe(3)
    expect(m.date.columnIndex).toBe(4)
  })

  it('Case 3: alternative names', () => {
    const headers = ['Posting Date', 'Doc No', 'Narration', 'Dr', 'Cr']
    const m = suggestMappings(headers)
    expect(m.date.columnIndex).toBe(0)
    expect(m.voucherNo.columnIndex).toBe(1)
    expect(m.description.columnIndex).toBe(2)
    expect(m.debit.columnIndex).toBe(3)
    expect(m.credit.columnIndex).toBe(4)
  })

  it('Case 4: spelling variations get medium/low confidence or still map', () => {
    const headers = ['Data', 'Vouch No', 'Descrip', 'Debit', 'Creadit']
    const m = suggestMappings(headers)
    expect(m.date.columnIndex).toBe(0)
    expect(m.voucherNo.columnIndex).not.toBeNull()
    expect(m.description.columnIndex).not.toBeNull()
    expect(m.credit.columnIndex).toBe(4)
    expect(
      ['medium', 'low', 'high'].includes(m.date.confidence) ||
        m.date.needsAuditorChoice,
    ).toBe(true)
  })

  it('Case 5: uppercase and symbols normalize', () => {
    expect(normalizeHeader('voucher_no')).toBe('voucherno')
    expect(normalizeHeader('DEBIT AMOUNT')).toBe('debitamount')
    const headers = ['DATE', 'voucher_no', 'Description Details', 'DEBIT AMOUNT', 'CREDIT AMOUNT']
    const m = suggestMappings(headers)
    expect(m.date.columnIndex).toBe(0)
    expect(m.voucherNo.columnIndex).toBe(1)
    expect(m.description.columnIndex).toBe(2)
    expect(m.debit.columnIndex).toBe(3)
    expect(m.credit.columnIndex).toBe(4)
  })

  it('Case 6: extra columns retained without blocking', () => {
    const headers = [
      'Date',
      'Voucher No',
      'Vendor Name',
      'Department',
      'Description',
      'Debit',
      'Credit',
      'Branch',
    ]
    const m = suggestMappings(headers)
    expect(m.date.columnIndex).toBe(0)
    expect(m.voucherNo.columnIndex).toBe(1)
    expect(m.description.columnIndex).toBe(4)
    expect(m.debit.columnIndex).toBe(5)
    expect(m.credit.columnIndex).toBe(6)
    expect(validateRequiredMappings(m)).toHaveLength(0)
  })

  it('Case 7: header row not first row', () => {
    const rows = [
      ['Company Name'],
      ['Ledger Report'],
      ['Period'],
      ['Date', 'Voucher No', 'Description', 'Debit', 'Credit'],
      ['2024-01-01', 'V1', 'Test', '100', ''],
    ]
    expect(detectHeaderRow(rows)).toBe(3)
  })

  it('Case 8: repeated header inside data warns and auto-excludes', () => {
    const rows = [
      ['Date', 'Voucher No', 'Description', 'Debit', 'Credit'],
      ['2024-01-01', 'V1', 'Fee', '100', ''],
      ['Date', 'Voucher No', 'Description', 'Debit', 'Credit'],
      ['2024-01-02', 'V2', 'Fee', '200', ''],
    ]
    const result = buildTransactions({
      rows,
      headerRow: 0,
      dataStart: 1,
      dataEnd: 3,
      mapping: mapOf({ date: 0, voucherNo: 1, description: 2, debit: 3, credit: 4 }),
    })
    expect(result.warnings.some((w) => /repeated header/i.test(w))).toBe(true)
    expect(result.transactions.some((t) => t.isRepeatedHeader && t.excluded)).toBe(true)
  })

  it('Case 9: missing voucher no is a hard stop unless alt ID', () => {
    const missing = suggestMappings(['Date', 'Description', 'Debit', 'Credit'])
    const errors = validateRequiredMappings(missing)
    expect(errors.some((e) => /Voucher No/i.test(e))).toBe(true)

    const ok = suggestMappings(['Date', 'Account No', 'Description', 'Debit', 'Credit'])
    expect(validateRequiredMappings(ok)).toHaveLength(0)
  })

  it('date is optional when no date-like header is present', () => {
    const headers = ['Voucher No', 'Description', 'Debit', 'Credit']
    expect(hasDateLikeHeader(headers)).toBe(false)
    const m = suggestMappings(headers)
    expect(m.date.columnIndex).toBeNull()
    expect(m.voucherNo.columnIndex).toBe(0)
    const errors = validateRequiredMappings(m, headers)
    expect(errors.some((e) => /Date/i.test(e))).toBe(false)
    expect(errors).toHaveLength(0)
  })

  it('date remains required when a date-like header exists', () => {
    const headers = ['Date', 'Voucher No', 'Description', 'Debit', 'Credit']
    const m = suggestMappings(headers)
    expect(hasDateLikeHeader(headers)).toBe(true)
    m.date = {
      columnIndex: null,
      confidence: 'none',
      candidates: m.date.candidates,
      needsAuditorChoice: false,
    }
    const errors = validateRequiredMappings(m, headers)
    expect(errors.some((e) => /Date is required/i.test(e))).toBe(true)
  })

  it('positional order fills unmapped core columns left-to-right', () => {
    const empty = suggestMappings(['Col A', 'Col B', 'Col C', 'Col D', 'Col E'])
    const filled = fillUnmappedByColumnOrder(empty, 5)
    expect(filled.date.columnIndex).toBe(0)
    expect(filled.voucherNo.columnIndex).toBe(1)
    expect(filled.description.columnIndex).toBe(2)
    expect(filled.debit.columnIndex).toBe(3)
    expect(filled.credit.columnIndex).toBe(4)
    expect(validateRequiredMappings(filled)).toHaveLength(0)
  })

  it('positional order keeps name-based mappings and only fills gaps', () => {
    const partial = suggestMappings(['Date', 'Narration', 'Debit', 'Credit', 'Extra'])
    // voucher still missing by name
    expect(partial.voucherNo.columnIndex).toBeNull()
    const filled = fillUnmappedByColumnOrder(partial, 5)
    expect(filled.date.columnIndex).toBe(0)
    expect(filled.description.columnIndex).toBe(1)
    expect(filled.debit.columnIndex).toBe(2)
    expect(filled.credit.columnIndex).toBe(3)
    // first unused column becomes voucher
    expect(filled.voucherNo.columnIndex).toBe(4)
  })

  it('Case 10: multiple date columns require auditor choice', () => {
    const headers = [
      'Date',
      'Voucher Date',
      'Posting Date',
      'Voucher No',
      'Description',
      'Debit',
      'Credit',
    ]
    const m = suggestMappings(headers)
    expect(m.date.needsAuditorChoice || m.date.columnIndex == null).toBe(true)
    expect(m.date.candidates.length).toBeGreaterThan(1)
  })
})

describe('coverage amount rules', () => {
  it('debit only / credit only / both / absolute', () => {
    expect(coverageFromDebitCredit(50000, 0).coverageAmount).toBe(50000)
    expect(coverageFromDebitCredit(0, 25000).coverageAmount).toBe(25000)
    expect(coverageFromDebitCredit(-50000, 0).coverageAmount).toBe(50000)
    const both = coverageFromDebitCredit(10000, 5000)
    expect(both.needsResolution).toBe(true)
    expect(both.bothSidesWarning).toBe(true)
  })
})

describe('sample size paths', () => {
  it('Path A: base + adjustments (no coverage % mix)', () => {
    const r = pathASampleSize(
      { riskLevel: 3, expectedError: 2, otherEvidence: 2 },
      218,
    )
    // base 50 (High) + 5 (Medium error) + 0 (Normal evidence) = 55
    expect(r.baseSize).toBe(50)
    expect(r.expectedErrorAdjustment).toBe(5)
    expect(r.evidenceAdjustment).toBe(0)
    expect(r.matrixSize).toBe(55)
    expect(r.coverageSize).toBeNull()
    expect(r.finalSize).toBe(55)
  })

  it('Path A: caps matrix size at population', () => {
    const r = pathASampleSize(
      { riskLevel: 4, expectedError: 4, otherEvidence: 4 },
      20,
    )
    // 70 + 15 + 10 = 95 → clamped to 70 max, capped at population 20
    expect(r.matrixSize).toBe(70)
    expect(r.finalSize).toBe(20)
    expect(r.isHundredPercent).toBe(true)
  })

  it('Path A: sizes match the base/adjustment matrix', () => {
    // Low 15 + 0 - 10 = 5 → floor 15
    expect(
      pathASampleSize({ riskLevel: 1, expectedError: 1, otherEvidence: 1 }, 100)
        .finalSize,
    ).toBe(15)
    // Low 15 + 5 + 0 = 20
    expect(
      pathASampleSize({ riskLevel: 1, expectedError: 2, otherEvidence: 2 }, 100)
        .finalSize,
    ).toBe(20)
    // Low 15 + 10 + 5 = 30
    expect(
      pathASampleSize({ riskLevel: 1, expectedError: 3, otherEvidence: 3 }, 100)
        .finalSize,
    ).toBe(30)
    // Low 15 + 15 + 10 = 40
    expect(
      pathASampleSize({ riskLevel: 1, expectedError: 4, otherEvidence: 4 }, 100)
        .finalSize,
    ).toBe(40)
    // Medium 30 + 0 - 10 = 20
    expect(
      pathASampleSize({ riskLevel: 2, expectedError: 1, otherEvidence: 1 }, 100)
        .finalSize,
    ).toBe(20)
    // Medium 30 + 15 + 10 = 55
    expect(
      pathASampleSize({ riskLevel: 2, expectedError: 4, otherEvidence: 4 }, 100)
        .finalSize,
    ).toBe(55)
    // High 50 + 0 - 10 = 40
    expect(
      pathASampleSize({ riskLevel: 3, expectedError: 1, otherEvidence: 1 }, 100)
        .finalSize,
    ).toBe(40)
    // High 50 + 15 + 10 = 75 → cap 70
    expect(
      pathASampleSize({ riskLevel: 3, expectedError: 4, otherEvidence: 4 }, 100)
        .finalSize,
    ).toBe(70)
    // Very high 70 + 0 - 10 = 60
    expect(
      pathASampleSize({ riskLevel: 4, expectedError: 1, otherEvidence: 1 }, 100)
        .finalSize,
    ).toBe(60)
    // Very high 70 + 5 + 0 = 75 → cap 70
    expect(
      pathASampleSize({ riskLevel: 4, expectedError: 2, otherEvidence: 2 }, 100)
        .finalSize,
    ).toBe(70)
  })

  it('Path A: large population uses matrix only (not % of count)', () => {
    const r = pathASampleSize(
      { riskLevel: 3, expectedError: 2, otherEvidence: 2 },
      100,
    )
    expect(r.finalSize).toBe(55)
  })

  it('Path B: value coverage suggests item count from 50% target', () => {
    const pop = Array.from({ length: 40 }, (_, i) =>
      tx({
        id: `R${i}`,
        rowIndex: i,
        coverageAmount: 20_000,
        debit: 20_000,
        riskLevel: 'Low',
      }),
    )
    // total 800_000 → target 400_000 → need 20 items of 20k
    const b = pathBSizing(pop)
    expect(b.suggestedSampleSize).toBe(20)
    expect(b.provisionalCoverageValue).toBe(400_000)
  })

  it('Path B: single transaction rule applies when one item is >= 50%', () => {
    const pop = [
      tx({ id: 'R1', coverageAmount: 60_000, debit: 60_000, riskLevel: 'Low' }),
      tx({ id: 'R2', coverageAmount: 30_000, debit: 30_000, riskLevel: 'Low' }),
      tx({ id: 'R3', coverageAmount: 10_000, debit: 10_000, riskLevel: 'Low' }),
    ]
    // Total = 100k, Target = 50k. R1 (60k) >= 50k, so select ONLY R1
    const selected = runPathBSelection(pop)
    expect(selected.map((t) => t.id)).toEqual(['R1'])
  })

  it('Path B: sorts descending and breaks ties by Risk Level (High -> Medium -> Low)', () => {
    const pop = [
      tx({ id: 'R1', coverageAmount: 20_000, debit: 20_000, riskLevel: 'Low' }),
      tx({ id: 'R2', coverageAmount: 20_000, debit: 20_000, riskLevel: 'High' }),
      tx({ id: 'R3', coverageAmount: 20_000, debit: 20_000, riskLevel: 'Medium' }),
    ]
    // Total = 60k, Target = 30k. Sorted order: R2 (High), R3 (Med), R1 (Low).
    // Target = 30k requires 2 items (R2 + R3 = 40k)
    const selected = runPathBSelection(pop)
    expect(selected.map((t) => t.id)).toEqual(['R2', 'R3'])
  })

  it('suggestSampleSizeForPath routes to Path A or B', () => {
    const pop = Array.from({ length: 50 }, (_, i) =>
      tx({ id: `R${i}`, rowIndex: i, coverageAmount: 10_000, debit: 10_000 }),
    )
    const a = suggestSampleSizeForPath({
      path: 'pathA',
      pathA: { riskLevel: 2, expectedError: 2, otherEvidence: 2 },
      transactions: pop,
    })
    expect(a.pathADetail).not.toBeNull()
    expect(a.pathBDetail).toBeNull()

    const b = suggestSampleSizeForPath({
      path: 'pathB',
      pathA: { riskLevel: 2, expectedError: 2, otherEvidence: 2 },
      transactions: pop,
    })
    expect(b.pathBDetail).not.toBeNull()
    expect(b.pathADetail).toBeNull()
  })

  it('override below suggested size needs reviewer approval', () => {
    const blocked = validateSampleSizeOverride({
      proposed: 5,
      calculated: 25,
      population: 100,
      rationale: 'Too many items for this small area of testing work.',
      reviewerApproved: false,
    })
    expect(blocked.ok).toBe(false)

    const allowed = validateSampleSizeOverride({
      proposed: 5,
      calculated: 25,
      population: 100,
      rationale: 'Too many items for this small area of testing work.',
      reviewerApproved: true,
    })
    expect(allowed.ok).toBe(true)
  })
  it('Path B post-selection review flags shortfall and untested remainder', () => {
    const pop = Array.from({ length: 10 }, (_, i) =>
      tx({ id: `R${i}`, rowIndex: i, coverageAmount: 100_000, debit: 100_000 }),
    )
    const selected = pop.slice(0, 2)
    const review = pathBPostSelectionReview({
      population: pop,
      selected,
      requiredCoverageValue: 500_000,
    })
    expect(review.selectedCoverage).toBe(200_000)
    expect(review.untestedCount).toBe(8)
    expect(review.untestedValue).toBe(800_000)
    expect(review.belowRequired).toBe(true)
    expect(review.coverageAchievedPercent).toBe(20)
  })
})

describe('selection methods', () => {
  const pop: LedgerTransaction[] = Array.from({ length: 40 }, (_, i) =>
    tx({ id: `R${i}`, rowIndex: i, voucherNo: `V${i}`, coverageAmount: 1000, debit: 1000 }),
  )

  it('random selects exact size and stores seed/hash', () => {
    const { selected, meta } = selectRandom(pop, 15, 'seed-1')
    expect(selected).toHaveLength(15)
    expect(meta.seed).toBe('seed-1')
    expect(meta.rngAlgorithm).toBe('mulberry32')
    expect(meta.dataHash).toMatch(/^fnv1a-/)
    expect(meta.selectedIds).toHaveLength(15)
  })

  it('systematic selects exact size with non-integer interval', () => {
    const { selected, meta } = selectSystematic(pop, 7, 'seed-2')
    expect(selected).toHaveLength(7)
    expect(meta.interval).toBeCloseTo(40 / 7, 3)
    expect(meta.patternWarning).toBeTruthy()
  })

  it('block rejects invalid start', () => {
    expect(() => selectBlock(pop, 10, 35, 'reason')).toThrow()
    const { selected } = selectBlock(pop, 10, 5, 'Month-end cut-off block')
    expect(selected).toHaveLength(10)
  })
})

describe('amount parsing via build', () => {
  it('handles thousands separators and parentheses negatives', () => {
    const rows = [
      ['Date', 'Voucher No', 'Description', 'Debit', 'Credit'],
      ['01/01/2024', 'A1', 'One', '1,250.50', ''],
      ['01/01/2024', 'A2', 'Two', '(500)', ''],
    ]
    const result = buildTransactions({
      rows,
      headerRow: 0,
      dataStart: 1,
      dataEnd: 2,
      mapping: mapOf({ date: 0, voucherNo: 1, description: 2, debit: 3, credit: 4 }),
    })
    expect(result.transactions[0].coverageAmount).toBeCloseTo(1250.5)
    expect(result.transactions[1].coverageAmount).toBe(500)
    expect(totalCoverageValue(result.transactions)).toBeCloseTo(1750.5)
  })
})

describe('trimSparseColumns', () => {
  it('drops blank and duplicate Debit/Credit columns (including dash placeholders)', async () => {
    const { trimSparseColumns } = await import('./excel')
    const rows = [
      ['', 'Account no.', 'Description', 'Debit (Rs.)', 'Credit (Rs.)', 'Debit (Rs.)', 'Credit (Rs.)', 'Debit (Rs.)', 'Credit (Rs.)'],
      ['', '800', 'Fees', '', '100', '-', '-', '', '100'],
      ['', '801', 'Other', '', '200', '-', '-', '', '200'],
    ]
    const trimmed = trimSparseColumns(rows)
    expect(trimmed[0]).toEqual([
      'Account no.',
      'Description',
      'Debit (Rs.)',
      'Credit (Rs.)',
    ])
    expect(trimmed[1]).toEqual(['800', 'Fees', '', '100'])
  })
})

describe('scoreHeaderMatch', () => {
  it('does not map Column 1 as voucher', () => {
    expect(scoreHeaderMatch('Column 1', 'voucherNo').confidence).toBe('none')
  })
})

describe('high-value separation', () => {
  it('separates items at or above threshold into specific-testing pool', async () => {
    const { separateHighValue } = await import('./highValue')
    const items = [
      tx({ id: 'R1', coverageAmount: 50_000 }),
      tx({ id: 'R2', coverageAmount: 150_000 }),
      tx({ id: 'R3', coverageAmount: 100_000 }),
    ]
    const { highValue, residual } = separateHighValue(items, 100_000)
    expect(highValue.map((t) => t.id).sort()).toEqual(['R2', 'R3'])
    expect(residual.map((t) => t.id)).toEqual(['R1'])
  })
})

describe('method recommendation', () => {
  it('recommends a selection technique and never treats stratification as a method', async () => {
    const { recommendMethod } = await import('./methodRecommend')
    const pop = Array.from({ length: 50 }, (_, i) =>
      tx({ id: `R${i}`, rowIndex: i, coverageAmount: 1000 + i * 10, debit: 1000 }),
    )
    const rec = recommendMethod({ residual: pop, riskLevel: 'high', highValueCount: 2 })
    expect(['random', 'systematic', 'haphazard', 'block']).toContain(rec.recommended)
    expect(rec.reasons.length).toBeGreaterThan(0)
  })
})
