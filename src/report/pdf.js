const { chromium } = require('@playwright/test')

async function renderPdfFromHtml(html, options = {}) {
  const browser = await chromium.launch({ headless: true })

  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle' })

    const pdfBuffer = await page.pdf({
      format: options.format ?? 'A4',
      printBackground: options.printBackground ?? true,
      margin: options.margin ?? { top: '24px', right: '24px', bottom: '24px', left: '24px' },
    })

    return pdfBuffer
  } finally {
    await browser.close()
  }
}

module.exports = {
  renderPdfFromHtml,
}
