/** Round 3: locator.fill for masked amounts; create missing Options/Other Range calcs (label required) */
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

async function fillNamed(page, name, value) {
  const loc = page.locator(`.modal.show [name="${name}"]`);
  if (!(await loc.count())) return false;
  await loc.fill(String(value));
  await page.keyboard.press('Tab');
  return true;
}

async function fillDetail(page, d) {
  const form = await modal(page);
  console.log('  form:', JSON.stringify(form));
  if (!form) throw new Error('no modal');
  const names = form.fields.map((f) => f.name);
  const vals = { ...d };
  if (names.includes('rate') && vals.rate === undefined) vals.rate = 0;
  for (const k of ['from', 'to', 'amount', 'rate', 'in_excess_of', 'for_every', 'multiplier']) {
    if (vals[k] !== undefined && names.includes(k)) await fillNamed(page, k, vals[k]);
  }
  if (vals.label) {
    if (names.includes('label')) await fillNamed(page, 'label', vals.label);
    else if (names.includes('name')) await fillNamed(page, 'name', vals.label);
    else {
      const idx = form.fields.findIndex((f) => f.type === 'text' && !f.name && !(f.id || '').startsWith('react-select'));
      if (idx >= 0) await page.locator('.modal.show input[type="text"]').nth(idx).fill(vals.label);
      else {
        // react-select based option label: type and pick/create
        const rs = page.locator('.modal.show input[id^="react-select"]');
        if (await rs.count()) { await rs.first().click({ force: true }); await page.waitForTimeout(400); await rs.first().fill(vals.label); await page.waitForTimeout(400); await page.getByText(vals.label, { exact: false }).first().click().catch(() => {}); }
      }
    }
  }
  const ex = page.locator('.modal.show input[name="for_excess_computation"]');
  if (await ex.count()) {
    if (vals.forExcess && !(await ex.isChecked())) await ex.check({ force: true });
    if (!vals.forExcess && (await ex.isChecked())) await ex.uncheck({ force: true });
  }
  await submit(page);
}

async function editRows(page, amountsOrDetails, mode) {
  for (let i = 0; i < amountsOrDetails.length; i++) {
    const rows = page.locator('table tbody tr');
    if (i >= (await rows.count())) throw new Error('row missing ' + i);
    await rows.nth(i).locator('button').first().click();
    await page.waitForTimeout(600);
    await fillDetail(page, mode === 'amounts' ? { amount: amountsOrDetails[i] } : amountsOrDetails[i]);
    console.log(`  row ${i + 1} updated`);
  }
}

async function addDetails(page, details) {
  for (let i = 0; i < details.length; i++) {
    let opened = false;
    if (i === 0) {
      const rows = page.locator('table tbody tr');
      for (let r = 0; r < (await rows.count()) && !opened; r++) {
        if (await rows.nth(r).locator('button').count()) {
          await rows.nth(r).locator('button').first().click();
          await page.waitForTimeout(600);
          opened = !!(await modal(page));
          if (opened) console.log('  edit placeholder');
        }
      }
    }
    if (!opened) {
      await page.locator(':text-is("Add")').first().click({ timeout: 8000 });
      await page.waitForTimeout(600);
      console.log(`  Add ${i + 1}`);
    }
    await fillDetail(page, details[i]);
    console.log(`  detail ${i + 1}/${details.length} done`);
  }
}

async function createCalcWithLabel(page, calcType, label) {
  await page.getByRole('button', { name: /Add Calculations/ }).first().click();
  await page.waitForTimeout(700);
  const rs = page.locator('.modal.show input[id^="react-select"]');
  await rs.first().click({ force: true });
  await page.waitForTimeout(500);
  await page.getByText(calcType, { exact: true }).first().click();
  await page.waitForTimeout(400);
  const form = await modal(page);
  console.log('  calc form:', JSON.stringify(form));
  // unnamed text field = calculation label (e.g. Bank Type / Sqm Range)
  const idx = form.fields.findIndex((f) => f.type === 'text' && !f.name && !(f.id || '').startsWith('react-select'));
  if (idx >= 0) await page.locator('.modal.show input[type="text"]').nth(idx).fill(label);
  for (const n of ['for_new', 'for_renewal']) {
    const cb = page.locator(`.modal.show input[name="${n}"]`);
    if (await cb.count() && !(await cb.isChecked())) await cb.check({ force: true });
  }
  await submit(page);
  const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  console.log('  calc present:', body.includes(calcType), body.slice(body.indexOf('Calculations'), body.indexOf('Calculations') + 260));
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
    try { await fn(); entry.status = 'done'; }
    catch (e) { entry.status = 'error'; entry.error = e.message.split('\n')[0]; console.error(' ERROR', entry.error); await page.keyboard.press('Escape').catch(() => {}); }
    results.push(entry);
    const s = get(code); if (s) s.fix3 = entry;
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
  };

  await run('SAMPLE-S3A01-1C', async () => { await expand(page, 'permit', 'SAMPLE-S3A01-1C'); await editRows(page, [30, 60, 120, 200, 200], 'amounts'); });
  await run('SAMPLE-S3G01', async () => { await expand(page, 'permit', 'SAMPLE-S3G01'); await editRows(page, [150], 'amounts'); });
  await run('SAMPLE-S3A01-1X', async () => {
    await expand(page, 'permit', 'SAMPLE-S3A01-1X');
    const row = page.locator('table tbody tr').first();
    await row.locator('button').first().click(); await page.waitForTimeout(600);
    await fillDetail(page, { in_excess_of: 30000, for_every: 5000, amount: 15 });
  });
  await run('SAMPLE-S3A01-2', async () => {
    const s = get('SAMPLE-S3A01-2');
    await expand(page, 'permit', s.code);
    if (!(await page.evaluate(() => document.body.innerText.includes('Options')))) await createCalcWithLabel(page, 'Options', 'Bank Type');
    await addDetails(page, s.details);
  });
  await run('SAMPLE-S4D01', async () => {
    const s = get('SAMPLE-S4D01');
    await expand(page, 'sanitary', s.code);
    if (!(await page.evaluate(() => document.body.innerText.includes('Other Range')))) await createCalcWithLabel(page, 'Other Range', 'Sqm Range');
    await addDetails(page, s.details);
  });

  await context.close();
  console.log('\n[done]');
  results.forEach((r) => console.log(` ${r.code}: ${r.status} ${r.error || ''}`));
}

main().catch((e) => { console.error(e); process.exit(1); });
