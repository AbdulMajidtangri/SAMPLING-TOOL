import type { MappingConfidence, StandardField } from './types'

const SYNONYMS: Record<StandardField, string[]> = {
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
    'vchno',
    'vch',
    'docno',
    'documentno',
    'refno',
    'referenceno',
    'invoiceno',
    'billno',
    'transactionid',
    'vouchno',
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
  if (!normalized) return { score: 0, confidence: 'none' }

  const synonyms = SYNONYMS[field]
  if (synonyms.includes(normalized)) {
    return { score: 100, confidence: 'high' }
  }

  let best = 0
  for (const synonym of synonyms) {
    if (normalized.includes(synonym) || synonym.includes(normalized)) {
      best = Math.max(best, 80)
    }
    const distance = levenshtein(normalized, synonym)
    const maxLen = Math.max(normalized.length, synonym.length)
    const similarity = maxLen === 0 ? 0 : ((maxLen - distance) / maxLen) * 100
    best = Math.max(best, similarity)
  }

  if (best >= 90) return { score: best, confidence: 'high' }
  if (best >= 75) return { score: best, confidence: 'medium' }
  if (best >= 60) return { score: best, confidence: 'low' }
  return { score: best, confidence: 'none' }
}

export function detectHeaderRow(rows: unknown[][]): number {
  const fields: StandardField[] = [
    'date',
    'voucherNo',
    'description',
    'debit',
    'credit',
  ]
  let bestRow = 0
  let bestScore = -1

  const scanLimit = Math.min(rows.length, 30)
  for (let i = 0; i < scanLimit; i++) {
    const row = rows[i] ?? []
    const texts = row.map((cell) => String(cell ?? '').trim()).filter(Boolean)
    if (texts.length < 2) continue

    let score = 0
    for (const field of fields) {
      const match = texts
        .map((text) => scoreHeaderMatch(text, field).score)
        .reduce((a, b) => Math.max(a, b), 0)
      score += match
    }

    if (score > bestScore) {
      bestScore = score
      bestRow = i
    }
  }

  return bestRow
}

export function suggestMappings(
  headers: string[],
): Record<StandardField, { columnIndex: number | null; confidence: MappingConfidence; header?: string }> {
  const fields: StandardField[] = [
    'date',
    'voucherNo',
    'description',
    'debit',
    'credit',
  ]
  const used = new Set<number>()
  const result = {} as Record<
    StandardField,
    { columnIndex: number | null; confidence: MappingConfidence; header?: string }
  >

  for (const field of fields) {
    let bestIndex: number | null = null
    let bestScore = 0
    let bestConfidence: MappingConfidence = 'none'
    let bestHeader: string | undefined

    headers.forEach((header, index) => {
      if (used.has(index) || !header.trim()) return
      const match = scoreHeaderMatch(header, field)
      if (match.score > bestScore) {
        bestScore = match.score
        bestIndex = index
        bestConfidence = match.confidence
        bestHeader = header
      }
    })

    if (bestIndex != null && bestConfidence !== 'none') {
      used.add(bestIndex)
      result[field] = {
        columnIndex: bestIndex,
        confidence: bestConfidence,
        header: bestHeader,
      }
    } else {
      result[field] = { columnIndex: null, confidence: 'none' }
    }
  }

  return result
}
