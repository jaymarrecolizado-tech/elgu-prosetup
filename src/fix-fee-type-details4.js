/** Round 4: data rows = tr:has(button); multiplier for Options/Other Range */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(ROOT, '.auth', 'chrome-profile');
const OUT = path.join(ROOT, 'elgu_fee_type_samples.json');
const BASE = 'https://elgu-r2-training-core.oueg.info';

async function expand(page, slug, code) {
  await page.goto(`${BASE}/bpls/tax-revenue/${slug}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.evaluate((code) => {
    const els = [...document.querySelectorAll('div,span,a,h5,h6,li')];
    const el = els.find((e) => e.innerText?.trim().endsWith(code) && e.innerText.trim().length < code.length + 12) || els.find((e) => e.innerText?.includes(code));
    el?.click();
  }, code);
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(700);
}

async function modal(page) {
  return page.evaluate(() => {
    const m = document.querySelector('.modal.show, [role=dialog]');
    if (!m) return null;
    const labelFor = (el) => el.closest('.form-group,div')?.querySelector('label')?.innerText.trim() || null;
    return {
      title: (m.querySelector('.modal-title,h4,h5')?.innerText || '').trim(),
      text: m.innerText.replace(/\s+/g, ' ').trim().slice(0, 500),
      fields: [...m.querySelectorAll('input,select,textarea')].filter((e) => e.type !== 'hidden')
        .map((e) => ({ type: e.type, name: e.name || null, id: e.id || null, label: labelFor(e), value: e.value })),
    };
  });
}

async function submit(page) {
  await page.locator('.modal.show button:has-text("Submit")').first().click({ timeout: 10_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(700);
}

const dataRows = (page) => page.locator('table tbody tr:has(button)');

async function fillModal(page, d) {
  const form = await modal(page);
  console.log('  form:', JSON.stringify(form));
  if (!form) throw new Error('no modal');
  const names = form.fields.map((f) => f.name);
  const vals = { ...d };
  if (names.includes('rate') && vals.rate === undefined) vals.rate = 0;
  for (const k of ['from', 'to', 'amount', 'rate', 'in_excess_of', 'for_every', 'multiplier', 'label', 'name']) {
    if (vals[k] !== undefined && names.includes(k)) {
      const loc = page.locator(`.modal.show [name="${k}"]`);
      await loc.fill(String(vals[k]));
      await page.keyboard.press('Tab');
    }
  }
  if (vals.label && !names.some((n) => ['label', 'name'].includes(n))) {
    const textFields = form.fields.filter((f) => f.type === 'text');
    const target = textFields.findIndex((f) => !f.name && !(f.id || '').startsWith('react-select'));
    if (target >= 0) await page.locator('.modal.show input[type="text"]').nth(target).fill(vals.label);
    else console.log('  WARN no label field for', vals.label);
  }
  const ex = page.locator('.modal.show input[name="for_excess_computation"]');
  if (await ex.count()) {
    if (vals.forExcess && !(await ex.isChecked())) await ex.check({ force: true });
    if (!vals.forExcess && (await ex.isChecked())) await ex.uncheck({ force: true });
  }
  await submit(page);
}

async function editDataRow(page, idx, d) {
  await dataRows(page).nth(idx).locator('button').first().click();
  await page.waitForTimeout(600);
  await fillModal(page, d);
  console.log(`  data row ${idx + 1} updated`);
}

async function createCalc(page, calcType, multiplier) {
  await page.getByRole('button', { name: /Add Calculations/ }).first().click();
  await page.waitForTimeout(700);
  const rs = page.locator('.modal.show input[id^="react-select"]');
  await rs.first().click({ force: true });
  await page.waitForTimeout(500);
  await page.getByText(calcType, { exact: true }).first().click();
  await page.waitForTimeout(400);
  const form = await modal(page);
  console.log('  calc form:', JSON.stringify(form));
  const textFields = form.fields.filter((f) => f.type === 'text');
  const target = textFields.findIndex((f) => !f.name && !(f.id || '').startsWith('react-select'));
  if (target >= 0) await page.locator('.modal.show input[type="text"]').nth(target).fill(multiplier);
  for (const n of ['for_new', 'for_renewal']) {
    const cb = page.locator(`.modal.show input[name="${n}"]`);
    if (await cb.count() && !(await cb.isChecked())) await cb.check({ force: true });
  }
  await submit(page);
  const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  console.log('  calc snippet:', body.slice(body.indexOf('Calculations'), body.indexOf('Calculations') + 300));
}

async function addDetails(page, details) {
  for (let i = 0; i < details.length; i++) {
    let opened = false;
    if (i === 0 && (await dataRows(page).count())) {
      await dataRows(page).first().locator('button').first().click();
      await page.waitForTimeout(600);
      opened = !!(await modal(page));
      if (opened) console.log('  edit placeholder');
    }
    if (!opened) {
      await page.locator(':text-is("Add")').first().click({ timeout: 8000 });
      await page.waitForTimeout(600);
      console.log(`  Add ${i + 1}`);
    }
    await fillModal(page, details[i]);
    console.log(`  detail ${i + 1}/${details.length} done`);
  }
}

async function main() {
  const report = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const get = (c) => report.samples.find((s) => s.code === c);
  const context = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1400, height: 900 } });
  const page = context.pages()[0] || (await context.newPage());
  const results = [];
  const run = async (code, fn) => {
    console.log(`\n===== ${code} =====`);
    const entry = { code, status: 'started' };
    try { await fn(); entry.status = 'done'; } catch (e) { entry.status = 'error'; entry.error = e.message.split('\n')[0]; console.error(' ERROR', entry.error); await page.keyboard.press('Escape').catch(() => {}); }
    entry.afterBody = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 1000)).catch(() => '');
    results.push(entry);
    const s = get(code); if (s) s.fix4 = entry;
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
  };

  await run('SAMPLE-S3A01-1C', async () => { await expand(page, 'permit', 'SAMPLE-S3A01-1C'); await editDataRow(page, 0, { amount: 30 }); });
  await run('SAMPLE-S3G01', async () => { await expand(page, 'permit', 'SAMPLE-S3G01'); await editDataRow(page, 0, { amount: 150 }); });
  await run('SAMPLE-S3A01-1X', async () => { await expand(page, 'permit', 'SAMPLE-S3A01-1X'); await editDataRow(page, 0, { in_excess_of: 30000, for_every: 5000, amount: 15 }); });
  await run('SAMPLE-S3A01-2', async () => {
    const s = get('SAMPLE-S3A01-2');
    await expand(page, 'permit', s.code);
    if (!(await page.evaluate(() => /Options/.test(document.body.innerText)))) await createCalc(page, 'Options', 'bank_type');
    await addDetails(page, s.details);
  });
  await run('SAMPLE-S4D01', async () => {
    const s = get('SAMPLE-S4D01');
    await expand(page, 'sanitary', s.code);
    if (!(await page.evaluate(() => /Other Range/.test(document.body.innerText)))) await createCalc(page, 'Other Range', 'sqm');
    await addDetails(page, s.details);
  });

  await context.close();
  console.log('\n[done]');
  results.forEach((r) => console.log(` ${r.code}: ${r.status} ${r.error || ''}`));
}

main().catch((e) => { console.error(e); process.exit(1); });
