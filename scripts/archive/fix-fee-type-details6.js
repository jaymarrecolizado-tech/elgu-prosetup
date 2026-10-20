/** Round 6: complete Options + Other Range details only (calcs already exist) */
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
  const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const i = body.indexOf('Calculations');
  console.log(' snippet:', body.slice(i, i + 340));
}

async function modal(page) {
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
  for (const k of ['from', 'to', 'amount', 'rate', 'multiplier']) {
    if (vals[k] !== undefined && names.includes(k)) { await page.locator(`.modal.show [name="${k}"]`).fill(String(vals[k])); await page.keyboard.press('Tab'); }
  }
  if (vals.label && names.includes('multiplier') && vals.multiplier === undefined) {
    await page.locator('.modal.show [name="multiplier"]').fill(vals.label);
    await page.keyboard.press('Tab');
  }
  await submit(page);
}

async function main() {
  const report = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const get = (c) => report.samples.find((s) => s.code === c);
  const context = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1400, height: 900 } });
  const page = context.pages()[0] || (await context.newPage());

  const jobs = [
    { code: 'SAMPLE-S3A01-2', slug: 'permit' },
    { code: 'SAMPLE-S4D01', slug: 'sanitary' },
  ];
  for (const job of jobs) {
    const s = get(job.code);
    const entry = { code: job.code, status: 'started' };
    console.log(`\n===== ${job.code} =====`);
    try {
      await expand(page, job.slug, job.code);
      const existing = await dataRows(page).count();
      console.log(' existing data rows:', existing);
      // Edit row 1 to ensure correct values (Options row1 had blank multiplier)
      if (existing > 0) {
        await dataRows(page).first().locator('button').first().click();
        await page.waitForTimeout(600);
        await fillModal(page, s.details[0]);
        console.log(' row1 corrected');
      }
      for (let i = Math.max(existing, 1); i < s.details.length; i++) {
        if (await page.locator('.modal.show').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
        if (!(await page.locator(':text-is("Add")').count())) await expand(page, job.slug, job.code);
        await page.locator(':text-is("Add")').first().click({ timeout: 8000 });
        await page.waitForTimeout(600);
        await fillModal(page, s.details[i]);
        console.log(` detail ${i + 1}/${s.details.length} added`);
      }
      entry.status = 'done';
    } catch (e) {
      entry.status = 'error'; entry.error = e.message.split('\n')[0];
      console.error(' ERROR', entry.error);
      await page.keyboard.press('Escape').catch(() => {});
    }
    entry.afterBody = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 1200)).catch(() => '');
    if (s) s.fix6 = entry;
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
    console.log(` ${job.code}: ${entry.status}`);
  }
  await context.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
