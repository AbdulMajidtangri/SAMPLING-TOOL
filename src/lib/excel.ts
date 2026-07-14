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

export async function parseLedgerFile(file: File): Promise<UploadedLedger> {
  const buffer = await file.arrayBuffer()
  const fileHash = await hashFileBuffer(buffer)
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })

  const sheets: WorkbookSheet[] = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name]
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      raw: false,
    }) as unknown[][]

    return {
      name,
      rows: rows.map((row) => (Array.isArray(row) ? row : [])),
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
