/** Round 2: Options, Other Range, Gross Excess semantics, Capital Range remainder */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(ROOT, '.auth', 'chrome-profile');
const SRC = path.join(ROOT, 'elgu_fee_type_samples.json');
const BASE = 'https://elgu-r2-training-core.oueg.info';

async function modalFields(page) {
  return page.evaluate(() => {
    const m = document.querySelector('.modal.show, [role=dialog]');
    if (!m) return null;
    const labelFor = (el) => el.closest('.form-group,div')?.querySelector('label')?.innerText.trim() || null;
    return {
      title: (m.querySelector('.modal-title,h4,h5')?.innerText || '').trim(),
      text: m.innerText.replace(/\s+/g, ' ').trim().slice(0, 600),
      fields: [...m.querySelectorAll('input,select,textarea')].filter((e) => e.type !== 'hidden')
        .map((e) => ({ type: e.type, name: e.name || null, id: e.id || null, label: labelFor(e), value: e.value })),
    };
  });
}

async function setNamed(page, name, value) {
  return page.evaluate(({ name, value }) => {
    const el = document.querySelector(`.modal.show [name="${name}"]`);
    if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }, { name, value });
}

async function submit(page) {
  await page.locator('.modal.show button:has-text("Submit")').first().click({ timeout: 10000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(700);
}

async function expand(page, slug, code) {
  await page.goto(`${BASE}/bpls/tax-revenue/${slug}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  // Click the list entry (uppercase system name) via DOM exact text
  await page.evaluate((code) => {
    const els = [...document.querySelectorAll('div,span,a,h5,h6,li')];
    const el = els.find((e) => e.innerText?.trim().endsWith(code) && e.innerText.trim().length < code.length + 12)
      || els.find((e) => e.innerText?.includes(code));
    el?.click();
  }, code);
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(800);
  const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const i = body.indexOf(code, body.indexOf(code) + 1);
  console.log(' detail snippet:', body.slice(Math.max(0, i - 20), i + 420));
  return body;
}

async function fillForm(page, d, entry) {
  const form = await modalFields(page);
  entry.forms.push(form);
  console.log('  form:', JSON.stringify(form));
  if (!form) throw new Error('no modal');
  const names = form.fields.map((f) => f.name);
  const vals = { ...d };
  if (names.includes('rate') && vals.rate === undefined) vals.rate = 0;
  for (const k of ['from', 'to', 'amount', 'rate', 'in_excess_of', 'for_every', 'label', 'name']) {
    if (vals[k] !== undefined && names.includes(k)) await setNamed(page, k, vals[k]);
  }
  if (vals.label && !names.some((n) => ['label', 'name'].includes(n))) {
    // fill unnamed plain text input if present
    const fields = form.fields;
    const idx = fields.findIndex((f) => f.type === 'text' && !f.name && !(f.id || '').startsWith('react-select'));
    if (idx >= 0) {
      const inputs = page.locator('.modal.show input[type="text"]');
      await inputs.nth(idx).fill(vals.label).catch((e) => console.log('  label fill:', e.message.split('\n')[0]));
    } else {
      console.log('  WARNING: no label field found for option', vals.label);
    }
  }
  const ex = page.locator('.modal.show input[name="for_excess_computation"]');
  if (await ex.count()) {
    if (vals.forExcess && !(await ex.isChecked())) await ex.check({ force: true });
    if (!vals.forExcess && (await ex.isChecked())) await ex.uncheck({ force: true });
  }
  await submit(page);
}

async function addAllDetails(page, details, entry, skipFirst = 0) {
  for (let i = skipFirst; i < details.length; i++) {
    let opened = false;
    if (i === 0) {
      const rows = page.locator('table tbody tr');
      for (let r = 0; r < (await rows.count()) && !opened; r++) {
        if (await rows.nth(r).locator('button').count()) {
          await rows.nth(r).locator('button').first().click();
          await page.waitForTimeout(600);
          opened = !!(await modalFields(page));
          if (opened) console.log('  edit placeholder row');
        }
      }
    }
    if (!opened) {
      await page.locator(':text-is("Add")').first().click({ timeout: 8000 });
      await page.waitForTimeout(600);
      console.log(`  Add detail ${i + 1}`);
    }
    await fillForm(page, details[i], entry);
    console.log(`  detail ${i + 1}/${details.length} submitted`);
  }
}

async function main() {
  const report = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const get = (code) => report.samples.find((s) => s.code === code);
  const context = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1400, height: 900 } });
  const page = context.pages()[0] || (await context.newPage());
  const results = [];

  // Options
  for (const code of ['SAMPLE-S3A01-2', 'SAMPLE-S4D01']) {
    const s = get(code);
    const entry = { code, forms: [] };
    console.log(`\n===== ${code} ${s.calcType} =====`);
    try {
      await expand(page, s.page, code);
      await addAllDetails(page, s.details, entry);
      entry.status = 'details-done';
      entry.afterBody = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 1100));
    } catch (e) { entry.status = 'error'; entry.error = e.message.split('\n')[0]; console.error(' ERROR', entry.error); await page.keyboard.press('Escape').catch(() => {}); }
    s.fix2 = entry; results.push(entry);
    fs.writeFileSync(SRC, JSON.stringify(report, null, 2), 'utf8');
  }

  // Gross Excess correct semantics: in_excess_of=30000, for_every=5000, amount=15
  {
    const s = get('SAMPLE-S3A01-1X');
    const entry = { code: s.code, forms: [] };
    console.log('\n===== Gross Excess semantics fix =====');
    try {
      await expand(page, s.page, s.code);
      const row = page.locator('table tbody tr').first();
      await row.locator('button').first().click();
      await page.waitForTimeout(600);
      await fillForm(page, { in_excess_of: 30000, for_every: 5000, amount: 15 }, entry);
      entry.status = 'fixed';
      entry.afterBody = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 900));
      s.details = [{ in_excess_of: 30000, for_every: 5000, amount: 15 }];
      s.source += ' -> in_excess_of 30000, for_every 5000, amount 15 (base brackets in Gross/Capital Range)';
    } catch (e) { entry.status = 'error'; entry.error = e.message.split('\n')[0]; }
    s.fix2 = entry; results.push(entry);
    fs.writeFileSync(SRC, JSON.stringify(report, null, 2), 'utf8');
  }

  // Capital Range remaining details (first already edited)
  {
    const s = get('SAMPLE-S3A01-1C');
    const entry = { code: s.code, forms: [] };
    console.log('\n===== Capital Range remaining =====');
    try {
      await expand(page, s.page, s.code);
      await addAllDetails(page, s.details, entry, 1);
      entry.status = 'details-done';
      entry.afterBody = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 1100));
    } catch (e) { entry.status = 'error'; entry.error = e.message.split('\n')[0]; console.error(' ERROR', entry.error); await page.keyboard.press('Escape').catch(() => {}); }
    s.fix2 = entry; results.push(entry);
    fs.writeFileSync(SRC, JSON.stringify(report, null, 2), 'utf8');
  }

  await context.close();
  console.log('\n[done]');
  results.forEach((r) => console.log(` ${r.code}: ${r.status}`));
}

main().catch((e) => { console.error(e); process.exit(1); });
