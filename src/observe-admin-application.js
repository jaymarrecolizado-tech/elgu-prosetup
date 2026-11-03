/**
 * Watch admin processing of SAMPLE CON 41001 BUILDERS.
 * Searches Applications / API. Does not Approve or Reject.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { launch, BASE_URL } = require('./executor/browser');

const ADMIN = BASE_URL;
const API = 'https://elgu-r2-training-ws.oueg.info/api/v1/bpls/administrator';
const SAMPLE = 'SAMPLE CON 41001 BUILDERS';
const OUT = path.join(__dirname, '..', 'logs', 'admin-process-recon.json');

async function settle(page, ms = 800) {
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

async function body(page) {
  return page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' '));
}

async function bearer(page) {
  const raw = await page.evaluate(() => localStorage.getItem('token') || '');
  const tok = String(raw).replace(/^"|"$/g, '').replace(/^Bearer\s+/i, '');
  return tok ? `Bearer ${tok}` : '';
}

async function spaGet(page, url) {
  const res = await page.request.fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: await bearer(page) },
    failOnStatusCode: false,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  return { status: res.status(), json, text: text.slice(0, 800) };
}

function flattenAttrs(payload) {
  const rows = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node.attributes || node.business_name || node.name) {
      const a = node.attributes || node;
      rows.push({
        id: node.id || a.id,
        type: node.type,
        name: a.name,
        business_name: a.business_name,
        status: a.status || a.application_status || a.application_status_id,
        module_id: a.module_id,
        transaction_no: a.transaction_no || a.bin,
        ...a,
      });
    }
    Object.values(node).forEach((v) => {
      if (v && typeof v === 'object') walk(v);
    });
  };
  walk(payload);
  return rows;
}

async function dump(page) {
  return page.evaluate(() => {
    const t = (el) => (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 160);
    return {
      url: location.href,
      headings: [...document.querySelectorAll('h1,h2,h3,h4')].map(t).filter(Boolean).slice(0, 25),
      buttons: [...document.querySelectorAll('button, a.btn, [role=button]')].map(t).filter(Boolean).slice(0, 60),
      tabs: [...document.querySelectorAll('[role=tab], .nav-link, a')].map(t).filter((s) => /evaluat|assess|endors|new|renew|payment|print|issued/i.test(s)).slice(0, 40),
      rows: [...document.querySelectorAll('table tbody tr, .generic-list-item')].map(t).filter(Boolean).slice(0, 25),
      body: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 2000),
    };
  });
}

async function searchUi(page, q) {
  const box = page.locator('input[type="search"], input[placeholder*="Search" i], input[name="q"]').first();
  if (await box.count()) {
    await box.click();
    await box.fill('');
    await box.pressSequentially(q, { delay: 20 });
    await page.keyboard.press('Enter');
    await settle(page, 1200);
    return true;
  }
  return false;
}

async function dismiss(page) {
  await page.keyboard.press('Escape').catch(() => {});
  const skip = page.getByRole('button', { name: /^(Skip|Close|×)$/i }).first();
  if (await skip.count()) await skip.click({ force: true }).catch(() => {});
  await page.waitForTimeout(300);
}

async function main() {
  const { context, page } = await launch({
    headless: false,
    slowMo: 40,
    pattern: /transaction|application|permit|evaluat|assess|business/i,
  });
  const report = { observedAt: new Date().toISOString(), sample: SAMPLE, apiHits: [], pages: [] };

  await page.goto(`${ADMIN}/bpls/transactions`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await settle(page, 1000);
  const skip = page.getByRole('button', { name: /Skip|Close|×/i }).first();
  if (await skip.count()) await skip.click({ force: true }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await settle(page, 400);
  if (/log\s*in/i.test(await body(page)) && /\/login/i.test(page.url())) {
    throw new Error('admin session lost — log in then rerun');
  }

  const queries = ['SAMPLE CON 41001', 'SAMPLE CON', 'PARITO', '41001', 'CON41001'];
  for (const q of queries) {
    const url = `${API}/transaction_histories/permits?module_type=BPLS&q=${encodeURIComponent(q)}`;
    const res = await spaGet(page, url);
    const rows = flattenAttrs(res.json).filter((r) =>
      /SAMPLE CON|41001|PARITO|CON41001/i.test(JSON.stringify(r)),
    );
    console.log('[elgu] api q=', q, 'status', res.status, 'hits', rows.length);
    report.apiHits.push({ q, status: res.status, hits: rows.slice(0, 5).map((r) => ({
      id: r.id, name: r.name, business_name: r.business_name, status: r.status, module_id: r.module_id,
    })) });
    if (rows.length) break;
  }

  const extra = [
    `${API}/transaction_histories/permits/?`,
    `${API}/businesses?q=${encodeURIComponent('SAMPLE CON')}&sort_by=desc`,
    `${API}/businesses?q=${encodeURIComponent('PARITO')}&sort_by=desc`,
  ];
  for (const url of extra) {
    const res = await spaGet(page, url);
    const rows = flattenAttrs(res.json).filter((r) => /SAMPLE CON|41001|PARITO|CON41001/i.test(JSON.stringify(r)));
    console.log('[elgu] extra', url.split('?')[0], rows.length, rows.slice(0, 3).map((r) => r.business_name || r.name));
    if (rows.length) report.apiHits.push({ url, hits: rows.slice(0, 8) });
  }

  await page.goto(`${ADMIN}/bpls/applications`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await settle(page, 1200);
  report.pages.push(await dump(page));
  console.log('[elgu] applications', page.url(), (await body(page)).slice(0, 400));

  await page.keyboard.press('Escape').catch(() => {});
  let snap = await dump(page);

  let loc = page.getByText(/SAMPLE CON 41001/i).first();
  if (!(await loc.count())) loc = page.getByText(/PARITO/i).first();
  if (await loc.count()) {
    await loc.click();
    await settle(page, 1800);
  } else {
    console.log('[elgu] SAMPLE CON 41001 is not in Applications (citizen summary was never Submit). Opening JUANITO PARITO txn 374 to show the admin process.');
    for (const id of ['374', '357']) {
      const detail = await spaGet(page, `${API}/transaction_histories/permits/${id}?`);
      const fees = await spaGet(page, `${API}/transaction_histories/permits/${id}/endorsing_office_fees?`);
      report.apiHits.push({ permit: id, detail: detail.json, endorsing: fees.json });
      console.log('[elgu] permit', id, JSON.stringify(detail.json).slice(0, 500));
      await page.goto(`${ADMIN}/bpls/applications/new/${id}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await settle(page, 1500);
      snap = await dump(page);
      snap.permitId = id;
      report.pages.push(snap);
      console.log('[elgu] opened', page.url());
      console.log('[elgu] buttons', snap.buttons);
      console.log('[elgu] body', snap.body.slice(0, 1000));
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('[elgu] wrote', OUT);
  console.log('[elgu] Browser stays open.');
  while (context.browser()?.isConnected()) await page.waitForTimeout(2000);
  await context.close().catch(() => {});
}

main().catch((err) => {
  console.error('[elgu] Fatal:', err);
  process.exit(1);
});
