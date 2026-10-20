/** Add/edit detail rows for fee-type samples created by make-fee-type-samples.js */
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
      text: m.innerText.replace(/\s+/g, ' ').trim().slice(0, 500),
      fields: [...m.querySelectorAll('input,select,textarea')].filter((e) => e.type !== 'hidden')
        .map((e) => ({ type: e.type, name: e.name || null, id: e.id || null, label: labelFor(e), value: e.value })),
    };
  });
}

async function setField(page, name, value) {
  const exists = await page.locator(`.modal.show [name="${name}"]`).count();
  if (!exists) return false;
  await page.evaluate(({ name, value }) => {
    const el = document.querySelector(`.modal.show [name="${name}"]`);
    const proto = el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ? HTMLInputElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set.call(el, String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }, { name, value });
  return true;
}

async function submit(page) {
  await page.locator('.modal.show button:has-text("Submit")').first().click();
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(700);
}

async function fillDetail(page, d, entry) {
  const form = await modalFields(page);
  entry.forms.push(form);
  console.log('   form:', JSON.stringify(form));
  if (!form) throw new Error('detail modal did not open');
  const names = form.fields.map((f) => f.name);
  for (const k of ['from', 'to', 'amount', 'rate', 'quantity', 'label', 'name', 'description']) {
    if (d[k] !== undefined && names.includes(k)) await setField(page, k, d[k]);
  }
  if (d.label && !names.some((n) => ['label', 'name', 'description'].includes(n))) {
    // unnamed text input (options label?) — fill first unnamed text field
    const idx = form.fields.findIndex((f) => f.type === 'text' && !f.name && !f.id?.startsWith('react-select'));
    if (idx >= 0) {
      await page.locator('.modal.show input[type="text"]').nth(idx).fill(d.label).catch(() => {});
      console.log('   filled unnamed text field with label');
    }
    // react-select for label? leave — form dump records it
  }
  const ex = page.locator('.modal.show input[name="for_excess_computation"]');
  if (await ex.count()) {
    if (d.forExcess && !(await ex.isChecked())) await ex.check({ force: true });
    if (!d.forExcess && (await ex.isChecked())) await ex.uncheck({ force: true });
  }
  await submit(page);
}

async function main() {
  const report = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const context = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1400, height: 900 } });
  const page = context.pages()[0] || (await context.newPage());

  for (const sample of report.samples) {
    const entry = { code: sample.code, page: sample.page, calcType: sample.calcType, forms: [], status: 'started' };
    console.log(`\n===== ${sample.code} ${sample.calcType} =====`);
    try {
      await page.goto(`${BASE}/bpls/tax-revenue/${sample.page}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      await page.getByText(sample.code, { exact: false }).first().click();
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(800);
      const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
      const idx = body.indexOf(sample.calcType);
      console.log('  calc snippet:', body.slice(Math.max(0, idx - 80), idx + 260));

      for (let i = 0; i < sample.details.length; i++) {
        let opened = false;
        if (i === 0) {
          const rows = page.locator('table tbody tr');
          for (let r = 0; r < (await rows.count()) && !opened; r++) {
            if (await rows.nth(r).locator('button').count()) {
              await rows.nth(r).locator('button').first().click();
              await page.waitForTimeout(700);
              opened = !!(await modalFields(page));
              if (opened) console.log(`   edit row ${r} for detail 1`);
            }
          }
        }
        if (!opened) {
          await page.locator(':text-is("Add")').first().click({ timeout: 8000 });
          await page.waitForTimeout(700);
          console.log(`   Add detail ${i + 1}`);
        }
        await fillDetail(page, sample.details[i], entry);
        console.log(`   detail ${i + 1}/${sample.details.length} done`);
      }
      entry.status = 'details-done';
      entry.afterBody = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 1000));
    } catch (e) {
      entry.status = 'error';
      entry.error = e.message.split('\n')[0];
      console.error('  ERROR', entry.error);
      await page.keyboard.press('Escape').catch(() => {});
    }
    sample.fix = entry;
    fs.writeFileSync(SRC, JSON.stringify(report, null, 2), 'utf8');
  }

  await context.close();
  console.log('\n[done]');
  report.samples.forEach((s) => console.log(` ${s.code} ${s.calcType}: ${s.fix?.status}`));
}

main().catch((e) => { console.error(e); process.exit(1); });
