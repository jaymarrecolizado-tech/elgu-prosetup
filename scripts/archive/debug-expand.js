const path = require('path');
const { chromium } = require('playwright');
const PROFILE = path.join(__dirname, '..', '.auth', 'chrome-profile');
const BASE = 'https://elgu-r2-training-core.oueg.info';
(async () => {
  const context = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1400, height: 900 } });
  const page = context.pages()[0] || (await context.newPage());
  const slug = process.argv[2] || 'permit';
  const code = process.argv[3] || 'SAMPLE-S3A01-1C';
  await page.goto(`${BASE}/bpls/tax-revenue/${slug}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.evaluate((code) => {
    const els = [...document.querySelectorAll('div,span,a,h5,h6,li')];
    const el = els.find((e) => e.innerText?.trim().endsWith(code) && e.innerText.trim().length < code.length + 12) || els.find((e) => e.innerText?.includes(code));
    console.log('click target:', el?.tagName, el?.className, JSON.stringify(el?.innerText?.slice(0, 80)));
    el?.click();
  }, code);
  await page.waitForTimeout(1200);
  const info = await page.evaluate(() => {
    const tables = [...document.querySelectorAll('table')].map((t, ti) => ({
      ti, visible: t.offsetParent !== null,
      rows: [...t.querySelectorAll('tbody tr')].map((tr) => ({ text: tr.innerText.replace(/\s+/g, ' ').slice(0, 90), visible: tr.offsetParent !== null, buttons: tr.querySelectorAll('button').length })),
    }));
    const body = document.body.innerText.replace(/\s+/g, ' ');
    return { tables, snippet: body.slice(body.indexOf('Calculations'), body.indexOf('Calculations') + 400) };
  });
  console.log(JSON.stringify(info, null, 2));
  await context.close();
})().catch((e) => { console.error(e); process.exit(1); });
