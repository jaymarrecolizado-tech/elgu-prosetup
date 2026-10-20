/** Round 7: keyboard typing for masked/code fields */
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

async function typeInto(page, name, value) {
  const loc = page.locator(`.modal.show [name="${name}"]`);
  await loc.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await loc.pressSequentially(String(value), { delay: 5 });
  await page.keyboard.press('Tab');
}

async function submit(page) {
  await page.locator('.modal.show button:has-text("Submit")').first().click({ timeout: 10_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(700);
  const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const toast = body.match(/successfully[^.]*/i)?.[0];
  console.log('  toast:', toast || '(none)');
}

const dataRows = (page) => page.locator('table tbody tr:has(button)');

async function editRow(page, idx, fields) {
  await dataRows(page).nth(idx).locator('button').first().click();
  await page.waitForTimeout(600);
  for (const [k, v] of Object.entries(fields)) await typeInto(page, k, v);
  await submit(page);
  console.log(`  edited row ${idx + 1}:`, JSON.stringify(fields));
}

async function addDetail(page, fields) {
  await page.locator(':text-is("Add")').first().click({ timeout: 8000 });
  await page.waitForTimeout(600);
  for (const [k, v] of Object.entries(fields)) await typeInto(page, k, v);
  await submit(page);
  console.log('  added:', JSON.stringify(fields));
}

async function main() {
  const report = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const context = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1400, height: 900 } });
  const page = context.pages()[0] || (await context.newPage());
  const results = [];
  const run = async (code, fn) => {
    console.log(`\n===== ${code} =====`);
    try { await fn(); results.push({ code, status: 'done' }); }
    catch (e) { results.push({ code, status: 'error', error: e.message.split('\n')[0] }); console.error(' ERROR', e.message.split('\n')[0]); await page.keyboard.press('Escape').catch(() => {}); }
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
  };

  await run('SAMPLE-S3A01-1C', async () => { await expand(page, 'permit', 'SAMPLE-S3A01-1C'); await editRow(page, 0, { amount: '30' }); });
  await run('SAMPLE-S3G01', async () => { await expand(page, 'permit', 'SAMPLE-S3G01'); await editRow(page, 0, { amount: '150' }); });
  await run('SAMPLE-S4D01', async () => { await expand(page, 'sanitary', 'SAMPLE-S4D01'); await editRow(page, 0, { amount: '100' }); });
  await run('SAMPLE-S3A01-2', async () => {
    await expand(page, 'permit', 'SAMPLE-S3A01-2');
    // rows now: [option/0 placeholder, rural_thrift_savings_banks/220]
    await editRow(page, 0, { multiplier: 'commercial_industrial_dev_banks', amount: '330' });
    await addDetail(page, { multiplier: 'universal_banks_insurance', amount: '220' });
    await addDetail(page, { multiplier: 'pawnshops_money_shops_lending', amount: '440' });
    const s = report.samples.find((x) => x.code === 'SAMPLE-S3A01-2');
    if (s) s.details = [
      { multiplier: 'rural_thrift_savings_banks', amount: 220 },
      { multiplier: 'commercial_industrial_dev_banks', amount: 330 },
      { multiplier: 'universal_banks_insurance', amount: 220 },
      { multiplier: 'pawnshops_money_shops_lending', amount: 440 },
    ];
  });

  await context.close();
  console.log('\n[done]');
  results.forEach((r) => console.log(` ${r.code}: ${r.status}`));
}

main().catch((e) => { console.error(e); process.exit(1); });
