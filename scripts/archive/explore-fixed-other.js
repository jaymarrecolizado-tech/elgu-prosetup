/**
 * Read-only mapping for Fixed Fees + Other Fees (separate from tax_revenues).
 * Captures all JSON responses, item cards, detail panels, and full API bodies.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(ROOT, '.auth', 'chrome-profile');
const OUT = path.join(ROOT, 'session-fixed-other.json');
const BASE = 'https://elgu-r2-training-core.oueg.info';
const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

async function main() {
  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    viewport: { width: 1400, height: 900 },
  });
  const page = context.pages()[0] || (await context.newPage());

  const api = [];
  page.on('response', async (res) => {
    const ct = res.headers()['content-type'] || '';
    if (!ct.includes('json')) return;
    try {
      const body = await res.json().catch(() => null);
      if (body == null) return;
      const s = JSON.stringify(body);
      api.push({ status: res.status(), method: res.request().method(), url: res.url(), body: s.length > 30000 ? s.slice(0, 30000) + '…[truncated]' : body });
    } catch { /* ignore */ }
  });

  const report = { exploredAt: new Date().toISOString(), pages: [] };

  for (const slug of ['new-fixed-fees', 'new-other-fees']) {
    api.length = 0;
    const entry = { slug };
    console.log('[fx]', slug);
    await page.goto(`${BASE}/bpls/tax-revenue/${slug}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    entry.listText = clean(await page.evaluate(() => document.body.innerText)).slice(0, 3000);
    entry.apiOnLoad = [...api];

    // Card/item structure: find clickable code-like elements and their parents
    entry.itemDom = await page.evaluate(() => {
      const codes = [...document.querySelectorAll('div,span,a,h5,h6')]
        .map((e) => (e.innerText || '').trim())
        .filter((t) => /^(FIXED|OTHER)-/.test(t) && t.length < 60);
      return [...new Set(codes)].slice(0, 20);
    });

    // Expand each item by clicking its code text
    entry.details = [];
    const codes = entry.itemDom.filter((t) => !t.includes(' ') || /^[A-Z-]+$/.test(t.split(' ')[0]));
    for (const raw of codes.slice(0, 12)) {
      const code = raw.split(/\s+/)[0];
      try {
        api.length = 0;
        await page.getByText(code, { exact: false }).first().click({ timeout: 4000 });
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(500);
        const panel = await page.evaluate(() => {
          const txt = (el) => (el.innerText || '').replace(/\s+/g, ' ').trim();
          const cards = [...document.querySelectorAll('.card, [class*="detail"], [class*="collapse"], .accordion-item')]
            .filter((el) => el.offsetParent !== null).map((el) => txt(el).slice(0, 1200)).filter(Boolean).slice(0, 5);
          const tables = [...document.querySelectorAll('table')].map((t) => ({
            headers: [...t.querySelectorAll('th')].map((e) => txt(e)),
            rows: [...t.querySelectorAll('tbody tr')].slice(0, 20).map((tr) => [...tr.querySelectorAll('td')].map((e) => txt(e))),
          }));
          return { cards, tables, body: txt(document.body).slice(0, 3500) };
        });
        entry.details.push({ code, panel, api: [...api] });
      } catch (e) {
        entry.details.push({ code, error: e.message.split('\n')[0] });
      }
    }
    report.pages.push(entry);
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
  }

  await context.close();
  console.log('[fx] wrote', OUT);
}

main().catch((e) => { console.error('[fx] fatal', e); process.exit(1); });
