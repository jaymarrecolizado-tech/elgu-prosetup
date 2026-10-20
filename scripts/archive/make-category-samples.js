/**
 * Create ONE SAMPLE-prefixed fee on each of:
 * Permit, Sanitary, Garbage (tax_revenues + Fixed Amount calc),
 * Fixed Fees, Other Fees.
 * Based on revenue_fees.json; never touches the License SAMPLE already created.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(ROOT, '.auth', 'chrome-profile');
const OUT = path.join(ROOT, 'elgu_samples_by_category.json');
const BASE = 'https://elgu-r2-training-core.oueg.info';

const SAMPLES = [
  {
    page: 'permit',
    kind: 'tax_revenue',
    code: 'SAMPLE-S3A01-6',
    description: "Mayor's Permit Fee on All Other Unenumerated Business Establishments",
    article_section: 'Section 3A.01(6)',
    calculation: 'Fixed Amount',
    amount: 120,
  },
  {
    page: 'sanitary',
    kind: 'tax_revenue',
    code: 'SAMPLE-S4F01',
    description: 'Dog Vaccination Fee',
    article_section: 'Section 4F.01',
    calculation: 'Fixed Amount',
    amount: 50,
  },
  {
    page: 'garbage',
    kind: 'tax_revenue',
    code: 'SAMPLE-S5B01',
    description: 'Service Charge for Garbage Collection (Manufacturers ≤100 sq.m / mo)',
    article_section: 'Section 5B.01',
    calculation: 'Fixed Amount',
    amount: 420,
  },
  {
    page: 'new-fixed-fees',
    kind: 'fixed_fee',
    code: 'SAMPLE-S4H01',
    description: 'Clearance or Certification Fee (Other purposes)',
    article_section: 'Section 4H.01',
    amount: 50,
    multiplier: null, // leave as Select / none if optional
  },
  {
    page: 'new-other-fees',
    kind: 'other_fee',
    code: 'SAMPLE-S3X01',
    description: 'License Fee on Acquisition of Dogs',
    article_section: 'Section 3X.01',
    amount: 25,
    feeType: 'BASIC',
    feeClass: 'COMMON FEE',
  },
];

async function dump(page, label) {
  const ui = await page.evaluate(() => {
    const txt = (e) => (e?.innerText || '').replace(/\s+/g, ' ').trim();
    const m = document.querySelector('.modal.show, [role=dialog]');
    return {
      body: txt(document.body).slice(0, 2800),
      modal: m ? {
        title: txt(m.querySelector('.modal-title,h4,h5')),
        text: txt(m).slice(0, 800),
        fields: [...m.querySelectorAll('input,select,textarea')].filter((e) => e.type !== 'hidden')
          .map((e) => ({ type: e.type, name: e.name || null, id: e.id || null, placeholder: e.placeholder || null, value: e.value })),
        buttons: [...m.querySelectorAll('button')].map((e) => txt(e)).filter(Boolean),
      } : null,
    };
  });
  console.log(`--- ${label} ---`);
  console.log(JSON.stringify(ui.modal || { body: ui.body.slice(0, 400) }, null, 2).slice(0, 2000));
  return ui;
}

async function selectReact(page, optionText, index = 0) {
  const inputs = page.locator('.modal.show input[id^="react-select"], [role=dialog] input[id^="react-select"]');
  const input = inputs.nth(index);
  await input.click({ force: true });
  await page.waitForTimeout(500);
  await page.getByText(optionText, { exact: true }).first().click();
  await page.waitForTimeout(400);
}

async function ensureChecked(page, name) {
  const cb = page.locator(`.modal.show input[name="${name}"], [role=dialog] input[name="${name}"]`);
  if (await cb.count() && !(await cb.isChecked())) await cb.check({ force: true });
}

async function submitModal(page) {
  await page.locator('.modal.show button:has-text("Submit"), [role=dialog] button:has-text("Submit")').first().click();
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(1000);
}

async function openOrSkipIfExists(page, code) {
  const count = await page.getByText(code, { exact: false }).count();
  return count > 0;
}

async function createTaxRevenueSample(page, sample, log) {
  const url = `${BASE}/bpls/tax-revenue/${sample.page}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

  if (await openOrSkipIfExists(page, sample.code)) {
    console.log(`[${sample.page}] already exists: ${sample.code}`);
    log.status = 'exists';
    await page.getByText(sample.code, { exact: false }).first().click();
    await page.waitForTimeout(800);
    return;
  }

  await page.getByRole('button', { name: /Add Tax Revenue/ }).first().click();
  await page.waitForTimeout(800);
  await page.locator('input[name="code"]').fill(sample.code);
  await page.locator('textarea[name="description"]').fill(sample.description);
  await submitModal(page);
  console.log(`[${sample.page}] tax revenue created: ${sample.code}`);

  await page.getByText(sample.code, { exact: false }).first().click();
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(800);

  const hasCalc = await page.getByText('Fixed Amount', { exact: false }).count();
  if (!hasCalc) {
    await page.getByRole('button', { name: /Add Calculations/ }).first().click();
    await page.waitForTimeout(800);
    await selectReact(page, sample.calculation);
    await ensureChecked(page, 'for_new');
    await ensureChecked(page, 'for_renewal');
    // retirement optional — leave unchecked for fixed permit/sanitary/garbage samples (matches live samples)
    await submitModal(page);
    console.log(`[${sample.page}] Fixed Amount calculation created`);
  }

  // Fixed Amount detail: either edit existing 0.00 row or Add
  const body = await page.evaluate(() => document.body.innerText);
  if (/Fixed Amount[\s\S]*?0\.00/.test(body) || /Actions[\s\S]*?0\.00/.test(body)) {
    // Try edit first row amount
    const row = page.locator('tr').filter({ hasText: '0.00' }).first();
    if (await row.count()) {
      await row.locator('button').first().click();
      await page.waitForTimeout(700);
      const amountField = page.locator('.modal.show input[name="amount"], [role=dialog] input[name="amount"]');
      if (await amountField.count()) {
        await amountField.fill(String(sample.amount));
        await submitModal(page);
        console.log(`[${sample.page}] edited amount → ${sample.amount}`);
        log.status = 'created';
        return;
      }
      await page.keyboard.press('Escape');
    }
  }

  // Add detail if Add button present under calculations
  if (await page.locator(':text-is("Add")').count()) {
    await page.locator(':text-is("Add")').first().click();
    await page.waitForTimeout(700);
    await dump(page, `${sample.page} add-detail`);
    const amountField = page.locator('.modal.show input[name="amount"], [role=dialog] input[name="amount"]');
    if (await amountField.count()) {
      await amountField.fill(String(sample.amount));
      await submitModal(page);
      console.log(`[${sample.page}] added amount detail → ${sample.amount}`);
      log.status = 'created';
      return;
    }
  }
  log.status = 'partial';
  log.note = 'tax revenue + calc created; amount detail may need manual check';
}

async function createFixedFeeSample(page, sample, log) {
  await page.goto(`${BASE}/bpls/tax-revenue/new-fixed-fees`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

  if (await openOrSkipIfExists(page, sample.code)) {
    console.log(`[fixed] already exists: ${sample.code}`);
    log.status = 'exists';
    return;
  }

  await page.getByRole('button', { name: /Add Fixed Fee/ }).first().click();
  await page.waitForTimeout(900);
  await dump(page, 'fixed-fee modal');
  await page.locator('input[name="code"]').fill(sample.code);
  // Fixed fee description is often input[name=description] text, not textarea
  const desc = page.locator('.modal.show textarea[name="description"], .modal.show input[name="description"]');
  await desc.first().fill(sample.description);
  await page.locator('.modal.show input[name="amount"]').fill(String(sample.amount));
  await ensureChecked(page, 'for_new');
  await ensureChecked(page, 'for_renewal');
  await submitModal(page);
  console.log(`[fixed] created: ${sample.code} amount=${sample.amount}`);
  log.status = 'created';
}

async function createOtherFeeSample(page, sample, log) {
  await page.goto(`${BASE}/bpls/tax-revenue/new-other-fees`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

  if (await openOrSkipIfExists(page, sample.code)) {
    console.log(`[other] already exists: ${sample.code}`);
    log.status = 'exists';
    return;
  }

  await page.getByRole('button', { name: /Add Other Fee/ }).first().click();
  await page.waitForTimeout(900);
  await dump(page, 'other-fee modal');
  await page.locator('input[name="code"]').fill(sample.code);
  const desc = page.locator('.modal.show textarea[name="description"], .modal.show input[name="description"]');
  await desc.first().fill(sample.description);

  // First react-select = fee type (BASIC etc), second = COMMON FEE / SPECIFIC FEE
  await selectReact(page, sample.feeType, 0);
  await selectReact(page, sample.feeClass, 1);

  // Amount may appear after selecting BASIC
  await page.waitForTimeout(500);
  const amount = page.locator('.modal.show input[name="amount"]');
  if (await amount.count()) await amount.fill(String(sample.amount));

  await ensureChecked(page, 'for_new');
  await ensureChecked(page, 'for_renewal');
  await submitModal(page);
  await dump(page, 'other-fee after submit');
  console.log(`[other] created: ${sample.code} amount=${sample.amount}`);
  log.status = 'created';
}

async function main() {
  const report = { createdAt: new Date().toISOString(), samples: [] };
  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    viewport: { width: 1400, height: 900 },
  });
  const page = context.pages()[0] || (await context.newPage());

  for (const sample of SAMPLES) {
    const entry = { ...sample };
    console.log(`\n========== ${sample.page} / ${sample.code} ==========`);
    try {
      if (sample.kind === 'tax_revenue') await createTaxRevenueSample(page, sample, entry);
      else if (sample.kind === 'fixed_fee') await createFixedFeeSample(page, sample, entry);
      else if (sample.kind === 'other_fee') await createOtherFeeSample(page, sample, entry);
      entry.after = (await dump(page, `${sample.page} final`)).body?.slice(0, 500);
    } catch (e) {
      entry.status = 'error';
      entry.error = e.message.split('\n')[0];
      console.error(`[${sample.page}] ERROR`, entry.error);
      await page.keyboard.press('Escape').catch(() => {});
    }
    report.samples.push(entry);
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
  }

  await context.close();
  console.log('\n[done] wrote', OUT);
  report.samples.forEach((s) => console.log(`  ${s.page}: ${s.code} → ${s.status}${s.error ? ' (' + s.error + ')' : ''}`));
}

main().catch((e) => { console.error('[fatal]', e); process.exit(1); });
