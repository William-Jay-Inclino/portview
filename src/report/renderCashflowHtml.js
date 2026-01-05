function formatPhp(amount) {
  const value = Number(amount ?? 0)
  return value.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function renderCashflowReportHtml({ title, subtitle, months, totals }) {
  const rows = months
    .map(
      (m) => `
        <tr>
          <td>${escapeHtml(m.month)}</td>
          <td class="num">${formatPhp(m.deposit)}</td>
          <td class="num">${formatPhp(m.withdraw)}</td>
          <td class="num">${formatPhp(m.dividends)}</td>
        </tr>`
    )
    .join('')

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      @page { size: A4; margin: 24px; }
      body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; }
      h1 { font-size: 18px; margin: 0 0 4px; }
      .sub { margin: 0 0 14px; color: #444; }
      .meta { margin: 10px 0 18px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #ddd; padding: 8px; }
      th { text-align: left; background: #f5f5f5; }
      td.num { text-align: right; font-variant-numeric: tabular-nums; }
      tfoot td { font-weight: 700; background: #fafafa; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    <p class="sub">${escapeHtml(subtitle)}</p>

    <div class="meta">
      <strong>Cashflow Summary</strong><br />
      Deposits: PHP ${formatPhp(totals.deposit)}<br />
      Withdrawals: PHP ${formatPhp(totals.withdraw)}<br />
      Dividends: PHP ${formatPhp(totals.dividends)}
    </div>

    <table>
      <thead>
        <tr>
          <th>Month</th>
          <th class="num">Deposit</th>
          <th class="num">Withdraw</th>
          <th class="num">Dividends</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
      <tfoot>
        <tr>
          <td>Total</td>
          <td class="num">${formatPhp(totals.deposit)}</td>
          <td class="num">${formatPhp(totals.withdraw)}</td>
          <td class="num">${formatPhp(totals.dividends)}</td>
        </tr>
      </tfoot>
    </table>
  </body>
</html>`
}

module.exports = {
  renderCashflowReportHtml,
}
