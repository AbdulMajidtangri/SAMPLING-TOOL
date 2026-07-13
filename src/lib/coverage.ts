import { cellToText, parseAmount } from './excel'
import type { LedgerTransaction, StandardField } from './types'

export function coverageFromDebitCredit(
  debit: number,
  credit: number,
): { coverageAmount: number; bothSidesWarning: boolean } {
  const d = Math.abs(debit)
  const c = Math.abs(credit)

  if (d > 0 && c > 0) {
    return { coverageAmount: Math.max(d, c), bothSidesWarning: true }
  }
  if (d > 0) return { coverageAmount: d, bothSidesWarning: false }
  if (c > 0) return { coverageAmount: c, bothSidesWarning: false }
  return { coverageAmount: 0, bothSidesWarning: false }
}

export function buildTransactions(params: {
  rows: unknown[][]
  headerRow: number
  dataStart: number
  dataEnd: number
  mapping: Record<StandardField, number | null>
}): { transactions: LedgerTransaction[]; errors: string[]; warnings: string[] } {
  const { rows, headerRow, dataStart, dataEnd, mapping } = params
  const errors: string[] = []
  const warnings: string[] = []
  const transactions: LedgerTransaction[] = []

  const required: StandardField[] = [
    'date',
    'voucherNo',
    'description',
    'debit',
    'credit',
  ]
  for (const field of required) {
    if (mapping[field] == null) {
      errors.push(`Required field not mapped: ${field}`)
    }
  }
  if (errors.length) return { transactions, errors, warnings }

  const headerCells = (rows[headerRow] ?? []).map((c) => cellToText(c))
  const voucherSeen = new Set<string>()
  let zeroCount = 0
  let bothSides = 0

  for (let rowIndex = dataStart; rowIndex <= dataEnd; rowIndex++) {
    const row = rows[rowIndex] ?? []
    const date = cellToText(row[mapping.date!])
    const voucherNo = cellToText(row[mapping.voucherNo!])
    const description = cellToText(row[mapping.description!])

    const debitRaw = parseAmount(row[mapping.debit!])
    const creditRaw = parseAmount(row[mapping.credit!])

    if (debitRaw == null || creditRaw == null) {
      errors.push(`Row ${rowIndex + 1}: amount cannot be interpreted as numeric.`)
      continue
    }

    const joined = `${date}${voucherNo}${description}${debitRaw}${creditRaw}`.trim()
    if (!joined || (!date && !voucherNo && !description && debitRaw === 0 && creditRaw === 0)) {
      continue
    }

    const lowerDesc = description.toLowerCase()
    if (
      /total|subtotal|grand total|balance c\/f|balance b\/f|carried forward|brought forward/.test(
        lowerDesc,
      )
    ) {
      warnings.push(`Row ${rowIndex + 1} looks like a total/subtotal row.`)
    }

    if (normalizeLoose(date) === 'date' || normalizeLoose(voucherNo) === 'voucherno') {
      warnings.push(`Row ${rowIndex + 1} may be a repeated header.`)
      continue
    }

    const { coverageAmount, bothSidesWarning } = coverageFromDebitCredit(
      debitRaw,
      creditRaw,
    )
    if (bothSidesWarning) bothSides += 1
    if (coverageAmount === 0) zeroCount += 1

    if (voucherNo) {
      if (voucherSeen.has(voucherNo)) {
        warnings.push(`Duplicate voucher/document number: ${voucherNo}`)
      }
      voucherSeen.add(voucherNo)
    }

    const extras: Record<string, string> = {}
    headerCells.forEach((header, colIndex) => {
      if (!header) return
      const mappedCols = Object.values(mapping)
      if (mappedCols.includes(colIndex)) return
      const value = cellToText(row[colIndex])
      if (value) extras[header] = value
    })

    transactions.push({
      id: `R${rowIndex + 1}`,
      rowIndex,
      date,
      voucherNo,
      description,
      debit: debitRaw,
      credit: creditRaw,
      coverageAmount,
      bothSidesWarning,
      extras,
    })
  }

  if (bothSides > 0) {
    warnings.push(
      `${bothSides} row(s) have both Debit and Credit values. Confirm coverage treatment.`,
    )
  }
  if (transactions.length > 0 && zeroCount / transactions.length >= 0.2) {
    warnings.push('Large number of zero-value rows found.')
  }

  return { transactions, errors, warnings }
}

function normalizeLoose(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function totalCoverageValue(transactions: LedgerTransaction[]): number {
  return transactions.reduce((sum, t) => sum + Math.abs(t.coverageAmount), 0)
}
