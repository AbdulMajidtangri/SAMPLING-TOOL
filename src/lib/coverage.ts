import { cellToText, parseAmount } from './excel'
import type {
  CoverageResolution,
  LedgerTransaction,
  StandardField,
} from './types'

export function coverageFromDebitCredit(
  debit: number,
  credit: number,
): { coverageAmount: number; bothSidesWarning: boolean; needsResolution: boolean } {
  const d = Math.abs(debit)
  const c = Math.abs(credit)

  if (d > 0 && c > 0) {
    return { coverageAmount: 0, bothSidesWarning: true, needsResolution: true }
  }
  if (d > 0) return { coverageAmount: d, bothSidesWarning: false, needsResolution: false }
  if (c > 0) return { coverageAmount: c, bothSidesWarning: false, needsResolution: false }
  return { coverageAmount: 0, bothSidesWarning: false, needsResolution: false }
}

export function applyCoverageResolution(
  debit: number,
  credit: number,
  resolution: CoverageResolution,
): number {
  const d = Math.abs(debit)
  const c = Math.abs(credit)
  switch (resolution) {
    case 'useDebit':
      return d
    case 'useCredit':
      return c
    case 'useMax':
      return Math.max(d, c)
    case 'exclude':
      return 0
  }
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
): { value: number; invalid: boolean; blank: boolean } {
  if (columnIndex == null) return { value: 0, invalid: false, blank: true }
  const raw = row[columnIndex]
  if (raw == null || String(raw).trim() === '') {
    return { value: 0, invalid: false, blank: true }
  }
  const parsed = parseAmount(raw)
  if (parsed == null) return { value: 0, invalid: true, blank: false }
  return { value: parsed, invalid: false, blank: false }
}

