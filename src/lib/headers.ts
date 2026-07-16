import type {
  FieldMappingState,
  MappingCandidate,
  MappingConfidence,
  StandardField,
} from './types'
import { MAPPING_FIELD_ORDER, POSITIONAL_FIELD_ORDER } from './types'
import { cellToText, parseAmount } from './excel'

export const SYNONYMS: Record<StandardField, string[]> = {
  date: [
    'date',
    'data',
    'postingdate',
    'transactiondate',
    'voucherdate',
    'documentdate',
    'invoicedate',
  ],
  voucherNo: [
    'voucherno',
    'vouchernumber',
    'vouchernum',
    'voucher',
    'vchno',
    'vch',
    'vrno',
    'vr',
    'vno',
    'docno',
    'documentno',
    'refno',
    'referenceno',
    'invoiceno',
    'billno',
    'transactionid',
    'vouchno',
  ],
  accountNo: [
    'accountno',
    'accountnumber',
    'account',
    'accountcode',
    'acno',
    'acnumber',
    'glcode',
    'glaccount',
    'ledgercode',
  ],
  description: [
    'description',
    'narration',
    'particulars',
    'details',
    'remarks',
    'memo',
    'explanation',
    'descrip',
    'descriptiondetails',
  ],
  debit: ['debit', 'dr', 'debitamount', 'debitvalue', 'debitrs', 'debitpkr'],
  credit: [
    'credit',
    'cr',
    'creditamount',
    'creditvalue',
    'creditrs',
    'creditpkr',
    'creadit',
  ],
  amount: [
    'amount',
    'value',
    'amt',
    'transactionamount',
    'paymentamount',
    'netamount',
    'grossamount',
    'localamount',
  ],
  riskLevel: [
    'risklevel',
    'risk',
    'riskclassification',
    'riskscore',
    'riskcategory',
    'classification',
  ],
}

export function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim()
}

function levenshtein(a: string, b: string): number {
  const matrix = Array.from({ length: a.length + 1 }, () =>
    Array(b.length + 1).fill(0),
  )
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      )
    }
  }
  return matrix[a.length][b.length]
}

export function scoreHeaderMatch(
  header: string,
  field: StandardField,
): { score: number; confidence: MappingConfidence } {
  const normalized = normalizeHeader(header)
  if (!normalized || normalized.startsWith('column')) {
    return { score: 0, confidence: 'none' }
  }

  // Never map Credit↔Debit across each other (debitrs ≈ creditrs by edit distance)
  if (field === 'debit' && normalized.includes('credit')) {
    return { score: 0, confidence: 'none' }
  }
  if (field === 'credit' && normalized.includes('debit')) {
    return { score: 0, confidence: 'none' }
  }

  const synonyms = SYNONYMS[field]
  if (synonyms.includes(normalized)) {
    return { score: 100, confidence: 'high' }
  }

  let best = 0
  for (const synonym of synonyms) {
    // Short tokens (dr/cr) must be exact — avoid "cr" matching inside "description"
    if (synonym.length <= 2) {
      if (normalized === synonym) best = Math.max(best, 100)
      continue
    }
    if (normalized.includes(synonym) || synonym.includes(normalized)) {
      best = Math.max(best, 82)
    }
    const distance = levenshtein(normalized, synonym)
    const maxLen = Math.max(normalized.length, synonym.length)
    const similarity = maxLen === 0 ? 0 : ((maxLen - distance) / maxLen) * 100
    best = Math.max(best, similarity)
  }

  if (best >= 92) return { score: best, confidence: 'high' }
  if (best >= 75) return { score: best, confidence: 'medium' }
  if (best >= 60) return { score: best, confidence: 'low' }
  return { score: best, confidence: 'none' }
}

/** Clear date-column name (avoids weak fuzzy hits like Voucher No ≈ voucherdate). */
export function isClearDateHeader(header: string): boolean {
  if (!header.trim()) return false
  const normalized = normalizeHeader(header)
  if (!normalized || normalized.startsWith('column')) return false

  const synonyms = SYNONYMS.date
  if (synonyms.includes(normalized)) return true
  if (normalized.includes('date') || normalized === 'data') return true

  return scoreHeaderMatch(header, 'date').confidence === 'high'
}

/**
 * True when any header is clearly a date column.
 */
export function hasDateLikeHeader(headers: string[]): boolean {
  return headers.some((header) => isClearDateHeader(header))
}

