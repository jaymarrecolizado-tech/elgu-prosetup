const path = require('path');
const { chromium } = require('playwright');
const PROFILE = path.join(__dirname, '..', '.auth', 'chrome-profile');
const BASE = 'https://elgu-r2-training-core.oueg.info';
(async () => {
  const [slug, code, calcType] = [process.argv[2], process.argv[3], process.argv[4]];
  const context = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1400, height: 900 } });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(`${BASE}/bpls/tax-revenue/${slug}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.evaluate((code) => {
    const els = [...document.querySelectorAll('div,span,a,h5,h6,li')];
    const el = els.find((e) => e.innerText?.trim().endsWith(code) && e.innerText.trim().length < code.length + 12) || els.find((e) => e.innerText?.includes(code));
    el?.click();
  }, code);
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /Add Calculations/ }).first().click();
  await page.waitForTimeout(700);
  const rs = page.locator('.modal.show input[id^="react-select"]');
  await rs.first().click({ force: true });
  await page.waitForTimeout(500);
  await page.getByText(calcType, { exact: true }).first().click();
  await page.waitForTimeout(500);

  const dom = await page.evaluate(() => {
    const m = document.querySelector('.modal.show');
    const inputs = [...m.querySelectorAll('input')].map((e, i) => ({ i, type: e.type, name: e.name, id: e.id, cls: e.className, visible: e.offsetParent !== null, rect: e.getBoundingClientRect().toJSON() }));
    return { inputs, html: m.innerHTML.slice(m.innerHTML.indexOf('Multiplier'), m.innerHTML.indexOf('Multiplier') + 1200) };
  });
  console.log(JSON.stringify(dom, null, 2));

  // Click the unnamed input's container
  await page.evaluate(() => {
    const m = document.querySelector('.modal.show');
    const el = [...m.querySelectorAll('input')].find((e) => !e.name && !e.id.startsWith('react-select') && e.type === 'text');
    el?.focus(); el?.click();
    el?.closest('div')?.click();
  });
  await page.waitForTimeout(700);
  const opts = await page.evaluate(() => [...document.querySelectorAll('[id*="-option-"], [class*="option"], [role="option"], [role="listbox"] *')].map((e) => e.innerText?.trim()).filter(Boolean).slice(0, 30));
  console.log('options after click:', JSON.stringify(opts));
  await page.keyboard.press('Escape');
  await context.close();
})().catch((e) => { console.error(e); process.exit(1); });
