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

export function coverageFromAmount(amount: number): number {
  return Math.abs(amount)
}

function readOptionalText(
  row: unknown[],
  columnIndex: number | null | undefined,
): string {
  if (columnIndex == null) return ''
  return cellToText(row[columnIndex])
}

function readOptionalAmount(
  row: unknown[],
  columnIndex: number | null | undefined,
): { value: number; invalid: boolean } {
  if (columnIndex == null) return { value: 0, invalid: false }
  const raw = row[columnIndex]
  if (raw == null || String(raw).trim() === '') return { value: 0, invalid: false }
  const parsed = parseAmount(raw)
  if (parsed == null) return { value: 0, invalid: true }
  return { value: parsed, invalid: false }
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

  const hasDebit = mapping.debit != null
  const hasCredit = mapping.credit != null
  const hasAmount = mapping.amount != null

  if (!hasDebit && !hasCredit && !hasAmount) {
    warnings.push(
      'No Debit, Credit, or Amount column mapped. Coverage values will be zero (Path B cannot be used).',
    )
  } else if (hasAmount && (hasDebit || hasCredit)) {
    warnings.push(
      'Amount is mapped together with Debit/Credit. Coverage uses Debit/Credit first; Amount is used only when both Debit and Credit are blank.',
    )
  }

  const headerCells = (rows[headerRow] ?? []).map((c) => cellToText(c))
  const voucherSeen = new Set<string>()
  let zeroCount = 0
  let bothSides = 0
  let invalidAmountRows = 0

  for (let rowIndex = dataStart; rowIndex <= dataEnd; rowIndex++) {
    const row = rows[rowIndex] ?? []
    const date = readOptionalText(row, mapping.date)
    const voucherNo = readOptionalText(row, mapping.voucherNo)
    const accountNo = readOptionalText(row, mapping.accountNo)
    const description = readOptionalText(row, mapping.description)

    const debitResult = readOptionalAmount(row, mapping.debit)
    const creditResult = readOptionalAmount(row, mapping.credit)
    const amountResult = readOptionalAmount(row, mapping.amount)

    if (debitResult.invalid || creditResult.invalid || amountResult.invalid) {
      invalidAmountRows += 1
      warnings.push(`Row ${rowIndex + 1}: amount value could not be read as a number and was treated as blank.`)
    }

    const debitRaw = debitResult.value
    const creditRaw = creditResult.value
    const amountRaw = amountResult.value

    const anyMappedContent =
      date ||
      voucherNo ||
      accountNo ||
      description ||
      debitRaw !== 0 ||
      creditRaw !== 0 ||
      amountRaw !== 0 ||
      row.some((cell) => cellToText(cell) !== '')

    if (!anyMappedContent) continue

    // Skip fully empty visual rows (no useful mapped or unmapped content)
    const hasUsefulValue =
      date ||
      voucherNo ||
      accountNo ||
      description ||
      debitRaw !== 0 ||
      creditRaw !== 0 ||
      amountRaw !== 0

    if (!hasUsefulValue) {
      // Keep rows that have other client columns filled
      const hasExtras = row.some((cell, colIndex) => {
        const mappedCols = Object.values(mapping)
        if (mappedCols.includes(colIndex)) return false
        return cellToText(cell) !== ''
      })
      if (!hasExtras) continue
    }

    const lowerDesc = description.toLowerCase()
    if (
      /total|subtotal|grand total|balance c\/f|balance b\/f|carried forward|brought forward/.test(
        lowerDesc,
      )
    ) {
      warnings.push(`Row ${rowIndex + 1} looks like a total/subtotal row.`)
    }

    if (
      (date && normalizeLoose(date) === 'date') ||
      (voucherNo && normalizeLoose(voucherNo) === 'voucherno') ||
      (accountNo &&
        (normalizeLoose(accountNo) === 'accountno' ||
          normalizeLoose(accountNo) === 'accountnumber'))
    ) {
      warnings.push(`Row ${rowIndex + 1} may be a repeated header.`)
      continue
    }

    let coverageAmount = 0
    let bothSidesWarning = false

    if (hasDebit || hasCredit) {
      const fromDrCr = coverageFromDebitCredit(debitRaw, creditRaw)
      coverageAmount = fromDrCr.coverageAmount
      bothSidesWarning = fromDrCr.bothSidesWarning
      if (coverageAmount === 0 && hasAmount) {
        coverageAmount = coverageFromAmount(amountRaw)
      }
    } else if (hasAmount) {
      coverageAmount = coverageFromAmount(amountRaw)
    }

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
      accountNo,
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
  if (invalidAmountRows > 0 && transactions.length === 0) {
    errors.push('Amount values could not be interpreted as numbers.')
  }

  return { transactions, errors, warnings }
}

function normalizeLoose(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function totalCoverageValue(transactions: LedgerTransaction[]): number {
  return transactions.reduce((sum, t) => sum + Math.abs(t.coverageAmount), 0)
}
