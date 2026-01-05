const XLSX = require('xlsx')

const {
  loadFmsecLedgerRowsFromCsvText,
  parseLedgerRowsFromWorksheet,
  validateFmsecLedgerHeaders,
} = require('./fmsecLedgerCsv')

function getExtension(filename) {
  const name = String(filename ?? '')
  const idx = name.lastIndexOf('.')
  return idx === -1 ? '' : name.slice(idx + 1).toLowerCase()
}

function decodeBase64Payload(dataBase64) {
  if (!dataBase64) throw new Error('Missing file data')

  // Accept either raw base64 or a data URL.
  const s = String(dataBase64)
  const commaIdx = s.indexOf(',')
  const base64 = s.startsWith('data:') && commaIdx !== -1 ? s.slice(commaIdx + 1) : s

  return Buffer.from(base64, 'base64')
}

function pickFirstSheet(workbook) {
  const sheetName = workbook.SheetNames?.[0]
  if (!sheetName) throw new Error('XLSX has no sheets')
  const worksheet = workbook.Sheets[sheetName]
  if (!worksheet) throw new Error('XLSX first sheet missing')
  return worksheet
}

function loadFmsecLedgerRowsFromBuffer({ filename, buffer }) {
  const ext = getExtension(filename)
  const buf = buffer

  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new Error('Missing file data')

  if (ext === 'csv') {
    const text = buf.toString('utf8')
    const rows = loadFmsecLedgerRowsFromCsvText(text)
    validateFmsecLedgerHeaders(rows)
    return rows
  }

  if (ext === 'xlsx' || ext === 'xls') {
    const wb = XLSX.read(buf, { type: 'buffer' })
    const ws = pickFirstSheet(wb)
    const rows = parseLedgerRowsFromWorksheet(ws)
    validateFmsecLedgerHeaders(rows)
    return rows
  }

  throw new Error('Unsupported file type. Upload a .csv or .xlsx')
}

function loadFmsecLedgerRowsFromUpload({ filename, dataBase64 }) {
  const buf = decodeBase64Payload(dataBase64)
  return loadFmsecLedgerRowsFromBuffer({ filename, buffer: buf })
}

module.exports = {
  getExtension,
  decodeBase64Payload,
  loadFmsecLedgerRowsFromBuffer,
  loadFmsecLedgerRowsFromUpload,
}
