import { describe, expect, it } from 'vitest'
import { buildTransactions, coverageFromDebitCredit, totalCoverageValue } from './coverage'
import {
  detectHeaderRow,
  fillUnmappedByColumnOrder,
  normalizeHeader,
  scoreHeaderMatch,
  suggestMappings,
  validateRequiredMappings,
} from './headers'
import { pathASampleSize, pathBSizing, validateSampleSizeOverride } from './sampleSize'
import { selectRandom, selectSystematic, selectBlock } from './selection'
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
  }
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

  it('Case 9: missing voucher no warns unless alt ID (no hard stop)', () => {
    const missing = suggestMappings(['Date', 'Description', 'Debit', 'Credit'])
    const warnings = validateRequiredMappings(missing)
    expect(warnings.some((e) => /Voucher No/i.test(e))).toBe(true)

    const ok = suggestMappings(['Date', 'Account No', 'Description', 'Debit', 'Credit'])
    expect(validateRequiredMappings(ok)).toHaveLength(0)
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

describe('Path A and Path B', () => {
  it('Path A matrix scores', () => {
    expect(pathASampleSize({ riskLevel: 1, expectedError: 1, otherEvidence: 1 }, 100).calculated).toBe(15)
    expect(pathASampleSize({ riskLevel: 2, expectedError: 2, otherEvidence: 2 }, 100).calculated).toBe(40)
    expect(pathASampleSize({ riskLevel: 4, expectedError: 4, otherEvidence: 4 }, 100).calculated).toBe(70)
    expect(pathASampleSize({ riskLevel: 4, expectedError: 4, otherEvidence: 4 }, 20).finalSize).toBe(20)
  })

  it('Path B floor rule and min item count', () => {
    const txs: LedgerTransaction[] = Array.from({ length: 20 }, (_, i) => ({
      id: `R${i}`,
      rowIndex: i,
      date: '2024-01-01',
      voucherNo: `V${i}`,
      accountNo: '',
      description: 'x',
      debit: i === 0 ? 450_000 : 5_000,
      credit: 0,
      amountRaw: 0,
      coverageAmount: i === 0 ? 450_000 : 5_000,
      bothSidesWarning: false,
      needsCoverageResolution: false,
      isRepeatedHeader: false,
      looksLikeTotal: false,
      excluded: false,
      exclusionReason: '',
      extras: {},
    }))
    // total = 450k + 19*5k = 545,000 → tier 2, required max(327000, 500000)=500000
    const result = pathBSizing(txs)
    expect(result.tier).toBe(2)
    expect(result.requiredCoverageValue).toBe(500_000)
    expect(result.suggestedSampleSize).toBeGreaterThanOrEqual(15)
    expect(result.suggestedSampleSize).not.toBe(1)
  })

  it('Path B cliff example 510,000', () => {
    const pop: LedgerTransaction[] = Array.from({ length: 51 }, (_, i) => ({
      id: `P${i}`,
      rowIndex: i,
      date: '2024-01-01',
      voucherNo: `V${i}`,
      accountNo: '',
      description: 'x',
      debit: 10_000,
      credit: 0,
      amountRaw: 0,
      coverageAmount: 10_000,
      bothSidesWarning: false,
      needsCoverageResolution: false,
      isRepeatedHeader: false,
      looksLikeTotal: false,
      excluded: false,
      exclusionReason: '',
      extras: {},
    }))
    // 51 * 10k = 510k → tier 2 floor forces Rs. 500,000
    const r = pathBSizing(pop)
    expect(r.requiredCoverageValue).toBe(500_000)
  })

  it('override below floor needs reviewer approval', () => {
    const blocked = validateSampleSizeOverride({
      proposed: 5,
      calculated: 25,
      minimumFloor: 15,
      population: 100,
      rationale: 'Too many items for this small area of testing work.',
      reviewerApproved: false,
    })
    expect(blocked.ok).toBe(false)

    const allowed = validateSampleSizeOverride({
      proposed: 5,
      calculated: 25,
      minimumFloor: 15,
      population: 100,
      rationale: 'Too many items for this small area of testing work.',
      reviewerApproved: true,
    })
    expect(allowed.ok).toBe(true)
  })
})

describe('selection methods', () => {
  const pop: LedgerTransaction[] = Array.from({ length: 40 }, (_, i) => ({
    id: `R${i}`,
    rowIndex: i,
    date: '2024-01-01',
    voucherNo: `V${i}`,
    accountNo: '',
    description: 'x',
    debit: 1000,
    credit: 0,
    amountRaw: 0,
    coverageAmount: 1000,
    bothSidesWarning: false,
    needsCoverageResolution: false,
    isRepeatedHeader: false,
    looksLikeTotal: false,
    excluded: false,
    exclusionReason: '',
    extras: {},
  }))

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

describe('scoreHeaderMatch', () => {
  it('does not map Column 1 as voucher', () => {
    expect(scoreHeaderMatch('Column 1', 'voucherNo').confidence).toBe('none')
  })
})
