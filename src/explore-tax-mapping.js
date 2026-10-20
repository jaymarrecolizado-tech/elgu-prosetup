/**
 * Deep read-only mapping of Tax Revenue sample data.
 * - Captures API (XHR/fetch) responses while browsing
 * - Expands each fee/tax item to capture its detail + calculations
 * - Captures Add Calculations dropdown options
 * Never clicks Submit.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(ROOT, '.auth', 'chrome-profile');
const OUT = path.join(ROOT, 'session-tax-mapping.json');
const BASE = 'https://elgu-r2-training-core.oueg.info';
const PAGES = ['license', 'permit', 'sanitary', 'garbage', 'new-fixed-fees', 'new-other-fees'];

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

function isApi(url) {
  return /\/api\/|\/bpls\/.*(json|tax|fee|calcul|revenue)/i.test(url) && !url.endsWith('.js') && !url.endsWith('.css');
}

async function detailSnapshot(page) {
  return page.evaluate(() => {
    const txt = (el) => (el.innerText || '').replace(/\s+/g, ' ').trim();
    // Tables with headers + rows
    const tables = [...document.querySelectorAll('table')].map((t) => ({
      headers: [...t.querySelectorAll('thead th, tr:first-child th')].map((e) => txt(e)),
      rows: [...t.querySelectorAll('tbody tr')].slice(0, 30).map((tr) =>
        [...tr.querySelectorAll('td')].map((e) => txt(e))
      ),
    })).filter((t) => t.headers.length || t.rows.length);
    // Any visible detail panels (cards / accordions / expanded sections)
    const panels = [...document.querySelectorAll('.card, .accordion-item, [class*="detail"], [class*="collapse"]')]
      .filter((el) => el.offsetParent !== null)
      .map((el) => txt(el).slice(0, 1500))
      .filter(Boolean)
      .slice(0, 8);
    return { tables, panels, body: txt(document.body).slice(0, 4000) };
  });
}

async function expandItems(page) {
  // Item codes look like LICENSE-..., FIXED-..., OTHER-..., SANITARY-..., GARBAGE-...
  const codes = await page.evaluate(() => {
    const re = /^[A-Z][A-Z0-9]+(?:-[A-Z0-9]+)+$/;
    const found = [];
    const seen = new Set();
    for (const el of document.querySelectorAll('div,span,a,button,h1,h2,h3,h4,h5,td,li')) {
      const t = (el.innerText || '').trim();
      if (re.test(t) && !seen.has(t)) { seen.add(t); found.push(t); }
    }
    return found.slice(0, 25);
  });

  const details = [];
  for (const code of codes) {
    try {
      const loc = page.getByText(code, { exact: true }).first();
      if (!(await loc.count())) continue;
      await loc.click({ timeout: 4000 });
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(600);
      const snap = await detailSnapshot(page);
      details.push({ code, ...snap });
    } catch (e) {
      details.push({ code, error: e.message.split('\n')[0] });
    }
  }
  return details;
}

async function calcDropdownOptions(page) {
  const btn = page.getByRole('button', { name: /Add Calculations/ }).first();
  if (!(await btn.count())) return null;
  await btn.click();
  await page.waitForTimeout(1200);
  const modal = page.locator('.modal.show, [role=dialog]').first();
  let options = [];
  const input = modal.locator('input[id^="react-select"]').first();
  if (await input.count()) {
    await input.click({ force: true });
    await page.waitForTimeout(700);
    options = await page.evaluate(() =>
      [...document.querySelectorAll('[id*="-option-"], [class*="-option"], [role=option]')]
        .map((o) => o.innerText.trim()).filter(Boolean)
    );
    options = [...new Set(options)];
  }
  const fields = await modal.evaluate((root) => ({
    title: (root.querySelector('.modal-title,h4,h5')?.innerText || '').trim(),
    inputs: [...root.querySelectorAll('input,select,textarea')].filter((e) => e.type !== 'hidden')
      .map((e) => ({ tag: e.tagName.toLowerCase(), type: e.type, name: e.name || null, id: e.id || null })),
  })).catch(() => null);
  await page.getByRole('button', { name: 'Cancel' }).first().click({ timeout: 3000 }).catch(() => page.keyboard.press('Escape'));
  await page.waitForTimeout(400);
  return { fields, options };
}

async function main() {
  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    viewport: { width: 1400, height: 900 },
  });
  const page = context.pages()[0] || (await context.newPage());

  const apiLog = [];
  page.on('response', async (res) => {
    const url = res.url();
    const ct = (res.headers()['content-type'] || '');
    if (!ct.includes('json')) return;
    if (!url.includes('/bpls') && !url.includes('/api')) return;
    try {
      const body = await res.json().catch(() => null);
      if (body == null) return;
      const s = JSON.stringify(body);
      apiLog.push({ status: res.status(), url, body: s.length > 6000 ? s.slice(0, 6000) + '…[truncated]' : body });
    } catch { /* ignore */ }
  });

  const report = { exploredAt: new Date().toISOString(), pages: [] };

  for (const slug of PAGES) {
    const url = `${BASE}/bpls/tax-revenue/${slug}`;
    console.log(`[map] ${slug}`);
    apiLog.length = 0;
    const entry = { slug, url };
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      entry.listText = clean(await page.evaluate(() => document.body.innerText)).slice(0, 3000);
      entry.items = await expandItems(page);
      entry.calcDropdown = await calcDropdownOptions(page);
      entry.api = [...apiLog];
    } catch (e) {
      entry.error = e.message.split('\n')[0];
    }
    report.pages.push(entry);
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
    console.log(`[map] ${slug} done items=${entry.items?.length || 0} api=${entry.api?.length || 0}`);
  }

  await context.close();
  console.log(`[map] wrote ${OUT}`);
}

main().catch((e) => { console.error('[map] fatal', e); process.exit(1); });
