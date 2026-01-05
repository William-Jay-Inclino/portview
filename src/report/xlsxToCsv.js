const fs = require('node:fs/promises')
const XLSX = require('xlsx')

const pad2 = (n) => String(n).padStart(2, '0')

const formatDateIso = (dt) => {
    const d = dt instanceof Date ? dt : new Date(dt)
    if (Number.isNaN(d.getTime())) return ''
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

const csvEscape = (value) => {
    if (value === null || value === undefined) return ''
    if (value instanceof Date) return formatDateIso(value)
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'

    const s = String(value)
    if (!s) return ''

    const needsQuotes = /[",\n\r]/.test(s)
    if (!needsQuotes) return s
    return `"${s.replace(/"/g, '""')}"`
}

const resolveSheetName = (workbook, sheet) => {
    const names = workbook.SheetNames || []
    if (!names.length) throw new Error('Workbook has no sheets')

    if (typeof sheet === 'string' && sheet.trim()) {
        const name = sheet.trim()
        if (!names.includes(name)) {
            throw new Error(`Sheet not found: ${name}`)
        }
        return name
    }

    if (Number.isInteger(sheet)) {
        const idx = sheet
        if (idx < 0 || idx >= names.length) {
            throw new Error(`Sheet index out of range: ${idx}`)
        }
        return names[idx]
    }

    return names[0]
}

/**
 * Convert an XLSX buffer to CSV.
 *
 * @param {object} params
 * @param {Buffer} params.buffer - Raw .xlsx file bytes
 * @param {string|number} [params.sheet] - Sheet name or 0-based index (defaults to first sheet)
 * @param {object} [params.readOptions] - Passed to XLSX.read (overrides defaults)
 * @param {object} [params.csvOptions] - Passed to XLSX.utils.sheet_to_csv
 * @returns {string} CSV text
 */
const xlsxBufferToCsv = ({ buffer, sheet, readOptions, csvOptions } = {}) => {
    if (!Buffer.isBuffer(buffer)) throw new TypeError('buffer must be a Buffer')

    const workbook = XLSX.read(buffer, {
        type: 'buffer',
        dense: true,
        cellDates: false,
        ...readOptions,
    })

    const sheetName = resolveSheetName(workbook, sheet)
    const worksheet = workbook.Sheets[sheetName]
    if (!worksheet) throw new Error(`Worksheet missing: ${sheetName}`)

    // Build CSV from formatted cell text when available (`cell.w`).
    // This keeps the user-visible date strings (e.g. 7/3/2024) rather than
    // Excel serials, allowing the downstream FMSEC date parser to apply the
    // same day/month rules as the CSV export.
    const rows = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        raw: true,
        defval: '',
    })

    const maxCols = rows.reduce((acc, row) => Math.max(acc, Array.isArray(row) ? row.length : 0), 0)
    const output = []

    for (let r = 0; r < rows.length; r++) {
        const line = []
        for (let c = 0; c < maxCols; c++) {
            const addr = XLSX.utils.encode_cell({ r, c })
            const denseCell = Array.isArray(worksheet?.[r]) ? worksheet[r][c] : undefined
            const cell = worksheet[addr] ?? denseCell
            const value = cell?.w ?? cell?.v ?? ''
            line.push(csvEscape(value))
        }
        output.push(line.join(','))
    }

    return output.join('\n')
}

/**
 * Convert an XLSX file on disk to CSV.
 *
 * @param {object} params
 * @param {string} params.filePath
 * @param {string|number} [params.sheet]
 * @param {object} [params.readOptions]
 * @param {object} [params.csvOptions]
 */
const xlsxFileToCsv = async ({ filePath, sheet, readOptions, csvOptions } = {}) => {
    if (!filePath) throw new TypeError('filePath is required')
    const buffer = await fs.readFile(filePath)
    return xlsxBufferToCsv({ buffer, sheet, readOptions, csvOptions })
}

/**
 * Convert an XLSX file on disk to a CSV file.
 *
 * @param {object} params
 * @param {string} params.inputPath
 * @param {string} params.outputPath
 * @param {string|number} [params.sheet]
 * @param {object} [params.readOptions]
 * @param {object} [params.csvOptions]
 */
const writeCsvFromXlsxFile = async ({ inputPath, outputPath, sheet, readOptions, csvOptions } = {}) => {
    if (!inputPath) throw new TypeError('inputPath is required')
    if (!outputPath) throw new TypeError('outputPath is required')

    const csv = await xlsxFileToCsv({ filePath: inputPath, sheet, readOptions, csvOptions })
    await fs.writeFile(outputPath, csv)
}

module.exports = {
    xlsxBufferToCsv,
    xlsxFileToCsv,
    writeCsvFromXlsxFile,
}
