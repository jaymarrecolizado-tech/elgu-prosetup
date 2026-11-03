/**
 * Visible migrate of PSIC (F) CONSTRUCTION natures + active lines into
 * training admin. Uses the persistent .auth profile. Does not import CSV
 * and does not attach Claveria fee codes unless they already exist live.
 *
 * Skip inactive 42203. Prefer parser codes CON-2A02-E / BUS-3A01-1 /
 * SEC-4D01 / SEC-5B01 when those appear in the live dropdowns.
 */
require('dotenv').config();
const { launch, BASE_URL } = require('./executor/browser');
const { clickAction, submitModal, modalFields, MODAL_SCOPE } = require('./executor/modal');

const NATURE = { code: '2019-F', name: '(F) CONSTRUCTION' };

const LINES = [
  { code: '41001', name: 'Residential (dwelling) building constructions' },
  { code: '41002', name: 'Non-residential building constructions' },
  { code: '42100', name: 'Construction of roads and railways' },
  { code: '42201', name: 'Construction of telecommunication lines and pipelines' },
  { code: '42202', name: 'Water main and line construction' },
  { code: '42204', name: 'Construction of electric power lines' },
  { code: '42209', name: 'Other construction of utility projects, n.e.c.' },
  { code: '42900', name: 'Construction of other civil engineering projects' },
  { code: '43110', name: 'Demolition' },
  { code: '43120', name: 'Site preparation' },
  { code: '43210', name: 'Electrical installation' },
  { code: '43220', name: 'Plumbing, heat and air-conditioning installation' },
  { code: '43290', name: 'Other construction installation' },
  { code: '43301', name: 'Painting and related work' },
  { code: '43302', name: 'Floor and wall tiling or covering with other material' },
  { code: '43303', name: 'Carpentry' },
  { code: '43309', name: 'Other building completion and finishing activities' },
  { code: '43900', name: 'Other specialized construction activities' },
];

const FEE_PREFS = {
  license: ['CON-2A02-E', 'C2-AA-S2A02-E'],
  permit: ['BUS-3A01-1', 'C3-AA-S3A01-1'],
  sanitary: ['SEC-4D01', 'C4-AC-S4D01-B'],
  garbage: ['SEC-5B01', 'C5-AB-S5B01-G'],
};

const SELECT_INDEX = { license: 0, permit: 1, sanitary: 2, garbage: 3 };

async function fillCodeName(page, code, name) {
  const scope = page.locator(MODAL_SCOPE).last();
  const inputs = scope.locator('input:not([type=hidden]):not([id^="react-select"])');
  await inputs.nth(0).click();
  await inputs.nth(0).fill('');
  await inputs.nth(0).pressSequentially(String(code), { delay: 20 });
  await inputs.nth(1).click();
  await inputs.nth(1).fill('');
  await inputs.nth(1).pressSequentially(String(name), { delay: 15 });
}

async function optionTexts(page) {
  return page.locator('[class*="-option"]:visible').allInnerTexts();
}

async function pickFee(page, slot, prefs) {
  const inputs = page.locator(`${MODAL_SCOPE} input[id^="react-select"]`);
  const input = inputs.nth(SELECT_INDEX[slot]);
  if (!(await input.count())) {
    console.log(`[elgu] ${slot}: no react-select`);
    return null;
  }
  await input.click({ force: true });
  await page.waitForTimeout(450);
  let texts = (await optionTexts(page)).map((t) => t.replace(/\s+/g, ' ').trim());
  let hit = texts.find((t) => prefs.some((p) => t === p || t.includes(p)));
  if (!hit) {
    await input.fill(prefs[0]);
    await page.waitForTimeout(500);
    texts = (await optionTexts(page)).map((t) => t.replace(/\s+/g, ' ').trim());
    hit = texts.find((t) => prefs.some((p) => t === p || t.includes(p)));
  }
  if (hit) {
    await page.locator('[class*="-option"]:visible').filter({ hasText: hit }).first().click();
    await page.waitForTimeout(300);
    console.log(`[elgu] ${slot} → ${hit}`);
    return hit;
  }
  await page.locator(`${MODAL_SCOPE}`).getByText(/Name/i).first().click().catch(() => {});
  console.log(`[elgu] ${slot}: no live match among ${prefs.join(', ')} — leaving empty`);
  return null;
}

