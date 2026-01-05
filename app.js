require('dotenv').config()

const express = require('express')
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')

const { generateCashflowPdfFromRows } = require('./src/report/generateCashflowReport')
const { decodeBase64Payload, loadFmsecLedgerRowsFromBuffer } = require('./src/report/uploadedLedger')

const app = express()
const normalizeBasePath = (value) => {
    const raw = String(value || '').trim()
    if (!raw || raw === '/') return ''
    const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`
    const withoutTrailingSlash = withLeadingSlash.replace(/\/+$/, '')
    return withoutTrailingSlash === '/' ? '' : withoutTrailingSlash
}

const normalizeBaseUrl = (value) => {
    const raw = String(value || '').trim()
    if (!raw) return ''
    return raw.replace(/\/+$/, '')
}

const basePath = normalizeBasePath(process.env.BASE_PATH)
const baseUrl = normalizeBaseUrl(process.env.BASE_URL)
app.locals.basePath = basePath
app.locals.baseUrl = baseUrl
app.locals.publicUrl = baseUrl ? `${baseUrl}${basePath}` : basePath

const port = Number(process.env.PORT) || 6000

app.use(express.json({ limit: '50mb' }))

app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'))

if (basePath) {
    app.get('/', (req, res) => res.redirect(basePath))
}

const router = express.Router()

router.get('/', (req, res) => {
    res.render('index')
})

router.post('/api/report/fmsec/pdf', async (req, res) => {
    try {
            const { filename, dataBase64, year } = req.body ?? {}
            const resolvedYear = Number.isFinite(Number(year)) ? Number(year) : 2024

            const uploadBuffer = decodeBase64Payload(dataBase64)

            const storageDir = path.join(__dirname, 'storage')
            await fs.mkdir(storageDir, { recursive: true })

            const originalName = String(filename ?? 'upload')
            const safeName = originalName
                .replace(/[/\\]/g, '_')
                .replace(/[^a-zA-Z0-9._-]/g, '_')
                .slice(0, 120)
                .replace(/^_+/, '') || 'upload'

            const storedName = `${Date.now()}-${crypto.randomUUID()}-${safeName}`
            const storedPath = path.join(storageDir, storedName)
            await fs.writeFile(storedPath, uploadBuffer)

            const rows = loadFmsecLedgerRowsFromBuffer({ filename: originalName, buffer: uploadBuffer })
            const pdfBuffer = await generateCashflowPdfFromRows(rows, {
                    year: resolvedYear,
                    title: 'FMSEC Cashflow Report',
                    subtitle: 'Monthly Deposits / Withdrawals / Dividends',
                    filename,
            })

            res.setHeader('Content-Type', 'application/pdf')
            res.setHeader('Content-Disposition', 'inline; filename="cashflow.pdf"')
            res.send(pdfBuffer)
    } catch (err) {
            // eslint-disable-next-line no-console
            console.error(err)
            res.status(400).send(err?.message ? String(err.message) : 'Failed to generate PDF')
    }
})

app.use(basePath || '/', router)

app.listen(port, () => {
    console.log(`Portview listening on port ${port} (NODE_ENV=${process.env.NODE_ENV || 'development'})`)
})
