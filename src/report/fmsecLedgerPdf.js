const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const { parseAmount, validateFmsecLedgerHeaders } = require('./fmsecLedgerCsv')

const execFileAsync = promisify(execFile)

function ensurePdftotextAvailable() {
  // Best-effort check; we'll still surface a useful error if exec fails.
  const bin = process.env.PDFTOTEXT_BIN || 'pdftotext'
  return bin
}

async function pdfBufferToText(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('Missing PDF data')

  const bin = ensurePdftotextAvailable()
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'portview-pdf-'))
  const tmpPdfPath = path.join(tmpDir, `${crypto.randomUUID()}.pdf`)

  try {
    await fs.writeFile(tmpPdfPath, buffer)

    const { stdout } = await execFileAsync(
      bin,
      ['-layout', tmpPdfPath, '-'],
      {
        maxBuffer: 50 * 1024 * 1024,
        windowsHide: true,
      }
    )

    return String(stdout ?? '')
  } catch (err) {
    const msg = String(err?.message ?? err ?? '')
    // Common production issue: poppler-utils missing.
    if (/pdftotext.*not found|ENOENT/i.test(msg)) {
      throw new Error('pdftotext is required to parse PDF uploads (install poppler-utils)')
    }
    throw new Error(`Failed to extract PDF text: ${msg}`)
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

function parseReference(ref) {
  const raw = String(ref ?? '').trim()
  if (!raw) return { CD: '', NUMBER: '' }

  const m = raw.match(/^([A-Z]{1,6})-(\d+)$/)
  if (m) return { CD: m[1], NUMBER: m[2] }

  const idx = raw.indexOf('-')
  if (idx === -1) return { CD: raw, NUMBER: '' }

  return {
    CD: raw.slice(0, idx).trim(),
    NUMBER: raw.slice(idx + 1).trim(),
  }
}

function isTransactionStartLine(line) {
  return /^\s*\d{2}\/\d{2}\/\d{4}\s+\S+/.test(String(line ?? ''))
}

function parsePdfDateMmDdYyyy(value) {
  const s = String(value ?? '').trim()
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  const month = Number(m[1])
  const day = Number(m[2])
  const year = Number(m[3])
  if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) return null
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null
  // Use UTC noon to avoid local timezone day-shifts.
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
}

function findMoneyTokensWithIndex(line) {
  const s = String(line ?? '').replace(/\f/g, '')
  const re = /\(?-?\d{1,3}(?:,\d{3})*(?:\.\d{2})\)?/g
  const out = []
  let m
  while ((m = re.exec(s))) {
    out.push({ value: m[0], index: m.index })
  }
  return out
}

function normalizeMoney(n) {
  const num = parseAmount(n)
  if (num === null || num === undefined) return null
  if (!Number.isFinite(num)) return null
  return num < 0 ? -num : num
}

function extractMovementAmountFromPhpLine(blockLines) {
  const lines = Array.isArray(blockLines) ? blockLines : []
  // The statement typically prints the movement amount on the line containing "PHP",
  // with the balance on the far right. The first 2-decimal token is the movement.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = String(lines[i] ?? '')
    if (!/\bPHP\b/i.test(line)) continue

    const tokens = findMoneyTokensWithIndex(line)
    if (!tokens.length) continue

    // Common pattern on these PDF rows:
    //   <...> 0.0000 <movement> PHP <balance>
    // The 0.0000 becomes a misleading "0.00" token, and the last token is the balance.
    // Prefer the second-to-last token as the movement amount.
    const pick = tokens.length >= 2 ? tokens[tokens.length - 2] : tokens[0]
    const movement = normalizeMoney(pick.value)
    if (movement === null) continue
    return movement
  }
  return null
}

function extractParticulars(blockLines, { firstLineRemainder } = {}) {
  const parts = []
  if (firstLineRemainder) parts.push(String(firstLineRemainder).trim())

  for (let i = 1; i < blockLines.length; i++) {
    const line = String(blockLines[i] ?? '')

    // Amount lines usually include currency and/or are mostly numeric.
    const hasPhp = /\bPHP\b/i.test(line)
    const hasMoney = findMoneyTokensWithIndex(line).length > 0
    const mostlySpacesNumbers = line.trim() !== '' && /^[\d\s,().-]+$/.test(line.trim())

    if (hasPhp || (hasMoney && mostlySpacesNumbers)) continue

    const trimmed = line.trim()
    if (!trimmed) continue

    // Skip table separators that can appear between sections.
    if (/^[=\-]{6,}$/.test(trimmed)) continue

    parts.push(trimmed)
  }

  // Remove trailing columns that can bleed into the text.
  const joined = parts.join(' ').replace(/\s+/g, ' ').trim()

  // Drop any lingering separator fragments.
  const withoutSeparators = joined.replace(/\s*[=\-]{6,}\s*/g, ' ').replace(/\s+/g, ' ').trim()

  // We only need the descriptive text; strip common numeric-only tails.
  return withoutSeparators.replace(/\s+0\.\d{2,4}\s*$/, '').trim()
}

