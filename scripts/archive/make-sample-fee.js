/**
 * ONE sample only: Section 2A.02(a) Manufacturers (graduated gross).
 * Creates TaxRevenue + Gross Range calculation in the training app.
 * Code is SAMPLE-prefixed so it is easy to find and delete.
 * Usage: node src/make-sample-fee.js create
 *        node src/make-sample-fee.js ranges   (dump/add range details - stage 2)
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(ROOT, '.auth', 'chrome-profile');
const OUT = path.join(ROOT, 'session-sample.json');
const BASE = 'https://elgu-r2-training-core.oueg.info';
const CODE = 'SAMPLE-S2A02-A';
const MODE = process.argv[2] || 'create';

const fees = JSON.parse(fs.readFileSync(path.join(ROOT, 'revenue_fees.json'), 'utf8'));
const fee = fees.find((f) => f.article_section === 'Section 2A.02(a)');
if (!fee) throw new Error('Section 2A.02(a) not found');

/** Parse "Less than 10,000: 181.50 PHP; 10,000 to <15,000: 242.00 PHP; ...; 6,500,000 or more: 41 1/4% of 1%" */
function parseGraduated(formula) {
  const ranges = [];
  for (const part of formula.split(';').map((s) => s.trim()).filter(Boolean)) {
    const [bracket, value] = part.split(/:(?![^<]*>)/).map((s) => s.trim());
    const money = (s) => parseFloat(s.replace(/,/g, ''));
    if (/or more/i.test(bracket)) {
      // "41 1/4% of 1%" -> 41.25% x 1% = 0.004125 ; base = previous bracket amount (continuity at threshold)
      const m = value.match(/([\d\s\/]+)%\s*of\s*1%/i);
      let pct = m[1].trim();
      pct = pct.includes('/') ? pct.split(/\s+/).reduce((a, b) => a + (b.includes('/') ? b.split('/')[0] / b.split('/')[1] : parseFloat(b)), 0) : parseFloat(pct);
      ranges.push({ from: money(bracket), to: 99999999999, amount: ranges[ranges.length - 1].amount, rate: pct / 100 / 100, forExcess: true });
    } else if (/less than/i.test(bracket)) {
      ranges.push({ from: 0.01, to: money(bracket.replace(/less than/i, '')) - 0.01, amount: money(value), rate: 0, forExcess: false });
    } else {
      const [lo, hi] = bracket.split(/\s+to\s+</i);
      ranges.push({ from: money(lo), to: money(hi) - 0.01, amount: money(value), rate: 0, forExcess: false });
    }
  }
  return ranges;
}

async function dumpUi(page, label) {
  const ui = await page.evaluate(() => {
    const txt = (e) => (e.innerText || '').replace(/\s+/g, ' ').trim();
    return {
      body: txt(document.body).slice(0, 3500),
      buttons: [...document.querySelectorAll('button, a.btn')].filter((e) => e.offsetParent).map((e) => txt(e)).filter(Boolean),
      modal: (() => {
        const m = document.querySelector('.modal.show, [role=dialog]');
        if (!m) return null;
        return {
          title: txt(m.querySelector('.modal-title,h4,h5') || m).slice(0, 120),
          fields: [...m.querySelectorAll('input,select,textarea')].filter((e) => e.type !== 'hidden')
            .map((e) => ({ tag: e.tagName.toLowerCase(), type: e.type, name: e.name || null, id: e.id || null, placeholder: e.placeholder || null })),
          buttons: [...m.querySelectorAll('button')].map((e) => txt(e)),
        };
      })(),
    };
  });
  console.log(`--- UI ${label} ---`);
  console.log(JSON.stringify(ui, null, 2).slice(0, 5000));
  return ui;
}

