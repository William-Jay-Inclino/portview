const path = require('node:path')

const { loadFmsecLedgerRowsFromCsv } = require('./fmsecLedgerCsv')
const { computeMonthlyCashflow, computeCashflowTotals } = require('./monthlyCashflow')
const { renderCashflowReportHtml } = require('./renderCashflowHtml')
const { renderPdfFromHtml } = require('./pdf')

function buildCashflowReportModelFromRows(rows, { year } = {}) {
  const months = computeMonthlyCashflow(rows, { year, dateField: 'DATE' })
  const totals = computeCashflowTotals(months)
  return { months, totals }
}

async function buildCashflowReportModelFromCsv(csvFilePath, { year } = {}) {
  const rows = await loadFmsecLedgerRowsFromCsv(csvFilePath)
  return buildCashflowReportModelFromRows(rows, { year })
}

async function generateCashflowPdfFromCsv(csvFilePath, { year, title, subtitle } = {}) {
  const { months, totals } = await buildCashflowReportModelFromCsv(csvFilePath, { year })

  const resolvedTitle = title ?? `Portfolio Cashflow Report${year ? ` (${year})` : ''}`
  const resolvedSubtitle = subtitle ?? path.basename(csvFilePath)

  const html = renderCashflowReportHtml({
    title: resolvedTitle,
    subtitle: resolvedSubtitle,
    months,
    totals,
  })

  return renderPdfFromHtml(html)
}

async function generateCashflowPdfFromRows(rows, { year, title, subtitle, filename } = {}) {
  const { months, totals } = buildCashflowReportModelFromRows(rows, { year })

  const resolvedTitle = title ?? `Portfolio Cashflow Report${year ? ` (${year})` : ''}`
  const resolvedSubtitle = subtitle ?? (filename ? path.basename(filename) : '')

  const html = renderCashflowReportHtml({
    title: resolvedTitle,
    subtitle: resolvedSubtitle,
    months,
    totals,
  })

  return renderPdfFromHtml(html)
}

module.exports = {
  buildCashflowReportModelFromRows,
  buildCashflowReportModelFromCsv,
  generateCashflowPdfFromCsv,
  generateCashflowPdfFromRows,
}
