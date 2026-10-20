/**
 * Explores authenticated eLGU pages using the saved login profile
 * (created by spawn-login-browser.js). Writes a recon report to
 * session-inspect.json.
 *
 * Usage: node src/explore-elgu.js [/path1 /path2 ...]
 * Run only after closing the spawn-login-browser window (profile lock).
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(ROOT, '.auth', 'chrome-profile');
const OUT = path.join(ROOT, 'session-inspect.json');
const BASE = 'https://elgu-r2-training-core.oueg.info';

const DEFAULT_PATHS = [
  '/bpls/transactions',
  '/bpls/settings',
  '/bpls/tax-revenue/new-fixed-fees',
  '/bpls/tax-revenue/new-other-fees',
  '/bpls/tax-revenue/license',
];

async function snapshot(page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  return page.evaluate(() => {
    const txt = (el) => (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    const label = (el) => {
      const id = el.id;
      const byFor = id && document.querySelector(`label[for="${CSS.escape(id)}"]`);
      return (byFor && txt(byFor)) || el.getAttribute('aria-label') || el.getAttribute('placeholder') || null;
    };
    return {
      title: document.title,
      headings: [...document.querySelectorAll('h1,h2,h3,h4,.card-title,.modal-title')].map(txt).filter(Boolean).slice(0, 40),
      tables: [...document.querySelectorAll('table')].map((t) => ({
        headers: [...t.querySelectorAll('thead th')].map(txt),
        rowCount: t.querySelectorAll('tbody tr').length,
      })),
      buttons: [...document.querySelectorAll('button,a.btn,input[type=submit]')].map((b) => txt(b) || b.value).filter(Boolean).slice(0, 60),
      inputs: [...document.querySelectorAll('input,textarea')].map((el) => ({
        type: el.type, name: el.name || null, id: el.id || null, label: label(el),
        placeholder: el.placeholder || null, required: el.required,
      })).slice(0, 80),
      selects: [...document.querySelectorAll('select')].map((s) => ({
        name: s.name || null, id: s.id || null, label: label(s),
        options: [...s.options].map((o) => o.text.trim()).slice(0, 30),
      })),
      bodySample: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 1500),
    };
  });
}

async function main() {
  const paths = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_PATHS;
  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    viewport: { width: 1400, height: 900 },
  });
  const page = context.pages()[0] || (await context.newPage());
  const report = { exploredAt: new Date().toISOString(), pages: [] };

  for (const p of paths) {
    const url = BASE + p;
    console.log(`[explore] ${url}`);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const finalUrl = page.url();
      const snap = await snapshot(page);
      report.pages.push({ requested: url, finalUrl, ...snap });
      if (finalUrl.includes('/login')) console.log('[explore] redirected to login — session not valid');
    } catch (err) {
      report.pages.push({ requested: url, error: err.message });
      console.error(`[explore] failed ${url}: ${err.message}`);
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
  console.log(`[explore] wrote ${OUT}`);
  await context.close();
}

main().catch((err) => {
  console.error('[explore] fatal:', err);
  process.exit(1);
});
