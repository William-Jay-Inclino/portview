# Portview

Portview is a lightweight portfolio reporting engine that converts broker ledger
Excel files into clear, investor-grade portfolio reports (PDF).

It is designed to:
- Parse broker `.xlsx` ledger files
- Normalize trades, cash flows, and dividends
- Compute portfolio metrics (equity, deposits, ROI, dividends)
- Generate a clean, professional PDF report

---

## 🎯 Project Goals

- **Accuracy first** — financial computations must be correct and auditable
- **No overengineering** — simple, explicit logic over magic
- **Readable outputs** — investor-friendly tables and summaries

---

## 🧠 Core Design Principles

- Calculations are **derived**, not manually edited
- Normalized transactions are the **single source of truth**
- Reports are **generated on demand**
- Prefer **clarity over cleverness**

## 🧱 Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Excel Parsing**: `xlsx` (SheetJS)
- **Dates**: `date-fns`
- **Templating**: EJS
- **PDF Rendering**: Playwright (HTML → PDF)

---

## 🚀 Production (PM2)

This app is a plain Node/Express server (no build step). For production you mainly want:
- `NODE_ENV=production`
- a configurable `PORT`
- a configurable `BASE_PATH` if serving under a subpath (e.g. `/portview`)
- Playwright's Chromium installed on the server (for PDF generation)
- a process manager (PM2) to keep it running and restart on reboot

### 1) Install dependencies

```bash
npm ci
```

### 2) Install Playwright Chromium (required for PDFs)

```bash
npm run playwright:install
```

### 3) Start with PM2

```bash
npm i -g pm2
npm run pm2:start
npm run pm2:logs
```

By default the PM2 config sets `PORT=6000`. Change it in `ecosystem.config.cjs` if needed.

### Serving under a subpath (/portview)

If you want to access the app at `http://localhost:8000/portview`, set:
- `PORT=8000`
- `BASE_PATH=/portview`

When `BASE_PATH` is set, both the UI route and API routes are mounted under that prefix.

### 4) Start on boot

```bash
pm2 save
pm2 startup
```

Run the `sudo` command that PM2 prints.

### 5) Deploy updates

```bash
npm ci
npm run playwright:install
npm run pm2:reload
```