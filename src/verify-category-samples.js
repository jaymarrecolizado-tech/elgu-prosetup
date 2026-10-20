const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PROFILE = path.join(__dirname, '..', '.auth', 'chrome-profile');
const OUT = path.join(__dirname, '..', 'elgu_samples_by_category.json');
const BASE = 'https://elgu-r2-training-core.oueg.info';

async function main() {
  const context = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1400, height: 900 } });
  const page = context.pages()[0] || (await context.newPage());
  const api = [];
  page.on('response', async (res) => {
    const ct = res.headers()['content-type'] || '';
    if (!ct.includes('json')) return;
    const url = res.url();
    if (!/tax_revenues|fixed_fees|other_fees/.test(url)) return;
    const body = await res.json().catch(() => null);
    if (body) api.push({ url, body });
  });

  const report = { verifiedAt: new Date().toISOString(), items: [] };

  // tax revenue pages
  for (const [slug, typeId, code, expectAmt] of [
    ['permit', 2, 'SAMPLE-S3A01-6', '120.00'],
    ['sanitary', 3, 'SAMPLE-S4F01', '50.00'],
    ['garbage', 4, 'SAMPLE-S5B01', '420.00'],
  ]) {
    api.length = 0;
    await page.goto(`${BASE}/bpls/tax-revenue/${slug}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await page.getByText(code, { exact: false }).first().click();
    await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const list = api.find((a) => /tax_revenues\?/.test(a.url));
    const item = list?.body?.data?.find((d) => d.attributes.code === code);
    const calc = api.find((a) => item && a.url.includes(`tax_revenues/${item.id}/calculations?`));
    const details = api.filter((a) => /calculations\/\d+\/details/.test(a.url)).map((a) => a.body?.data).flat();
    const ranges = (calc?.body?.included || []).filter((i) => /ranges|details|fixed/i.test(i.type));
    const detailAttrs = details.flatMap((d) => (Array.isArray(d) ? d : [d])).map((d) => d?.attributes).filter(Boolean);
    const entry = {
      slug, code, id: item?.id, name: item?.attributes?.name,
      calc: calc?.body?.data?.[0]?.attributes,
      details: detailAttrs,
      included: ranges.map((r) => r.attributes),
      expectAmt,
      ok: detailAttrs.some((a) => a.amount === expectAmt) || ranges.some((r) => r.attributes?.amount === expectAmt),
    };
    console.log(JSON.stringify(entry, null, 2));
    report.items.push(entry);
  }

  // fixed + other
  for (const [slug, code, expectAmt] of [
    ['new-fixed-fees', 'SAMPLE-S4H01', '50.00'],
    ['new-other-fees', 'SAMPLE-S3X01', '25.00'],
  ]) {
    api.length = 0;
    await page.goto(`${BASE}/bpls/tax-revenue/${slug}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await page.getByText(code, { exact: false }).first().click();
    await page.waitForTimeout(1000);
    const list = api.find((a) => /(fixed_fees|other_fees)\?/.test(a.url));
    const item = list?.body?.data?.find((d) => d.attributes.code === code);
    const detail = api.find((a) => item && a.url.includes(`/${item.id}?`));
    const attrs = detail?.body?.data?.attributes || item?.attributes;
    const entry = {
      slug, code, id: item?.id, attrs,
      expectAmt,
      ok: attrs?.amount === expectAmt || attrs?.amount_human === expectAmt,
    };
    console.log(JSON.stringify(entry, null, 2));
    report.items.push(entry);
  }

  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  prev.verify = report;
  fs.writeFileSync(OUT, JSON.stringify(prev, null, 2), 'utf8');
  await context.close();
  console.log('\nSUMMARY');
  report.items.forEach((i) => console.log(`  ${i.slug} ${i.code}: ${i.ok ? 'OK' : 'CHECK'} amt=${i.details?.[0]?.amount || i.attrs?.amount || i.included?.[0]?.amount}`));
}

main().catch((e) => { console.error(e); process.exit(1); });
