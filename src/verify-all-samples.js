/** API audit of ALL SAMPLE-* records across Tax Revenue pages */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(ROOT, '.auth', 'chrome-profile');
const OUT = path.join(ROOT, 'elgu_sample_audit.json');
const BASE = 'https://elgu-r2-training-core.oueg.info';

const TAX_PAGES = [
  { slug: 'license', codes: ['SAMPLE-S2A02-A', 'SAMPLE-S2A02-F', 'SAMPLE-S2A02-D'] },
  { slug: 'permit', codes: ['SAMPLE-S3A01-6', 'SAMPLE-S3A01-2', 'SAMPLE-S3G01', 'SAMPLE-S3A01-1X', 'SAMPLE-S3A01-1C'] },
  { slug: 'sanitary', codes: ['SAMPLE-S4F01', 'SAMPLE-S4D01'] },
  { slug: 'garbage', codes: ['SAMPLE-S5B01'] },
];

async function main() {
  const context = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1400, height: 900 } });
  const page = context.pages()[0] || (await context.newPage());
  const api = [];
  page.on('response', async (res) => {
    if (!(res.headers()['content-type'] || '').includes('json')) return;
    if (!/tax_revenues|fixed_fees|other_fees/.test(res.url())) return;
    const body = await res.json().catch(() => null);
    if (body) api.push({ url: res.url(), body });
  });

  const report = { verifiedAt: new Date().toISOString(), tax: [], fees: [] };

  for (const { slug, codes } of TAX_PAGES) {
    api.length = 0;
    await page.goto(`${BASE}/bpls/tax-revenue/${slug}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    const list = api.find((a) => /tax_revenues\?/.test(a.url));
    const items = (list?.body?.data || []).filter((d) => codes.includes(d.attributes.code));
    for (const item of items) {
      // Fresh load per item so expansion/fetch is deterministic
      api.length = 0;
      await page.goto(`${BASE}/bpls/tax-revenue/${slug}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      await page.evaluate((code) => {
        const els = [...document.querySelectorAll('div,span,a,h5,h6,li')];
        const el = els.find((e) => e.innerText?.trim().endsWith(code) && e.innerText.trim().length < code.length + 12)
          || els.find((e) => e.innerText?.includes(code));
        el?.click();
      }, item.attributes.code);
      await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
      await page.waitForTimeout(700);
      const calcEntry = api.find((a) => a.url.includes(`tax_revenues/${item.id}/calculations?`));
      const calcs = (calcEntry?.body?.data || []).map((c) => ({
        ...c.attributes,
        included: (calcEntry.body.included || [])
          .filter((i) => i.type.includes('tax_revenue_calculation') && !i.type.includes('calculation_types'))
          .map((i) => ({ type: i.type, ...i.attributes })),
        detailEndpoints: api.filter((a) => a.url.includes(`/calculations/${c.id}/details`))
          .flatMap((a) => (Array.isArray(a.body?.data) ? a.body.data : [a.body?.data]).filter(Boolean).map((d) => d.attributes)),
      }));
      report.tax.push({ page: slug, id: item.id, code: item.attributes.code, name: item.attributes.name, description: item.attributes.description, calculations: calcs });
      console.log(slug, item.attributes.code, JSON.stringify(calcs).slice(0, 600));
    }
  }

  for (const [slug, code] of [['new-fixed-fees', 'SAMPLE-S4H01'], ['new-other-fees', 'SAMPLE-S3X01']]) {
    api.length = 0;
    await page.goto(`${BASE}/bpls/tax-revenue/${slug}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    const list = api.find((a) => /(fixed_fees|other_fees)\?/.test(a.url));
    const item = (list?.body?.data || []).find((d) => d.attributes.code === code);
    report.fees.push({ page: slug, id: item?.id, attrs: item?.attributes });
    console.log(slug, code, JSON.stringify(item?.attributes));
  }

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
  await context.close();
  console.log('[done]', OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
