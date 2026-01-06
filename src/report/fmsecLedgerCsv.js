const fs = require('node:fs/promises')
const XLSX = require('xlsx')
const { parse, isValid } = require('date-fns')

function parseCsvLine(line) {
  const out = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]

    if (inQuotes) {
      if (ch === '"') {
        const next = line[i + 1]
        if (next === '"') {
          current += '"'
          i++
          continue
        }
        inQuotes = false
        continue
      }
      current += ch
      continue
    }

    if (ch === ',') {
      out.push(current)
      current = ''
      continue
    }

    if (ch === '"') {
      inQuotes = true
      continue
    }

    current += ch
  }

  out.push(current)
  return out
}

function normalizeHeaderCell(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''

  const collapsed = raw.replace(/\s+/g, ' ')
  const upper = collapsed.toUpperCase()

  // Known weird spacing headers in FMSEC exports.
  if (upper === 'PHP D E B I T') return 'PHP_DEBIT'
  if (upper === 'PHP C R E D I T') return 'PHP_CREDIT'

  return upper
    .replace(/\./g, '')
    .replace(/\s+/g, '_')
    .replace(/__+/g, '_')
}

function parseAmount(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value

  const raw = String(value).trim()
  if (!raw) return null

  // Ledger uses weird dashes/spaces for blanks.
  const looksBlank = raw === '-' || raw.replace(/[\s\u2007\u202F]/g, '') === '-' // figure space / narrow no-break
  if (looksBlank) return null

  const noSpaces = raw.replace(/[\s\u2007\u202F]/g, '')
  const isParenNegative = noSpaces.startsWith('(') && noSpaces.endsWith(')')
  const stripped = noSpaces.replace(/[(),]/g, '')

  if (!stripped) return null
  const num = Number(stripped)
  if (!Number.isFinite(num)) return null

  return isParenNegative ? -num : num
}

function parseLedgerDate(value) {
  if (!value) return null
  if (value instanceof Date && isValid(value)) return value

  // CSV parsed by SheetJS often yields Excel serial date numbers.
  // Example: 45307 => 2024-01-16
  if (typeof value === 'number' && Number.isFinite(value)) {
    const dc = XLSX.SSF.parse_date_code(value)
    if (dc && dc.y && dc.m && dc.d) {
      // Use UTC to avoid timezone day-shifts.
      return new Date(Date.UTC(dc.y, dc.m - 1, dc.d, 12, 0, 0))
    }
  }

  const raw = String(value).trim()
  if (!raw) return null

  // Sometimes the serial date comes through as a numeric string.
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const num = Number(raw)
    if (Number.isFinite(num)) {
      const dc = XLSX.SSF.parse_date_code(num)
      if (dc && dc.y && dc.m && dc.d) {
        return new Date(Date.UTC(dc.y, dc.m - 1, dc.d, 12, 0, 0))
      }
    }
  }

  // FMSEC exports mix formats:
  // - 01/16/2024 (month/day/year)
  // - 7-3-2024 (day-month-year)
  // We try a small set of explicit patterns.
  // Note: Some XLSX exports/formats show dates as 7/3/2024 while the CSV
  // version uses 7-3-2024 to mean day-month-year. We therefore prefer
  // day/month for slash dates first, then fall back to month/day.
  const patterns = ['d/M/yyyy', 'dd/MM/yyyy', 'M/d/yyyy', 'MM/dd/yyyy', 'd-M-yyyy', 'dd-MM-yyyy']

  for (const pattern of patterns) {
    const dt = parse(raw, pattern, new Date())
    if (isValid(dt)) return dt
  }

  return null
}

function isDividendRow(row) {
  const cd = String(row.CD ?? '').trim().toUpperCase()
  const particulars = String(row.PARTICULARS ?? '').toLowerCase()
  // FMSEC uses CM for cash dividends and also for bond coupon payments.
  return cd === 'CM' && (particulars.includes('cash dividend') || particulars.includes('coupon payment'))
}

function isTradeRow(row) {
  const cd = String(row.CD ?? '').trim().toUpperCase()
  return cd === 'BI' || cd === 'SI'
}

