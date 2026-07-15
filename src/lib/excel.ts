import * as XLSX from 'xlsx'
import type { UploadedLedger, WorkbookSheet } from './types'

async function hashFileBuffer(buffer: ArrayBuffer): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', buffer)
    const bytes = [...new Uint8Array(digest)]
    return `sha256-${bytes.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)}`
  }
  const view = new Uint8Array(buffer)
  let h = 2166136261
  for (let i = 0; i < view.length; i++) {
    h ^= view[i]
    h = Math.imul(h, 16777619)
  }
  return `fnv1a-${(h >>> 0).toString(16).padStart(8, '0')}`
}

/**
 * Drop empty / phantom columns that Excel's used-range often invents
 * (blank col A, repeated Debit/Credit headers from merges with no data).
 *
 * - Fully empty columns are removed.
 * - A column with only one non-empty cell is kept only if that text is not
 *   a duplicate of an earlier column (allows empty Debit/Credit sides).
 */
export function trimSparseColumns(rows: unknown[][]): unknown[][] {
  if (!rows.length) return rows
  const width = Math.max(0, ...rows.map((r) => (Array.isArray(r) ? r.length : 0)))
  if (width === 0) return rows

  const counts = Array.from({ length: width }, () => 0)
  const firstText = Array.from({ length: width }, () => '')
  for (const row of rows) {
    if (!Array.isArray(row)) continue
    for (let c = 0; c < width; c++) {
      const text = cellToText(row[c])
      if (!text) continue
      counts[c] += 1
      if (!firstText[c]) firstText[c] = text
    }
  }

  const claimed = new Set<string>()
  const keepIdx: number[] = []
  for (let c = 0; c < width; c++) {
    if (counts[c] === 0) continue
    const key = firstText[c].toLowerCase().replace(/[^a-z0-9]+/g, '')
    if (counts[c] === 1 && key && claimed.has(key)) continue
    keepIdx.push(c)
    if (key) claimed.add(key)
  }
  if (keepIdx.length === 0) return rows

  return rows.map((row) => {
    if (!Array.isArray(row)) return []
    return keepIdx.map((i) => row[i] ?? '')
  })
}

export async function parseLedgerFile(file: File): Promise<UploadedLedger> {
  const buffer = await file.arrayBuffer()
  const fileHash = await hashFileBuffer(buffer)
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })

  const sheets: WorkbookSheet[] = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name]
    const rawRows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      raw: false,
      blankrows: false,
    }) as unknown[][]

    const rows = trimSparseColumns(
      rawRows.map((row) => (Array.isArray(row) ? row : [])),
    )

    return {
      name,
      rows,
    }
  })

  return {
    fileName: file.name,
    fileHash,
    sheets,
  }
}

export function cellToText(value: unknown): string {
  if (value == null) return ''
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10)
  }
  return String(value).trim()
}

export function parseAmount(value: unknown): number | null {
  if (value == null || value === '') return 0
  if (typeof value === 'number' && Number.isFinite(value)) return value

  const raw = String(value).trim()
  if (!raw) return 0

  const cleaned = raw
    .replace(/,/g, '')
    .replace(/\s/g, '')
    .replace(/Rs\.?/gi, '')
    .replace(/PKR/gi, '')
    .replace(/[()]/g, (m) => (m === '(' ? '-' : ''))

  if (!cleaned || cleaned === '-' || cleaned === '.') return 0
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null

  const num = Number(cleaned)
  return Number.isFinite(num) ? num : null
}