function columnLooksLikeDates(values: string[]): boolean {
  let hits = 0
  for (const v of values) {
    if (!v) continue
    if (/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(v) || !Number.isNaN(Date.parse(v))) {
      hits += 1
    }
  }
  return hits >= Math.max(1, Math.floor(values.length * 0.4))
}

function columnLooksLikeAmounts(values: string[]): boolean {
  let hits = 0
  for (const v of values) {
    if (!v) continue
    if (parseAmount(v) != null) hits += 1
  }
  return hits >= Math.max(1, Math.floor(values.length * 0.5))
}

function sampleColumnValues(
  rows: unknown[][],
  headerRow: number,
  colIndex: number,
  limit = 12,
): string[] {
  const out: string[] = []
  for (let r = headerRow + 1; r < rows.length && out.length < limit; r++) {
    const text = cellToText(rows[r]?.[colIndex])
    if (text) out.push(text)
  }
  return out
}

export function detectHeaderRow(rows: unknown[][]): number {
  let bestRow = 0
  let bestScore = -1
  const scanLimit = Math.min(rows.length, 30)

  for (let i = 0; i < scanLimit; i++) {
    const texts = (rows[i] ?? [])
      .map((cell) => String(cell ?? '').trim())
      .filter(Boolean)
    if (texts.length < 2) continue

    let score = 0
    for (const field of MAPPING_FIELD_ORDER) {
      score += texts
        .map((text) => scoreHeaderMatch(text, field).score)
        .reduce((a, b) => Math.max(a, b), 0)
    }
    if (score > bestScore) {
      bestScore = score
      bestRow = i
    }
  }
  return bestRow
}

export function detectDataEnd(rows: unknown[][], headerRow: number): number {
  let last = headerRow
  for (let i = headerRow + 1; i < rows.length; i++) {
    const hasContent = (rows[i] ?? []).some((cell) => String(cell ?? '').trim() !== '')
    if (hasContent) last = i
  }
  return Math.max(last, Math.min(headerRow + 1, Math.max(rows.length - 1, 0)))
}

function emptyMapping(): FieldMappingState {
  return {
    columnIndex: null,
    confidence: 'none',
    candidates: [],
    needsAuditorChoice: false,
  }
}

export function suggestMappings(
  headers: string[],
  rows: unknown[][] = [],
  headerRow = 0,
): Record<StandardField, FieldMappingState> {
  const result = {} as Record<StandardField, FieldMappingState>
  const used = new Set<number>()

  for (const field of MAPPING_FIELD_ORDER) {
    const candidates: MappingCandidate[] = []

    headers.forEach((header, index) => {
      if (!header.trim()) return
      // Skip weak fuzzy date matches (e.g. Voucher No ≈ voucherdate)
      if (field === 'date' && !isClearDateHeader(header)) return

      let match = scoreHeaderMatch(header, field)
      if (match.confidence === 'none') return

      // Data-type boost / demote
      if (rows.length) {
        const sample = sampleColumnValues(rows, headerRow, index)
        if (field === 'date' && columnLooksLikeDates(sample)) {
          match = {
            score: Math.min(100, match.score + 8),
            confidence: match.confidence === 'low' ? 'medium' : match.confidence,
          }
        }
        if (
          (field === 'debit' || field === 'credit' || field === 'amount') &&
          columnLooksLikeAmounts(sample)
        ) {
          match = {
            score: Math.min(100, match.score + 6),
            confidence: match.confidence === 'low' ? 'medium' : match.confidence,
          }
        }
        if (field === 'date' && columnLooksLikeAmounts(sample) && !columnLooksLikeDates(sample)) {
          match = { score: match.score - 20, confidence: 'low' }
        }
      }

      if (match.confidence !== 'none' && match.score >= 60) {
        candidates.push({
          columnIndex: index,
          header,
          score: match.score,
          confidence: match.confidence,
        })
      }
    })

    candidates.sort((a, b) => b.score - a.score)

    // Same header text on multiple columns (merged Excel cells) → keep best only
    const collapsed: MappingCandidate[] = []
    const seenHeader = new Set<string>()
    for (const c of candidates) {
      const key = normalizeHeader(c.header) || `col${c.columnIndex}`
      if (seenHeader.has(key)) continue
      seenHeader.add(key)
      collapsed.push(c)
    }
    candidates.length = 0
    candidates.push(...collapsed)

    // Multiple strong date-like matches → auditor must choose (Case 10)
    const strong = candidates.filter((c) => c.score >= 75)
    const multipleStrong =
      (field === 'date' || field === 'voucherNo') && strong.length > 1

    if (multipleStrong) {
      result[field] = {
        columnIndex: null,
        confidence: 'medium',
        candidates: strong,
        needsAuditorChoice: true,
      }
      continue
    }

    const best = candidates[0]
    if (!best || used.has(best.columnIndex)) {
      result[field] = emptyMapping()
      continue
    }

    used.add(best.columnIndex)
    result[field] = {
      columnIndex: best.columnIndex,
      confidence: best.confidence,
      candidates: candidates.slice(0, 5),
      needsAuditorChoice: best.confidence === 'medium' || best.confidence === 'low',
    }
  }

  // If Debit or Credit mapped, clear Amount suggestion to avoid confusion
  if (result.debit.columnIndex != null || result.credit.columnIndex != null) {
    if (result.amount.columnIndex != null) {
      used.delete(result.amount.columnIndex)
    }
    result.amount = emptyMapping()
  }

  return result
}

