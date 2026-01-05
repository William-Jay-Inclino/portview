const { isDividendRow, isTradeRow } = require('./fmsecLedgerCsv')

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function initMonthRow(monthIndex) {
  return { month: MONTH_LABELS[monthIndex] ?? String(monthIndex + 1), deposit: 0, withdraw: 0, dividends: 0 }
}

function addMoney(target, amount) {
  if (!amount || !Number.isFinite(amount)) return
  target += amount
  return target
}

function computeMonthlyCashflow(rows, options = {}) {
  const year = options.year
  const dateField = options.dateField ?? 'DATE'

  const byMonth = new Map() // monthIndex -> row

  for (const row of rows) {
    const date = row[dateField]
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) continue
    if (year && date.getFullYear() !== year) continue

    const monthIndex = date.getMonth()
    const current = byMonth.get(monthIndex) ?? initMonthRow(monthIndex)

    if (isDividendRow(row)) {
      current.dividends = addMoney(current.dividends, row.PHP_CREDIT ?? 0) ?? current.dividends
      byMonth.set(monthIndex, current)
      continue
    }

    // Treat buys/sells as trades (not deposits/withdrawals).
    if (isTradeRow(row)) {
      byMonth.set(monthIndex, current)
      continue
    }

    // Deposit rule (per requirement): only count FUTURE TRANSACTIONS rows.
    const cd = String(row.CD ?? '').trim().toUpperCase()
    const particulars = String(row.PARTICULARS ?? '').trim().toUpperCase()
    const isFutureTransactions = cd === 'OR' && particulars.startsWith('FUTURE TRANSACTION')

    if (isFutureTransactions) {
      current.deposit = addMoney(current.deposit, row.PHP_CREDIT ?? 0) ?? current.deposit
    }

    // Withdrawals: keep as any non-trade, non-dividend debit entries.
    current.withdraw = addMoney(current.withdraw, row.PHP_DEBIT ?? 0) ?? current.withdraw

    byMonth.set(monthIndex, current)
  }

  // Ensure the year has all months present and ordered.
  if (year) {
    const months = []
    for (let m = 0; m < 12; m++) {
      months.push(byMonth.get(m) ?? initMonthRow(m))
    }
    return months
  }

  return Array.from(byMonth.entries())
    .sort(([a], [b]) => a - b)
    .map(([, v]) => v)
}

function computeCashflowTotals(months) {
  return months.reduce(
    (acc, m) => ({
      deposit: acc.deposit + (m.deposit ?? 0),
      withdraw: acc.withdraw + (m.withdraw ?? 0),
      dividends: acc.dividends + (m.dividends ?? 0),
    }),
    { deposit: 0, withdraw: 0, dividends: 0 }
  )
}

module.exports = {
  computeMonthlyCashflow,
  computeCashflowTotals,
}
