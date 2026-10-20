const path = require('path');
const { chromium } = require('playwright');
const PROFILE = path.join(__dirname, '..', '.auth', 'chrome-profile');
const BASE = 'https://elgu-r2-training-core.oueg.info';
(async () => {
  const context = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1400, height: 900 } });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(`${BASE}/bpls/tax-revenue/permit`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.evaluate(() => {
    const els = [...document.querySelectorAll('div,span,a,h5,h6,li')];
    const el = els.find((e) => e.innerText?.trim().endsWith('SAMPLE-S3A01-2') && e.innerText.trim().length < 30) || els.find((e) => e.innerText?.includes('SAMPLE-S3A01-2'));
    el?.click();
  });
  await page.waitForTimeout(900);
  await page.locator(':text-is("Add")').first().click();
  await page.waitForTimeout(700);
  const mult = page.locator('.modal.show input[name="multiplier"]');
  await mult.click();
  await mult.pressSequentially('rural_thrift_savings_banks', { delay: 10 });
  const amt = page.locator('.modal.show input[name="amount"]');
  await amt.click();
  await amt.pressSequentially('220', { delay: 10 });
  console.log('values before submit:', await mult.inputValue(), '|', await amt.inputValue());
  await page.locator('.modal.show button:has-text("Submit")').first().click();
  await page.waitForTimeout(1500);
  const state = await page.evaluate(() => ({
    modalOpen: !!document.querySelector('.modal.show'),
    body: document.body.innerText.replace(/\s+/g, ' ').slice(0, 1600),
  }));
  console.log('modalOpen:', state.modalOpen);
  console.log(state.body.slice(state.body.indexOf('Bank Type'), state.body.indexOf('Bank Type') + 400));
  await context.close();
})().catch((e) => { console.error(e); process.exit(1); });
