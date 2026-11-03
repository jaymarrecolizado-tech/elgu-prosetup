/**
 * Tag live Tax Revenue onto (F) CONSTRUCTION lines and Activate.
 * Uses the logged-in SPA session (fetch + UI reload). Prefers CON-2A02-E /
 * BUS-3A01-1 / SEC-4D01; garbage falls back to AD-GRBG-001. No CSV import.
 */
require('dotenv').config();
const { launch, BASE_URL } = require('./executor/browser');

const NATURE_ID = 16;
const API = 'https://elgu-r2-training-ws.oueg.info/api/v1/bpls/administrator';
const WANTED = new Set([
  '41001', '41002', '42100', '42201', '42202', '42204', '42209', '42900',
  '43110', '43120', '43210', '43220', '43290', '43301', '43302', '43303',
  '43309', '43900',
]);
const TAG = {
  license_code: 'CON-2A02-E',
  permit_code: 'BUS-3A01-1',
  sanitary_code: 'SEC-4D01',
  garbage_code: 'AD-GRBG-001',
};

async function bearer(page) {
  const raw = await page.evaluate(() => localStorage.getItem('token') || '');
  const tok = String(raw).replace(/^"|"$/g, '').replace(/^Bearer\s+/i, '');
  return tok ? `Bearer ${tok}` : '';
}

async function spaFetch(page, method, url, data) {
  const headers = {
    Accept: 'application/json',
    Authorization: await bearer(page),
  };
  const res = await page.request.fetch(url, {
    method,
    headers,
    data: data === undefined ? undefined : data,
    failOnStatusCode: false,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status(), json, text: text.slice(0, 500) };
}

function collectLines(payload) {
  const out = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    const attrs = node.attributes || node;
    const code = attrs.code || node.code;
    const id = node.id || attrs.id;
    if (code && WANTED.has(String(code)) && id) {
      out.push({
        id: String(id),
        code: String(code),
        name: attrs.name || node.name,
        license_code: attrs.license_code || null,
        is_active: attrs.is_active,
      });
    }
    Object.values(node).forEach(walk);
  };
  walk(payload);
  const uniq = [];
  const seen = new Set();
  for (const row of out) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    uniq.push(row);
  }
  return uniq;
}

async function main() {
  const { context, page } = await launch({
    headless: false,
    slowMo: 40,
    pattern: /business.?natur|business.?line|tax_revenues|bpls/i,
  });
  page.on('request', (req) => {
    if (!['POST', 'PUT', 'PATCH'].includes(req.method())) return;
    console.log(`[req] ${req.method()} ${req.url()} ${(req.postData() || '').slice(0, 280)}`);
  });
  page.on('response', async (res) => {
    const method = res.request().method();
    if (!['POST', 'PUT', 'PATCH'].includes(method)) return;
    const text = await res.text().catch(() => '');
    console.log(`[api] ${method} ${res.status()} ${res.url()} ${text.slice(0, 280)}`);
  });

  console.log('[elgu] Tag + activate Construction — watch Chromium.');
  await page.goto(`${BASE_URL}/bpls/new-business/new-business-natures/${NATURE_ID}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForLoadState('networkidle', { timeout: 25_000 }).catch(() => {});
  await page.waitForTimeout(1200);

  const keys = await page.evaluate(() => [...Array(localStorage.length)].map((_, i) => localStorage.key(i)));
  console.log('[elgu] localStorage keys', keys);

  const got = await spaFetch(page, 'GET', `${API}/business/natures/${NATURE_ID}?include=lines&ordinance_revision_id=2`);
  console.log('[elgu] GET nature', got.status, got.text.slice(0, 220));
  let lines = collectLines(got.json);
  if (!lines.length) {
    const all = [];
    for (const q of [
      `ordinance_revision_id=2&page[size]=100`,
      `ordinance_revision_id=2&page=1`,
      `ordinance_revision_id=2&page=2`,
    ]) {
      const listed = await spaFetch(page, 'GET', `${API}/business/natures/${NATURE_ID}/lines?${q}`);
      console.log('[elgu] GET lines', q, listed.status, listed.text.slice(0, 180));
      all.push(...collectLines(listed.json));
    }
    lines = all;
  }
  {
    const seen = new Set();
    lines = lines.filter((l) => WANTED.has(l.code) && !seen.has(l.id) && seen.add(l.id));
  }
  console.log('[elgu] lines', lines.map((l) => `${l.id}:${l.code}`).join(', ') || '(none)');
  if (!lines.length) throw new Error('no Construction lines from API');

  const results = [];
  for (const line of lines) {
    const body = {
      code: line.code,
      name: line.name,
      ...TAG,
      other_fees: [],
      ordinance_revision_id: 2,
    };
    const upd = await spaFetch(page, 'PUT', `${API}/business/natures/${NATURE_ID}/lines/${line.id}`, body);
    console.log(`[elgu] tag ${line.code} id=${line.id} ${upd.status} ${upd.text.slice(0, 180)}`);
    const alreadyOn = line.is_active === 1 || line.is_active === true;
    const act = alreadyOn
      ? { status: 200, json: { message: 'already active' }, text: 'already active' }
      : await spaFetch(page, 'PUT', `${API}/business/natures/${NATURE_ID}/lines/${line.id}/activate`, {});
    console.log(`[elgu] activate ${line.code} ${act.status} ${act.text.slice(0, 180)}`);
    results.push({
      id: line.id,
      code: line.code,
      tag: upd.status,
      activate: act.status,
      activate_msg: act.json?.message || null,
    });
    await page.waitForTimeout(250);
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  const yes = results.filter((r) => r.activate === 200 || r.activate === 204);
  console.log('[elgu] DONE tagged', results.length, 'activated', yes.map((r) => r.code).join(', ') || '(none)');
  console.log('[elgu] results', JSON.stringify(results));
  await page.waitForTimeout(20_000);
  while (context.browser()?.isConnected()) await page.waitForTimeout(2000);
  await context.close().catch(() => {});
}

main().catch(async (err) => {
  console.error('[elgu] Fatal:', err);
  await new Promise((r) => setTimeout(r, 60_000));
  process.exit(1);
});
