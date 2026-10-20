/** Round 5: Options + Other Range only — multiplier via DOM setter */
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
        .map((e) => ({ type: e.type, name: e.name || null, id: e.id || null, label: labelFor(e), value: e.value, placeholder: e.placeholder || null })),
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
      await page.locator(`.modal.show [name="${k}"]`).fill(String(vals[k]));
      await page.keyboard.press('Tab');
    }
  }
  if (vals.label && names.includes('multiplier') && vals.multiplier === undefined) {
    await page.locator('.modal.show [name="multiplier"]').fill(vals.label);
    await page.keyboard.press('Tab');
  } else if (vals.label && !names.some((n) => ['label', 'name'].includes(n))) {
    const done = await page.evaluate((label) => {
      const m = document.querySelector('.modal.show');
      const el = [...m.querySelectorAll('input')].find((e) => !e.name && !(e.id || '').startsWith('react-select') && e.type === 'text' && e.offsetParent);
      if (!el) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, label);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, vals.label);
    console.log('  label via DOM:', done);
  }
  const ex = page.locator('.modal.show input[name="for_excess_computation"]');
  if (await ex.count()) {
    if (vals.forExcess && !(await ex.isChecked())) await ex.check({ force: true });
    if (!vals.forExcess && (await ex.isChecked())) await ex.uncheck({ force: true });
  }
  await submit(page);
}

async function createCalc(page, calcType, multiplier) {
  await page.getByRole('button', { name: /Add Calculations/ }).first().click();
  await page.waitForTimeout(700);
  const rs = page.locator('.modal.show input[id^="react-select"]');
  await rs.first().click({ force: true });
  await page.waitForTimeout(500);
  await page.getByText(calcType, { exact: true }).first().click();
  await page.waitForTimeout(400);
  const done = await page.evaluate((mult) => {
    const m = document.querySelector('.modal.show');
    const el = [...m.querySelectorAll('input')].find((e) => !e.name && !(e.id || '').startsWith('react-select') && e.type === 'text');
    if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, mult);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return el.value;
  }, multiplier);
  console.log('  multiplier set:', done);
  for (const n of ['for_new', 'for_renewal']) {
    const cb = page.locator(`.modal.show input[name="${n}"]`);
    if (await cb.count() && !(await cb.isChecked())) await cb.check({ force: true });
  }
  await submit(page);
  const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  console.log('  calc snippet:', body.slice(body.indexOf('Calculations'), body.indexOf('Calculations') + 320));
}

async function addDetails(page, details, job) {
  for (let i = 0; i < details.length; i++) {
    let opened = false;
    if (i === 0 && (await dataRows(page).count())) {
      await dataRows(page).first().locator('button').first().click();
      await page.waitForTimeout(600);
      opened = !!(await modal(page));
      if (opened) console.log('  edit existing row 1');
    }
    if (!opened) {
      if (!(await page.locator(':text-is("Add")').count())) {
        await expand(page, job.slug, job.code);
      }
      await page.locator(':text-is("Add")').first().click({ timeout: 8000 });
      await page.waitForTimeout(600);
      console.log(`  Add ${i + 1}`);
    }
    await fillModal(page, details[i]);
    console.log(`  detail ${i + 1}/${details.length} done`);
    await page.waitForTimeout(500);
  }
}

async function main() {
  const report = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const get = (c) => report.samples.find((s) => s.code === c);
  const context = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1400, height: 900 } });
  const page = context.pages()[0] || (await context.newPage());
  const jobs = [
    { code: 'SAMPLE-S3A01-2', slug: 'permit', calcType: 'Options', multiplier: 'bank_type' },
    { code: 'SAMPLE-S4D01', slug: 'sanitary', calcType: 'Other Range', multiplier: 'sqm' },
  ];
  for (const job of jobs) {
    const s = get(job.code);
    const entry = { code: job.code, status: 'started' };
    console.log(`\n===== ${job.code} ${job.calcType} =====`);
    try {
      await expand(page, job.slug, job.code);
      const has = await page.evaluate((t) => document.body.innerText.includes(t), job.calcType);
      if (!has) await createCalc(page, job.calcType, job.multiplier);
      await addDetails(page, s.details, job);
      entry.status = 'done';
    } catch (e) {
      entry.status = 'error'; entry.error = e.message.split('\n')[0];
      console.error(' ERROR', entry.error);
      await page.keyboard.press('Escape').catch(() => {});
    }
    entry.afterBody = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 1200)).catch(() => '');
    if (s) s.fix5 = entry;
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
    console.log(` ${job.code}: ${entry.status}`);
  }
  await context.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