/**
 * Fill still-unmapped core fields from unused columns left-to-right in
 * Date → Voucher No → Description → Debit → Credit order.
 * Name-based mappings are kept; Account No / Amount stay optional.
 */
export function fillUnmappedByColumnOrder(
  mapping: Record<StandardField, FieldMappingState>,
  columnCount: number,
): Record<StandardField, FieldMappingState> {
  const result = { ...mapping }
  for (const field of MAPPING_FIELD_ORDER) {
    result[field] = { ...mapping[field] }
  }

  const used = new Set<number>()
  for (const field of MAPPING_FIELD_ORDER) {
    const idx = result[field].columnIndex
    if (idx != null) used.add(idx)
  }

  for (const field of POSITIONAL_FIELD_ORDER) {
    if (result[field].columnIndex != null) continue
    let next = 0
    while (next < columnCount && used.has(next)) next += 1
    if (next >= columnCount) break
    used.add(next)
    result[field] = {
      ...result[field],
      columnIndex: next,
      confidence: result[field].confidence === 'none' ? 'low' : result[field].confidence,
      needsAuditorChoice: false,
    }
  }

  return result
}

/**
 * Hard-stop checks for required column mapping (brief §7 / §28).
 * Returns error messages — empty array means mapping is complete enough to continue.
 * Date is required only when a date-like header is present (pass `headers` to enable).
 */
export function validateRequiredMappings(
  mapping: Record<StandardField, { columnIndex: number | null }>,
  headers?: string[],
): string[] {
  const errors: string[] = []

  const dateRequired = headers == null || hasDateLikeHeader(headers)
  if (dateRequired && mapping.date.columnIndex == null) {
    errors.push(
      'Date is required. Map the correct date column (if multiple dates exist, choose one).',
    )
  }
  if (mapping.description.columnIndex == null) {
    errors.push('Description is required.')
  }

  const hasVoucher = mapping.voucherNo.columnIndex != null
  const hasAltId = mapping.accountNo.columnIndex != null
  if (!hasVoucher && !hasAltId) {
    errors.push(
      'Voucher No is missing. Map Voucher No or an alternative unique ID field (e.g. Account No).',
    )
  }

  const hasDebit = mapping.debit.columnIndex != null
  const hasCredit = mapping.credit.columnIndex != null
  const hasAmount = mapping.amount.columnIndex != null
  if (!(hasDebit && hasCredit) && !hasAmount) {
    if (!hasDebit && !hasCredit) {
      errors.push('Map Debit and Credit, or map a single Amount column.')
    } else {
      errors.push('Both Debit and Credit must be mapped (or use Amount instead).')
    }
  }

  return errors
}

/** Fields that still need an explicit auditor choice (multiple strong matches). */
export function unresolvedAuditorChoices(
  mapping: Record<StandardField, { columnIndex: number | null; needsAuditorChoice?: boolean }>,
  headers?: string[],
): StandardField[] {
  const dateRequired = headers == null || hasDateLikeHeader(headers)
  return MAPPING_FIELD_ORDER.filter(
    (field) =>
      mapping[field].needsAuditorChoice === true ||
      (mapping[field].columnIndex == null &&
        (field === 'voucherNo' || (field === 'date' && dateRequired))),
  )
}