function normalizeLoose(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function looksLikeRepeatedHeader(parts: string[]): boolean {
  const joined = parts.map(normalizeLoose).filter(Boolean)
  const markers = ['date', 'voucherno', 'description', 'debit', 'credit', 'accountno']
  let hits = 0
  for (const m of markers) {
    if (joined.includes(m)) hits += 1
  }
  return hits >= 2
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

  const headerCells = (rows[headerRow] ?? []).map((c) => cellToText(c))
  const voucherSeen = new Set<string>()
  let zeroCount = 0
  let bothSides = 0
  let negativeCount = 0
  let invalidAmountRows = 0
  let currencyMix = false
  const currencyTokens = new Set<string>()

  for (let rowIndex = dataStart; rowIndex <= dataEnd; rowIndex++) {
    const row = rows[rowIndex] ?? []
    const date = readOptionalText(row, mapping.date)
    const voucherNo = readOptionalText(row, mapping.voucherNo)
    const accountNo = readOptionalText(row, mapping.accountNo)
    const description = readOptionalText(row, mapping.description)

    const debitResult = readOptionalAmount(row, mapping.debit)
    const creditResult = readOptionalAmount(row, mapping.credit)
    const amountResult = readOptionalAmount(row, mapping.amount)

    for (const col of [mapping.debit, mapping.credit, mapping.amount]) {
      if (col == null) continue
      const raw = String(row[col] ?? '')
      const token = raw.match(/Rs\.?|PKR|USD|EUR|£|\$/i)?.[0]
      if (token) currencyTokens.add(token.toUpperCase().replace('.', ''))
    }

    if (debitResult.invalid || creditResult.invalid || amountResult.invalid) {
      invalidAmountRows += 1
      warnings.push(
        `Row ${rowIndex + 1}: amount value could not be read as a number and was treated as blank.`,
      )
    }

    const debitRaw = debitResult.value
    const creditRaw = creditResult.value
    const amountRaw = amountResult.value

    if (debitRaw < 0 || creditRaw < 0 || amountRaw < 0) negativeCount += 1

    const hasUsefulValue =
      date ||
      voucherNo ||
      accountNo ||
      description ||
      debitRaw !== 0 ||
      creditRaw !== 0 ||
      amountRaw !== 0

    if (!hasUsefulValue) {
      const hasExtras = row.some((cell, colIndex) => {
        const mappedCols = Object.values(mapping)
        if (mappedCols.includes(colIndex)) return false
        return cellToText(cell) !== ''
      })
      if (!hasExtras) continue
    }

    const isRepeatedHeader = looksLikeRepeatedHeader([
      date,
      voucherNo,
      accountNo,
      description,
      cellToText(row[mapping.debit ?? -1]),
      cellToText(row[mapping.credit ?? -1]),
    ])

    const lowerDesc = description.toLowerCase()
    const looksLikeTotal =
      /^(total|subtotal|grand total|balance c\/f|balance b\/f|carried forward|brought forward)\b/i.test(
        lowerDesc,
      ) ||
      /total|subtotal|grand total|balance c\/f|balance b\/f|carried forward|brought forward/.test(
        lowerDesc,
      )

    if (looksLikeTotal) {
      warnings.push(`Row ${rowIndex + 1} looks like a total/subtotal row.`)
    }
    if (isRepeatedHeader) {
      warnings.push(`Row ${rowIndex + 1} may be a repeated header.`)
    }

    let coverageAmount = 0
    let bothSidesWarning = false
    let needsCoverageResolution = false

    if (hasDebit || hasCredit) {
      const fromDrCr = coverageFromDebitCredit(debitRaw, creditRaw)
      coverageAmount = fromDrCr.coverageAmount
      bothSidesWarning = fromDrCr.bothSidesWarning
      needsCoverageResolution = fromDrCr.needsResolution
      if (coverageAmount === 0 && !needsCoverageResolution && hasAmount) {
        coverageAmount = Math.abs(amountRaw)
      }
    } else if (hasAmount) {
      coverageAmount = Math.abs(amountRaw)
    }

    if (bothSidesWarning) bothSides += 1
    if (coverageAmount === 0) zeroCount += 1

    const idKey = voucherNo || accountNo
    if (idKey) {
      if (voucherSeen.has(idKey)) {
        warnings.push(`Duplicate voucher/document/ID number: ${idKey}`)
      }
      voucherSeen.add(idKey)
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
      amountRaw,
      coverageAmount,
      bothSidesWarning,
      needsCoverageResolution,
      isRepeatedHeader,
      looksLikeTotal,
      excluded: isRepeatedHeader, // default exclude repeated headers; auditor can restore
      exclusionReason: isRepeatedHeader
        ? 'Auto-excluded: appears to be a repeated header row'
        : '',
      extras,
    })
  }

  if (currencyTokens.size > 1) {
    currencyMix = true
    warnings.push(
      `Possible mixed currencies detected (${[...currencyTokens].join(', ')}). Confirm amount treatment.`,
    )
  }
  void currencyMix

  if (bothSides > 0) {
    warnings.push(
      `${bothSides} row(s) have both Debit and Credit values. Resolve each row before confirming population.`,
    )
  }
  if (negativeCount > 0) {
    warnings.push(
      `${negativeCount} row(s) contain negative amounts. Coverage uses absolute values.`,
    )
  }
  if (transactions.length > 0 && zeroCount / transactions.length >= 0.2) {
    warnings.push('Large number of zero-value rows found.')
  }
  if (invalidAmountRows > 0 && transactions.filter((t) => !t.excluded).length === 0) {
    errors.push('Amount values could not be interpreted as numbers.')
  }

  return { transactions, errors, warnings }
}

export function activeTransactions(
  transactions: LedgerTransaction[],
): LedgerTransaction[] {
  return transactions.filter((t) => !t.excluded)
}

export function totalCoverageValue(transactions: LedgerTransaction[]): number {
  return activeTransactions(transactions).reduce(
    (sum, t) => sum + Math.abs(t.coverageAmount),
    0,
  )
}

export function unresolvedBothSides(transactions: LedgerTransaction[]): number {
  return activeTransactions(transactions).filter((t) => t.needsCoverageResolution)
    .length
}

export function resolveTransactionCoverage(
  tx: LedgerTransaction,
  resolution: CoverageResolution,
): LedgerTransaction {
  if (resolution === 'exclude') {
    return {
      ...tx,
      excluded: true,
      exclusionReason: 'Excluded: both Debit and Credit populated',
      coverageResolution: resolution,
      needsCoverageResolution: false,
      coverageAmount: 0,
    }
  }
  return {
    ...tx,
    coverageResolution: resolution,
    needsCoverageResolution: false,
    bothSidesWarning: true,
    coverageAmount: applyCoverageResolution(tx.debit, tx.credit, resolution),
    excluded: false,
    exclusionReason: '',
  }
}
