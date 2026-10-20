/**
 * Fix Fixed Amount details for tax-revenue samples that were left at 0 / wrong value.
 * Also verifies Fixed Fee + Other Fee samples via UI text.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(ROOT, '.auth', 'chrome-profile');
const OUT = path.join(ROOT, 'elgu_samples_by_category.json');
const BASE = 'https://elgu-r2-training-core.oueg.info';

const FIXES = [
  { page: 'permit', code: 'SAMPLE-S3A01-6', amount: 120 },
  { page: 'sanitary', code: 'SAMPLE-S4F01', amount: 50 },
  { page: 'garbage', code: 'SAMPLE-S5B01', amount: 420 },
];

async function setNativeValue(page, selector, value) {
  await page.evaluate(({ selector, value }) => {
    const el = document.querySelector(selector);
    if (!el) throw new Error('missing ' + selector);
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter.call(el, String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }, { selector, value });
}

async function fixOne(page, { page: slug, code, amount }) {
  await page.goto(`${BASE}/bpls/tax-revenue/${slug}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.getByText(code, { exact: false }).first().click();
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(900);

  // Dismiss leftover modal if any
  if (await page.locator('.modal.show').count()) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }

  const snapshot = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  console.log(`[${slug}] snippet:`, snapshot.match(new RegExp(code + '.{0,220}'))?.[0]);

  // Prefer editing the Fixed Amount detail row (first data row under Actions)
  const rows = page.locator('table tbody tr, tr.top-border');
  const n = await rows.count();
  let edited = false;
  for (let i = 0; i < n; i++) {
    const text = await rows.nth(i).innerText();
    if (!/\d/.test(text)) continue;
    // click edit (first button)
    const btn = rows.nth(i).locator('button').first();
    if (!(await btn.count())) continue;
    await btn.click();
    await page.waitForTimeout(700);
    const modal = page.locator('.modal.show, [role=dialog]');
    if (!(await modal.count())) continue;
    const amountInput = modal.locator('input[name="amount"]');
    if (!(await amountInput.count())) {
      await page.keyboard.press('Escape');
      continue;
    }
    // Clear currency-masked field via native setter
    await amountInput.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await setNativeValue(page, '.modal.show input[name="amount"], [role=dialog] input[name="amount"]', amount.toFixed(2));
    await page.waitForTimeout(300);
    await modal.locator('button:has-text("Submit")').first().click();
    await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
    await page.waitForTimeout(800);
    edited = true;
    console.log(`[${slug}] set amount ${amount}`);
    break;
  }

  if (!edited && await page.locator(':text-is("Add")').count()) {
    await page.locator(':text-is("Add")').first().click();
    await page.waitForTimeout(700);
    await setNativeValue(page, '.modal.show input[name="amount"]', amount.toFixed(2));
    await page.locator('.modal.show button:has-text("Submit")').click();
    await page.waitForTimeout(800);
    console.log(`[${slug}] added amount ${amount}`);
    edited = true;
  }

  const after = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const match = after.match(new RegExp(code + '.{0,260}'));
  console.log(`[${slug}] after:`, match?.[0]);
  return { code, amount, edited, after: match?.[0] || after.slice(0, 300) };
}

async function verifyFixedOther(page) {
  const out = {};
  for (const [slug, code] of [
    ['new-fixed-fees', 'SAMPLE-S4H01'],
    ['new-other-fees', 'SAMPLE-S3X01'],
  ]) {
    await page.goto(`${BASE}/bpls/tax-revenue/${slug}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
    await page.getByText(code, { exact: false }).first().click();
    await page.waitForTimeout(800);
    const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
    out[slug] = body.match(new RegExp(code + '.{0,350}'))?.[0] || body.slice(0, 400);
    console.log(`[verify ${slug}]`, out[slug]);
  }
  return out;
}

async function main() {
  const context = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1400, height: 900 } });
  const page = context.pages()[0] || (await context.newPage());
  const results = { fixedAt: new Date().toISOString(), tax: [], extra: {} };
  for (const f of FIXES) {
    try { results.tax.push(await fixOne(page, f)); }
    catch (e) { results.tax.push({ ...f, error: e.message.split('\n')[0] }); console.error(e.message); }
  }
  results.extra = await verifyFixedOther(page);
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  prev.fix = results;
  fs.writeFileSync(OUT, JSON.stringify(prev, null, 2), 'utf8');
  await context.close();
  console.log('[done]');
}

main().catch((e) => { console.error(e); process.exit(1); });