async function natureExists(page) {
  const body = await page.evaluate(() => document.body.innerText);
  return body.includes(NATURE.code) || body.includes(NATURE.name);
}

async function existingLineCodes(page) {
  const body = await page.evaluate(() => document.body.innerText);
  return LINES.filter((l) => body.includes(l.code)).map((l) => l.code);
}

async function closeTopDialog(page) {
  const dialog = page.locator(MODAL_SCOPE).last();
  if (!(await dialog.count())) return;
  const closeBtn = dialog.locator('button').filter({ hasText: /^×$|^x$/i }).first();
  if (await closeBtn.count()) await closeBtn.click().catch(() => {});
  else await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);
}

async function activateLines(page) {
  const lineSearch = page.getByPlaceholder(/Search/i).last();
  for (const line of LINES) {
    if (await lineSearch.count()) {
      await lineSearch.fill(line.code);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(600);
    }
    const view = page.getByRole('button', { name: /View Details/i }).first();
    if (!(await view.count())) {
      console.log(`[elgu] ${line.code}: no View Details`);
      continue;
    }
    await view.click();
    await page.waitForTimeout(700);
    const dialog = page.locator(MODAL_SCOPE).last();
    const text = ((await dialog.innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
    if (/Is Active\?\s*:\s*Yes/i.test(text)) {
      console.log(`[elgu] ${line.code} already active`);
      await closeTopDialog(page);
      continue;
    }
    const activate = dialog.getByRole('button', { name: /^Activate$/i });
    if (!(await activate.count())) {
      console.log(`[elgu] ${line.code}: no Activate button | ${text.slice(0, 180)}`);
      await closeTopDialog(page);
      continue;
    }
    await activate.click();
    await page.waitForTimeout(500);
    const confirm = page.getByRole('button', { name: /^Confirm$/i });
    if (await confirm.count()) await confirm.click();
    await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
    await page.waitForTimeout(800);
    const after = ((await page.locator(MODAL_SCOPE).last().innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
    const ok = /Is Active\?\s*:\s*Yes/i.test(after) || /success/i.test(after);
    console.log(`[elgu] activate ${line.code} ${ok ? 'Yes' : after.slice(0, 160)}`);
    await closeTopDialog(page);
    await closeTopDialog(page);
  }
  if (await lineSearch.count()) {
    await lineSearch.fill('');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
  }
}

async function openNature(page) {
  const search = page.getByPlaceholder(/Search/i).first();
  if (await search.count()) {
    await search.fill('CONSTRUCTION');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
  }
  const card = page.getByText(NATURE.name, { exact: false }).first();
  if (await card.count()) await card.click();
  else await page.getByText(NATURE.code, { exact: false }).first().click();
  await page.waitForTimeout(1000);
}

async function main() {
  const { context, page, api } = await launch({
    headless: false,
    slowMo: 80,
    pattern: /business.?natur|business.?line|tax_revenues|import|bpls/i,
  });

  page.on('request', (req) => {
    if (!['POST', 'PUT', 'PATCH'].includes(req.method())) return;
    const data = req.postData() || '';
    console.log(`[req] ${req.method()} ${req.url()} ${data.slice(0, 400)}`);
  });
  page.on('response', async (res) => {
    const method = res.request().method();
    if (!['POST', 'PUT', 'PATCH'].includes(method)) return;
    const text = await res.text().catch(() => '');
    console.log(`[api] ${method} ${res.status()} ${res.url()} ${text.slice(0, 500)}`);
  });

  console.log('[elgu] Migrating (F) CONSTRUCTION — watch the Chromium window.');
  await page.goto(`${BASE_URL}/bpls/new-business/new-business-natures`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1200);

  if (!(await natureExists(page))) {
    await clickAction(page, /Add Business Nature/);
    await page.waitForTimeout(800);
    const fields = await modalFields(page);
    console.log('[elgu] Add Nature fields', JSON.stringify(fields));
    await fillCodeName(page, NATURE.code, NATURE.name);
    await page.keyboard.press('Tab');
    const posts = api.filter((a) => /business/i.test(a.url));
    const toast = await submitModal(page);
    const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 2500));
    console.log('[elgu] after nature submit toast=', toast);
    console.log('[elgu] recent api', api.slice(-6).map((a) => a.url));
    console.log('[elgu] body', body.slice(0, 1200));
    if (!toast && !(await natureExists(page))) {
      throw new Error('nature create produced no success toast and nature is still missing');
    }
    console.log('[elgu] created nature', NATURE.code, toast || '(listed without toast)');
    await page.waitForTimeout(800);
  } else {
    console.log('[elgu] nature already listed', NATURE.code);
  }

  await openNature(page);
  await page.goto(`${BASE_URL}/bpls/new-business/new-business-natures/16`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await page.getByRole('button', { name: /Add Business Line/i }).waitFor({ timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(800);
  let have = new Set(await existingLineCodes(page));
  console.log('[elgu] existing line codes', [...have].join(', ') || '(none on page)');
  const feeMap = {};

  for (const line of LINES) {
    if (have.has(line.code)) {
      console.log(`[elgu] skip existing line ${line.code}`);
      continue;
    }
    await clickAction(page, /Add Business Line/);
    await page.waitForTimeout(700);
    await fillCodeName(page, line.code, line.name);
    if (!feeMap._done) {
      const inputs = page.locator(`${MODAL_SCOPE} input[id^="react-select"]`);
      if (await inputs.count()) {
        await inputs.nth(0).click({ force: true });
        await page.waitForTimeout(400);
        const opts = (await optionTexts(page)).map((t) => t.replace(/\s+/g, ' ').trim());
        console.log('[elgu] license options sample', opts.slice(0, 25));
        feeMap.license = opts.find((t) => FEE_PREFS.license.some((p) => t === p || t.includes(p))) || null;
        await page.locator(`${MODAL_SCOPE}`).getByText(/Name/i).first().click().catch(() => {});
      }
      feeMap._done = true;
      if (feeMap.license) await pickFee(page, 'license', [feeMap.license]);
    } else if (feeMap.license) {
      await pickFee(page, 'license', [feeMap.license]);
    }
    await page.getByRole('button', { name: /^Submit$/i }).click({ timeout: 10_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(900);
    const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
    const toast = body.match(/success[^.]{0,80}/i)?.[0] || null;
    const listed = body.includes(line.code);
    const taken = /already been taken/i.test(body);
    if (taken) {
      console.log(`[elgu] skip existing line ${line.code} (code taken)`);
      await closeTopDialog(page);
      have.add(line.code);
      continue;
    }
    if (!toast && !listed) throw new Error(`line ${line.code} submit failed: ${body.slice(0, 400)}`);
    console.log(`[elgu] created line ${line.code} ${line.name} | ${toast || 'listed'}`);
    have.add(line.code);
    await page.waitForTimeout(500);
  }

  await activateLines(page);

  const created = LINES.filter((l) => have.has(l.code)).map((l) => l.code);
  const apiUrls = [...new Set(api.map((a) => a.url.split('?')[0]))].slice(-20);
  console.log('[elgu] DONE lines', created.join(', '));
  console.log('[elgu] fee tags', JSON.stringify(feeMap));
  console.log('[elgu] api', apiUrls);
  console.log('[elgu] Browser stays open 20s so you can inspect, then remains until you close it.');
  await page.waitForTimeout(20_000);
  // Keep window open like spawn — wait until disconnected.
  while (context.browser()?.isConnected()) {
    await page.waitForTimeout(2000);
  }
  await context.close().catch(() => {});
}

main().catch(async (err) => {
  console.error('[elgu] Fatal:', err);
  await new Promise((r) => setTimeout(r, 60_000));
  process.exit(1);
});
