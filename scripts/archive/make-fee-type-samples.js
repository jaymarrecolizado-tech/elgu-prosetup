/**
 * Add SAMPLE fees for calculation types not covered by the first samples:
 * Gross Rate, Gross Range (rate tiers), Options, Other Range, Quantity,
 * Gross Excess, Capital Range. Flexible detail filling + form probing.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(ROOT, '.auth', 'chrome-profile');
const OUT = path.join(ROOT, 'elgu_fee_type_samples.json');
const BASE = 'https://elgu-r2-training-core.oueg.info';

const SAMPLES = [
  {
    page: 'license', code: 'SAMPLE-S2A02-F', calcType: 'Gross Rate',
    description: 'Tax on Banks and Other Financial Institutions',
    source: 'Section 2A.02(f): 55% of 1% (0.55%) of gross receipts',
    details: [{ rate: 0.0055, amount: 0 }],
  },
  {
    page: 'license', code: 'SAMPLE-S2A02-D', calcType: 'Gross Range',
    description: 'Tax on Retailers',
    source: 'Section 2A.02(d): 2.4% on <=400,000; 1.2% on excess',
    details: [
      { from: 0.01, to: 400000, amount: 0, rate: 0.024, forExcess: false },
      { from: 400000.01, to: 99999999999, amount: 9600, rate: 0.012, forExcess: true },
    ],
  },
  {
    page: 'permit', code: 'SAMPLE-S3A01-2', calcType: 'Options',
    description: "Mayor's Permit Fee on Banks and Other Financial Institutions",
    source: 'Section 3A.01(2): flat per institution type',
    details: [
      { label: 'Rural, Thrift, and Savings Banks', amount: 220 },
      { label: 'Commercial, Industrial, Dev Banks', amount: 330 },
      { label: 'Universal Banks/Insurance', amount: 220 },
      { label: 'Pawnshops/Money Shops/Lending', amount: 440 },
    ],
  },
  {
    page: 'sanitary', code: 'SAMPLE-S4D01', calcType: 'Other Range', multiplierOption: 'Sqm Range',
    description: 'Sanitary Inspection Fee (Business/industrial/agricultural floor area)',
    source: 'Section 4D.01: floor area tiers',
    details: [
      { from: 0.01, to: 24.99, amount: 100 }, { from: 25, to: 49.99, amount: 150 },
      { from: 50, to: 99.99, amount: 200 }, { from: 100, to: 199.99, amount: 250 },
      { from: 200, to: 499.99, amount: 300 }, { from: 500, to: 999.99, amount: 400 },
      { from: 1000, to: 99999999999, amount: 500 },
    ],
  },
  {
    page: 'permit', code: 'SAMPLE-S3G01', calcType: 'Quantity',
    description: 'Permit Fee on Circus and Other Parades (per day)',
    source: 'Section 3G.01: 150.00 PHP per day',
    details: [{ amount: 150 }],
  },
  {
    page: 'permit', code: 'SAMPLE-S3A01-1X', calcType: 'Gross Excess',
    description: "Mayor's Permit Fee on Business (excess over 30,000)",
    source: 'Section 3A.01(1): 200 at 30,000 + 15 per 5,000 excess = rate 0.003',
    details: [{ from: 30000, amount: 200, rate: 0.003, forExcess: true }],
  },
  {
    page: 'permit', code: 'SAMPLE-S3A01-1C', calcType: 'Capital Range',
    description: "Mayor's Permit Fee on Business (capital investment basis)",
    source: 'Section 3A.01(1): graduated on gross receipts or capital investment',
    details: [
      { from: 0.01, to: 4999.99, amount: 30 }, { from: 5000, to: 9999.99, amount: 60 },
      { from: 10000, to: 19999.99, amount: 120 }, { from: 20000, to: 29999.99, amount: 200 },
      { from: 30000, to: 99999999999, amount: 200, rate: 0.003, forExcess: true },
    ],
  },
];

async function modalFields(page) {
  return page.evaluate(() => {
    const m = document.querySelector('.modal.show, [role=dialog]');
    if (!m) return null;
    const labelFor = (el) => el.closest('.form-group,div')?.querySelector('label')?.innerText.trim() || null;
    return {
      title: (m.querySelector('.modal-title,h4,h5')?.innerText || '').trim(),
      fields: [...m.querySelectorAll('input,select,textarea')].filter((e) => e.type !== 'hidden')
        .map((e) => ({ type: e.type, name: e.name || null, id: e.id || null, label: labelFor(e), value: e.value })),
    };
  });
}

async function setField(page, name, value) {
  const loc = page.locator(`.modal.show input[name="${name}"], [role=dialog] input[name="${name}"], .modal.show textarea[name="${name}"]`);
  if (!(await loc.count())) return false;
  await page.evaluate(({ name, value }) => {
    const el = document.querySelector(`.modal.show input[name="${name}"], [role=dialog] input[name="${name}"], .modal.show textarea[name="${name}"]`);
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }, { name, value });
  return true;
}

async function submit(page) {
  await page.locator('.modal.show button:has-text("Submit"), [role=dialog] button:has-text("Submit")').first().click();
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(800);
}

async function selectReact(page, text, nth = 0) {
  const input = page.locator('.modal.show input[id^="react-select"], [role=dialog] input[id^="react-select"]').nth(nth);
  await input.click({ force: true });
  await page.waitForTimeout(500);
  await page.getByText(text, { exact: true }).first().click();
  await page.waitForTimeout(400);
}

async function fillDetail(page, d, entry) {
  const form = await modalFields(page);
  entry.forms = entry.forms || [];
  entry.forms.push(form);
  console.log('  detail form:', JSON.stringify(form));
  if (!form) throw new Error('no detail modal');
  const names = form.fields.map((f) => f.name);
  if (names.includes('from') && d.from !== undefined) await setField(page, 'from', d.from);
  if (names.includes('to') && d.to !== undefined) await setField(page, 'to', d.to);
  if (names.includes('amount') && d.amount !== undefined) await setField(page, 'amount', d.amount);
  if (names.includes('rate') && d.rate !== undefined) await setField(page, 'rate', d.rate);
  // Options / label-like fields
  if (d.label) {
    for (const cand of ['label', 'name', 'description', 'option', 'option_name', 'title']) {
      if (names.includes(cand)) { await setField(page, cand, d.label); break; }
    }
    // react-select label field? dump will show in forms for manual follow-up
  }
  const excess = page.locator('.modal.show input[name="for_excess_computation"]');
  if (await excess.count()) {
    const want = !!d.forExcess;
    if (want !== (await excess.isChecked())) await excess.check({ force: true }).catch(async () => excess.uncheck({ force: true }));
    if (!want && (await excess.isChecked())) await excess.uncheck({ force: true });
  }
  await submit(page);
}

async function addDetails(page, sample, entry) {
  // First detail: edit auto-created placeholder row if present, else Add
  for (let i = 0; i < sample.details.length; i++) {
    const d = sample.details[i];
    let opened = false;
    if (i === 0) {
      const row = page.locator('table tbody tr, tr.top-border').first();
      if (await row.count() && await row.locator('button').count()) {
        await row.locator('button').first().click();
        await page.waitForTimeout(700);
        opened = !!(await modalFields(page));
        if (opened) console.log(`  editing placeholder detail ${i + 1}`);
      }
    }
    if (!opened) {
      if (!(await page.locator(':text-is("Add")').count())) throw new Error('no Add control for detail ' + (i + 1));
      await page.locator(':text-is("Add")').first().click();
      await page.waitForTimeout(700);
      console.log(`  adding detail ${i + 1}`);
    }
    await fillDetail(page, d, entry);
    console.log(`  detail ${i + 1}/${sample.details.length} submitted:`, JSON.stringify(d));
  }
}

async function createSample(page, sample) {
  const entry = { ...sample, status: 'started' };
  console.log(`\n===== ${sample.page} ${sample.code} (${sample.calcType}) =====`);
  await page.goto(`${BASE}/bpls/tax-revenue/${sample.page}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

  if (await page.getByText(sample.code, { exact: false }).count()) {
    entry.status = 'exists';
    console.log('  already exists');
    await page.getByText(sample.code, { exact: false }).first().click();
    await page.waitForTimeout(700);
    return entry;
  }

  await page.getByRole('button', { name: /Add Tax Revenue/ }).first().click();
  await page.waitForTimeout(700);
  await page.locator('input[name="code"]').fill(sample.code);
  await page.locator('textarea[name="description"]').fill(sample.description);
  await submit(page);
  console.log('  tax revenue created');

  await page.getByText(sample.code, { exact: false }).first().click();
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(600);

  await page.getByRole('button', { name: /Add Calculations/ }).first().click();
  await page.waitForTimeout(700);
  await selectReact(page, sample.calcType, 0);
  entry.calcFormAfterType = await modalFields(page);
  console.log('  calc form after type:', JSON.stringify(entry.calcFormAfterType));
  // Other Range / multiple types may reveal a multiplier select
  if (sample.multiplierOption) {
    const count = await page.locator('.modal.show input[id^="react-select"]').count();
    if (count > 1) await selectReact(page, sample.multiplierOption, 1).catch((e) => console.log('  multiplier select:', e.message.split('\n')[0]));
  }
  for (const n of ['for_new', 'for_renewal']) {
    const cb = page.locator(`.modal.show input[name="${n}"]`);
    if (await cb.count() && !(await cb.isChecked())) await cb.check({ force: true });
  }
  await submit(page);
  console.log('  calculation created');

  await addDetails(page, sample, entry);
  entry.status = 'created';
  entry.afterBody = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 900));
  return entry;
}

async function main() {
  const report = { createdAt: new Date().toISOString(), samples: [] };
  const context = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1400, height: 900 } });
  const page = context.pages()[0] || (await context.newPage());
  for (const s of SAMPLES) {
    try { report.samples.push(await createSample(page, s)); }
    catch (e) {
      console.error('ERROR', s.code, e.message.split('\n')[0]);
      report.samples.push({ ...s, status: 'error', error: e.message.split('\n')[0] });
      await page.keyboard.press('Escape').catch(() => {});
    }
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
  }
  await context.close();
  console.log('\n[done]');
  report.samples.forEach((s) => console.log(` ${s.page} ${s.code} ${s.calcType}: ${s.status}`));
}

main().catch((e) => { console.error(e); process.exit(1); });