async function main() {
  const ranges = parseGraduated(fee.amount_or_formula);
  console.log('[sample] fee:', fee.article_section, fee.specific_fee_name);
  console.log('[sample] parsed ranges:', ranges.length);
  ranges.forEach((r) => console.log(`  ${r.from} -> ${r.to} amount=${r.amount} rate=${r.rate} excess=${r.forExcess}`));

  const context = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1400, height: 900 } });
  const page = context.pages()[0] || (await context.newPage());
  const log = { mode: MODE, code: CODE, ranges };
  const apiLog = [];
  page.on('response', async (res) => {
    const ct = res.headers()['content-type'] || '';
    if (!ct.includes('json') || !res.url().includes('tax_revenues')) return;
    const body = await res.json().catch(() => null);
    if (body) apiLog.push({ url: res.url(), body });
  });

  await page.goto(`${BASE}/bpls/tax-revenue/license`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

  if (MODE === 'create') {
    // Guard: do not duplicate if sample already exists
    const existing = await page.getByText(CODE, { exact: false }).count();
    if (existing) { console.log('[sample] already exists, skipping create'); log.skipped = true; }
    else {
      await page.getByRole('button', { name: /Add Tax Revenue/ }).first().click();
      await page.waitForTimeout(1000);
      await dumpUi(page, 'add-tax-revenue modal');
      await page.locator('input[name="code"]').fill(CODE);
      await page.locator('textarea[name="description"]').fill(fee.specific_fee_name);
      await page.getByRole('button', { name: 'Submit' }).first().click();
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(1500);
      log.afterCreate = await dumpUi(page, 'after create');
      console.log('[sample] tax revenue submitted:', CODE);
    }

    // Open the sample item, then add Gross Range calculation if none yet
    await page.getByText(CODE, { exact: false }).first().click();
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(800);
    const before = await dumpUi(page, 'sample detail before calculation');
    if (!/Gross Range/.test(before.body)) {
      await page.getByRole('button', { name: /Add Calculations/ }).first().click();
      await page.waitForTimeout(1000);
      await dumpUi(page, 'add-calculations modal');
      const input = page.locator('.modal.show input[id^="react-select"], [role=dialog] input[id^="react-select"]').first();
      await input.click({ force: true });
      await page.waitForTimeout(600);
      await page.getByText('Gross Range', { exact: true }).first().click();
      for (const name of ['for_new', 'for_renewal', 'for_retirement']) {
        const cb = page.locator(`input[name="${name}"]`);
        if (await cb.count() && !(await cb.isChecked())) await cb.check({ force: true });
      }
      await page.getByRole('button', { name: 'Submit' }).first().click();
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(1500);
      console.log('[sample] Gross Range calculation submitted');
    } else console.log('[sample] calculation already present');
    log.afterCalc = await dumpUi(page, 'after calculation');
  }

  if (MODE === 'ranges') {
    if (!(await page.locator(':text-is("Add")').count())) {
      await page.getByText(CODE, { exact: false }).first().click();
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(800);
    }
    await dumpUi(page, 'sample detail for ranges');
    await page.locator(':text-is("Add")').first().click();
    await page.waitForTimeout(1000);
    const form = await page.evaluate(() => {
      const m = document.querySelector('.modal.show, [role=dialog]');
      if (!m) return null;
      const labelFor = (el) => {
        const wrap = el.closest('.form-group, div');
        const lab = wrap ? wrap.querySelector('label') : null;
        return lab ? lab.innerText.trim() : null;
      };
      return {
        text: m.innerText.replace(/\s+/g, ' ').trim(),
        fields: [...m.querySelectorAll('input,select,textarea')].filter((e) => e.type !== 'hidden')
          .map((e) => ({ tag: e.tagName.toLowerCase(), type: e.type, name: e.name || null, id: e.id || null, placeholder: e.placeholder || null, label: labelFor(e) })),
      };
    });
    console.log('--- RANGE FORM ---');
    console.log(JSON.stringify(form, null, 2));
    log.rangeForm = form;
    await page.keyboard.press('Escape');
  }

  if (MODE === 'check' || MODE === 'fill') {
    if (!(await page.locator(':text-is("Add")').count())) {
      await page.getByText(CODE, { exact: false }).first().click();
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(800);
    }
    const listEntry = apiLog.find((a) => /tax_revenues\?/.test(a.url));
    const sample = listEntry?.body?.data?.find((d) => d.attributes.code === CODE);
    console.log('[check] sample id:', sample?.id);
    const calcEntry = apiLog.filter((a) => sample && a.url.includes(`tax_revenues/${sample.id}/calculations?`)).pop();
    const rangesNow = (calcEntry?.body?.included || []).filter((i) => i.type === 'bpls_tax_revenue_calculation_ranges').map((i) => i.attributes);
    console.log('[check] existing ranges in API:', JSON.stringify(rangesNow));
    log.existingRanges = rangesNow;

    if (MODE === 'fill' && rangesNow.length < ranges.length) {
      let start = rangesNow.length;
      const isPlaceholder = rangesNow.length === 1 && rangesNow[0].from === '0.00' && rangesNow[0].to === '1000.00' && rangesNow[0].amount === '0.00';
      if (isPlaceholder) {
        // Calculation auto-creates a 0-1000 placeholder detail: edit it into bracket #1
        const row = page.locator('tr', { hasText: '1,000.00' }).first();
        await row.locator('button').first().click(); // first action = edit (second is delete)
        await page.waitForTimeout(800);
        await dumpUi(page, 'edit placeholder range');
        const r = ranges[0];
        await page.locator('input[name="from"]').fill(String(r.from));
        await page.locator('input[name="to"]').fill(String(r.to));
        await page.locator('input[name="amount"]').fill(String(r.amount));
        await page.locator('input[name="rate"]').fill(String(r.rate));
        await page.getByRole('button', { name: 'Submit' }).first().click();
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(700);
        console.log('[fill] edited placeholder into bracket 1');
        start = 1;
      }
      for (let i = start; i < ranges.length; i++) {
        const r = ranges[i];
        await page.locator(':text-is("Add")').first().click();
        await page.waitForTimeout(700);
        await page.locator('input[name="from"]').fill(String(r.from));
        await page.locator('input[name="to"]').fill(String(r.to));
        await page.locator('input[name="amount"]').fill(String(r.amount));
        await page.locator('input[name="rate"]').fill(String(r.rate));
        const cb = page.locator('input[name="for_excess_computation"]');
        if (r.forExcess && !(await cb.isChecked())) await cb.check({ force: true });
        if (!r.forExcess && (await cb.isChecked())) await cb.uncheck({ force: true });
        await page.getByRole('button', { name: 'Submit' }).first().click();
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(700);
        console.log(`[fill] added range ${i + 1}/${ranges.length}: ${r.from}-${r.to} amt=${r.amount} rate=${r.rate}`);
      }
    }
    log.afterFill = await dumpUi(page, 'after fill/check');
  }

  if (MODE === 'actions') {
    if (!(await page.locator(':text-is("Add")').count())) {
      await page.getByText(CODE, { exact: false }).first().click();
      await page.waitForTimeout(800);
    }
    const html = await page.evaluate(() => {
      const tr = [...document.querySelectorAll('tr')].find((r) => r.innerText.includes('1,000.00'));
      return tr ? tr.outerHTML.slice(0, 2500) : 'row not found';
    });
    console.log('--- ROW HTML ---');
    console.log(html);
    log.rowHtml = html;
  }

  fs.writeFileSync(OUT, JSON.stringify(log, null, 2), 'utf8');
  await context.close();
  console.log('[sample] done. Wrote', OUT);
}

main().catch((e) => { console.error('[sample] fatal', e); process.exit(1); });