function parseTransactionBlock(blockLines, { debitColIndex, creditColIndex } = {}) {
  if (!Array.isArray(blockLines) || blockLines.length === 0) return null

  const first = String(blockLines[0])
  const m = first.match(/^\s*(\d{2}\/\d{2}\/\d{4})\s+(\S+)\s*(.*)$/)
  if (!m) return null

  const date = parsePdfDateMmDdYyyy(m[1])
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null

  const reference = m[2]
  const { CD, NUMBER } = parseReference(reference)

  let firstRemainder = m[3] ?? ''

  // If we have column positions, avoid pulling numeric columns into particulars.
  if (Number.isInteger(debitColIndex) && debitColIndex > 0 && first.length > debitColIndex) {
    firstRemainder = first.slice(first.indexOf(reference) + reference.length, debitColIndex).trim()
  }

  const PARTICULARS = extractParticulars(blockLines, { firstLineRemainder: firstRemainder })

  const movement = extractMovementAmountFromPhpLine(blockLines)
  const pUpper = String(PARTICULARS ?? '').trim().toUpperCase()
  const cdUpper = String(CD ?? '').trim().toUpperCase()

  // Map statement rows to the cashflow logic expected by monthlyCashflow.js.
  let debit = 0
  let credit = 0

  if (movement && Number.isFinite(movement)) {
    const isCashDividend = cdUpper === 'CM' && pUpper.includes('CASH DIVIDEND')
    const isCouponPayment = cdUpper === 'CM' && pUpper.includes('COUPON PAYMENT')
    const isFutureTransaction = cdUpper === 'OR' && pUpper.startsWith('FUTURE TRANSACTION')
    const isTrade = cdUpper === 'BI' || cdUpper === 'SI'
    const isNonCashDividend = cdUpper === 'IN' && pUpper.includes('STOCK DIVIDEND')
    const isBondPurchase = cdUpper === 'DM' && (pUpper.includes('PURCHASE OF RTB') || pUpper.includes('PHILIPPINE GOVERNMENT') || pUpper.includes('BOND '))

    if (isTrade || isNonCashDividend || isBondPurchase) {
      debit = 0
      credit = 0
    } else if (isCashDividend || isCouponPayment || isFutureTransaction) {
      credit = movement
    } else {
      debit = movement
    }
  }

  return {
    CD: String(CD ?? '').trim(),
    NUMBER: String(NUMBER ?? '').trim(),
    DATE: date,
    DUE_DATE: null,
    PARTICULARS: String(PARTICULARS ?? '').trim(),
    SECURITY: '',
    NO_OF_SHARES: null,
    CURRENCY: 'PHP',
    UNIT_PRICE: null,
    FX_AMT: null,
    FX_RUNNING_BAL: null,
    PHP_DEBIT: debit,
    PHP_CREDIT: credit,
    PHP_RUNNING_BAL: null,
  }
}

function parseFmsecLedgerRowsFromPdfText(pdfText) {
  const text = String(pdfText ?? '').replace(/\f/g, '')
  const lines = text.split(/\r?\n/)

  const rows = []

  let debitColIndex = null
  let creditColIndex = null

  let currentBlock = null

  const shouldEndTransactionSection = (line) => {
    const s = String(line ?? '')
    return (
      /ENDING\s+SECURITY\s+POSITION/i.test(s) ||
      /\bL\s*E\s*G\s*E\s*N\s*D\b/i.test(s) ||
      /This is a computer generated statement/i.test(s)
    )
  }

  const flush = () => {
    if (!currentBlock || currentBlock.length === 0) return
    const row = parseTransactionBlock(currentBlock, { debitColIndex, creditColIndex })
    if (row && String(row.CD ?? '').trim()) rows.push(row)
    currentBlock = null
  }

  for (const line of lines) {
    const s = String(line ?? '')

    // Once we reach the ending/legend section, the transaction table is finished.
    // Flush any pending block and stop parsing to avoid contaminating the last row.
    if (currentBlock && shouldEndTransactionSection(s)) {
      flush()
      currentBlock = null
      break
    }

    if (s.includes('PRICE') && s.includes('DEBIT')) {
      const idx = s.indexOf('DEBIT')
      if (idx !== -1) debitColIndex = idx
      continue
    }

    if (s.includes('CREDIT') && s.includes('BALANCE')) {
      const idx = s.indexOf('CREDIT')
      if (idx !== -1) creditColIndex = idx
      continue
    }

    if (isTransactionStartLine(s)) {
      flush()
      currentBlock = [s]
      continue
    }

    if (currentBlock) {
      // Keep accumulating until the next start line.
      if (s.trim() === '' && currentBlock.length > 0) {
        // Allow blanks inside block, but cap consecutive blanks.
        currentBlock.push(s)
      } else {
        currentBlock.push(s)
      }
    }
  }

  flush()

  // Ensure we at least match the shape expected by the cashflow report.
  validateFmsecLedgerHeaders(rows)

  return rows
}

async function loadFmsecLedgerRowsFromPdfBuffer({ buffer } = {}) {
  const text = await pdfBufferToText(buffer)
  return parseFmsecLedgerRowsFromPdfText(text)
}

module.exports = {
  pdfBufferToText,
  parseFmsecLedgerRowsFromPdfText,
  loadFmsecLedgerRowsFromPdfBuffer,
}