function coerceLedgerRow(rawRow) {
  const date = parseLedgerDate(rawRow.DATE)

  return {
    CD: String(rawRow.CD ?? '').trim(),
    NUMBER: String(rawRow.NUMBER ?? '').trim(),
    DATE: date,
    DUE_DATE: parseLedgerDate(rawRow.DUE_DATE),
    PARTICULARS: String(rawRow.PARTICULARS ?? '').trim(),
    SECURITY: String(rawRow.SECURITY ?? '').trim(),
    NO_OF_SHARES: parseAmount(rawRow['NO._OF_SHARES'] ?? rawRow['NO_OF_SHARES'] ?? rawRow['NO_Of_SHARES']),
    CURRENCY: String(rawRow.CURRENCY ?? '').trim(),
    UNIT_PRICE: parseAmount(rawRow.UNIT_PRICE),
    FX_AMT: parseAmount(rawRow.FX_AMT),
    FX_RUNNING_BAL: parseAmount(rawRow.FX_RUNNING_BAL),
    PHP_DEBIT: parseAmount(rawRow.PHP_DEBIT),
    PHP_CREDIT: parseAmount(rawRow.PHP_CREDIT),
    PHP_RUNNING_BAL: parseAmount(rawRow.PHP_RUNNING_BAL),
  }
}

function parseLedgerRowsFromWorksheet(worksheet) {
  // Important: keep raw cell values as-is. When `raw:false`, SheetJS may
  // coerce date-like strings (e.g. "4-1-2024") into incorrect JS Date objects
  // (we observed year 0024), which breaks year/month computations.
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true })
  if (!rows.length) return []

  const headerIndex = rows.findIndex((r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim().toUpperCase() === 'CD'))
  if (headerIndex === -1) {
    throw new Error('Could not find header row (CD, NUMBER, DATE, ...) in CSV')
  }

  const headerRow = rows[headerIndex].map(normalizeHeaderCell)

  const dataRows = []
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!Array.isArray(r) || r.length === 0) continue

    const obj = {}
    for (let c = 0; c < headerRow.length; c++) {
      const key = headerRow[c]
      if (!key) continue
      obj[key] = r[c]
    }

    // Skip fully blank lines
    if (!String(obj.CD ?? '').trim()) continue

    dataRows.push(coerceLedgerRow(obj))
  }

  return dataRows
}

function loadFmsecLedgerRowsFromCsvText(csvText) {
  const text = String(csvText ?? '')
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)

  const headerLineIndex = lines.findIndex((l) => l.trim().toUpperCase().startsWith('CD,NUMBER,DATE,'))
  if (headerLineIndex === -1) {
    throw new Error('Could not find header row (CD, NUMBER, DATE, ...) in CSV')
  }

  const headerCells = parseCsvLine(lines[headerLineIndex])
  const normalizedHeaders = headerCells.map(normalizeHeaderCell)

  const dataRows = []
  for (let i = headerLineIndex + 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i])
    const obj = {}
    for (let c = 0; c < normalizedHeaders.length; c++) {
      const key = normalizedHeaders[c]
      if (!key) continue
      obj[key] = cells[c]
    }

    if (!String(obj.CD ?? '').trim()) continue
    dataRows.push(coerceLedgerRow(obj))
  }

  return dataRows
}

function validateFmsecLedgerHeaders(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('No ledger rows found')
  }

  // This is intentionally not too strict: we only require the key fields we actually use.
  // As long as the upload can produce these fields, the report can be generated.
  const required = ['CD', 'DATE', 'PARTICULARS', 'PHP_DEBIT', 'PHP_CREDIT']
  const sample = rows[0] ?? {}
  const missing = required.filter((k) => !(k in sample))

  if (missing.length) {
    throw new Error(`Missing required columns: ${missing.join(', ')}`)
  }
}

async function loadFmsecLedgerRowsFromCsv(csvFilePath) {
  const buf = await fs.readFile(csvFilePath)
  const rows = loadFmsecLedgerRowsFromCsvText(buf.toString('utf8'))
  return rows
}

module.exports = {
  loadFmsecLedgerRowsFromCsv,
  loadFmsecLedgerRowsFromCsvText,
  parseLedgerRowsFromWorksheet,
  validateFmsecLedgerHeaders,
  isDividendRow,
  isTradeRow,
  parseAmount,
  parseLedgerDate,
}
