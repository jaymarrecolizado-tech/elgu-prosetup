/**
 * Visible sample New Business application on training citizen portal,
 * Line of Business = Construction 41001 (Residential dwelling).
 * Open via Services → BPLS Create Transaction (deep link bounces Home).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { launch } = require('./executor/browser');

const CITIZEN = 'https://elgu-r2-training.oueg.info';
const ID_PNG = path.join(__dirname, '..', '.auth', 'sample-valid-id.png');

const SAMPLE = {
  name: 'SAMPLE CON 41001 BUILDERS',
  dti: 'CON41001',
  dtiExpiry: '12/31/2030',
  tin: '999-999-999-99999',
  email: 'construction.sample@example.com',
  mobile: '9170000001',
  barangay: 'ALICAOCAO',
  floor: '12',
  area: '10',
  capital: '150000',
  units: '1',
  products: 'Residential building construction',
  lobHint: '41001',
};

async function settle(page, ms = 600) {
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

async function body(page) {
  return page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' '));
}

async function fillName(page, name, value) {
  const input = page.locator(`[name="${name}"]`).first();
  if (!(await input.count())) return false;
  await input.click();
  await input.fill('');
  await input.pressSequentially(String(value), { delay: 10 });
  return true;
}

async function pickByLabel(page, labelRe, value) {
  const label = page.locator('label').filter({ hasText: labelRe }).first();
  const control = label.locator('xpath=following::div[contains(@class,"-control")][1]');
  await control.click({ timeout: 8_000 });
  await page.waitForTimeout(200);
  await page.keyboard.type(String(value), { delay: 18 });
  await page.waitForTimeout(350);
  const opt = page.locator('[class*="-option"]:visible').filter({ hasText: new RegExp(String(value), 'i') }).first();
  if (await opt.count()) await opt.click();
  else await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
}

async function clickNext(page) {
  const next = page.getByRole('button', { name: /^Next$/i }).first();
  if (!(await next.count())) {
    throw new Error(`no Next button at ${page.url()} | ${(await body(page)).slice(0, 240)}`);
  }
  await next.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find((el) => /^Next$/i.test(el.innerText.trim()));
    return b && !b.disabled;
  }, null, { timeout: 15_000 });
  await next.click();
  await settle(page, 900);
}

async function ensureIdPng(page) {
  fs.mkdirSync(path.dirname(ID_PNG), { recursive: true });
  const extra = await page.context().newPage();
  await extra.setContent(
    `<div id="id" style="width:420px;height:260px;background:#f4f4f4;border:8px solid #222;font-family:sans-serif;padding:24px">
      <div style="font-size:22px;font-weight:700">SAMPLE VALID ID</div>
      <div style="margin-top:16px;font-size:18px">JUAN PARITO</div>
      <div style="margin-top:8px">Training only — Construction LOB 41001</div>
    </div>`,
  );
  await extra.locator('#id').screenshot({ path: ID_PNG });
  await extra.close();
}

async function onWizard(page) {
  return /create-transaction\/e2e-business-permit-new/i.test(page.url())
    && /Business Information/i.test(await body(page));
}

async function openWizard(page) {
  if (await onWizard(page)) return;

  const svc = page.locator('a[href="/elgu-service"]').first();
  if (await svc.count()) {
    await svc.click();
    await page.waitForURL(/elgu-service/, { timeout: 20_000 }).catch(() => {});
  } else {
    await page.goto(`${CITIZEN}/elgu-service`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  }
  await settle(page, 1200);

  const bpls = page.locator('a[href="/transactions/"]').first();
  if (!(await bpls.count())) throw new Error('BPLS card overlay /transactions/ not found');
  await bpls.click();
  await settle(page, 600);

  const dialog = page.locator('.modal.show').filter({ hasText: /Create Transaction/i }).first();
  await dialog.waitFor({ timeout: 15_000 });
  await dialog.locator('input[value="new"]').check({ force: true }).catch(async () => {
    await dialog.getByText(/^New$/i).first().click();
  });
  await dialog.getByRole('button', { name: /^Proceed$/i }).click();
  await page.waitForURL(/create-transaction/, { timeout: 25_000 });
  await settle(page, 1200);
  if (!(await onWizard(page))) {
    throw new Error(`wizard did not open Business Information at ${page.url()} | ${(await body(page)).slice(0, 400)}`);
  }
}

async function main() {
  const { context, page } = await launch({
    headless: false,
    slowMo: 35,
    pattern: /business|transaction|application|activity|attachment|bpls/i,
  });
  page.on('response', async (res) => {
    const m = res.request().method();
    if (!['POST', 'PUT', 'PATCH'].includes(m)) return;
    if (!/business|transaction|application|activity|attachment/i.test(res.url())) return;
    const text = await res.text().catch(() => '');
    console.log(`[api] ${m} ${res.status()} ${res.url()} ${text.slice(0, 280)}`);
  });

  console.log('[elgu] Playwright Construction sample — watch Chromium.');
  if (!/elgu-r2-training\.oueg\.info/i.test(page.url())) {
    await page.goto(CITIZEN, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await settle(page, 800);
  }

  const loggedOut = async () => {
    const t = await body(page);
    return /log\s*in/i.test(t) && !/Business Information|Welcome/i.test(t);
  };
  if (await loggedOut()) {
    console.log('[elgu] Log in as JUANITO PARITO in this Chromium window.');
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline && (await loggedOut())) await page.waitForTimeout(1500);
  }

  await openWizard(page);
  console.log('[elgu] wizard', page.url());

  await pickByLabel(page, /Business Type/i, 'Sole Proprietorship');
  const dtiNo = page.locator('[name="dti_no"]');
  await dtiNo.waitFor({ state: 'visible', timeout: 15_000 });
  await dtiNo.click();
  await dtiNo.fill('');
  await dtiNo.pressSequentially(SAMPLE.dti, { delay: 12 });
  const expiry = page.locator('input[placeholder*="MM/DD"]').first();
  if (await expiry.count()) {
    await expiry.click();
    await expiry.fill(SAMPLE.dtiExpiry).catch(async () => {
      await expiry.pressSequentially(SAMPLE.dtiExpiry, { delay: 15 });
    });
  }
  await fillName(page, 'business_name', SAMPLE.name);
  await fillName(page, 'incharge_first_name', 'JUAN');
  await fillName(page, 'incharge_last_name', 'PARITO');
  await pickByLabel(page, /^Sex/i, 'Male');
  await fillName(page, 'tin_no', SAMPLE.tin);
  await fillName(page, 'email_address', SAMPLE.email);
  const mobile = page.locator('input[type="tel"]').first();
  await mobile.click();
  await page.keyboard.press('End');
  await mobile.pressSequentially(SAMPLE.mobile, { delay: 12 });
  console.log('[elgu] step1 filled');
  await clickNext(page);

  await pickByLabel(page, /Barangay/i, SAMPLE.barangay);
  console.log('[elgu] step2', (await body(page)).slice(0, 220));
  await clickNext(page);

  await fillName(page, 'floor_area', SAMPLE.floor);
  await fillName(page, 'area', SAMPLE.area);
  await fillName(page, 'no_of_employees_residing_manila', '0');
  await fillName(page, 'no_of_male_employees', '1');
  await fillName(page, 'no_of_female_employees', '0');
  await fillName(page, 'no_of_van', '0');
  await fillName(page, 'no_of_truck', '0');
  await fillName(page, 'no_of_motorcycle', '0');
  await page.locator('[name="is_same_as_business_address"]').setChecked(true, { force: true }).catch(() => {});
  await page.locator('[name="is_owned"]').check({ force: true });
  const tdn = page.locator('[name="tdn_no"]');
  await tdn.waitFor({ state: 'visible', timeout: 10_000 });
  await tdn.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('R-12345678', { delay: 20 });
  await tdn.blur().catch(() => page.locator('body').click({ position: { x: 5, y: 5 } }));
  console.log('[elgu] step3', (await body(page)).slice(0, 220));
  const step3 = await page.evaluate(() => ({
    nextDisabled: [...document.querySelectorAll('button')].some((b) => /^Next$/i.test(b.innerText) && b.disabled),
    required: [...document.querySelectorAll('label')].filter((l) => /Required/i.test(l.innerText)).map((l) => l.innerText.replace(/\s+/g, ' ').trim()),
    values: [...document.querySelectorAll('input,select,textarea')].filter((e) => e.type !== 'hidden').map((e) => ({
      name: e.name, id: e.id, val: e.value, disabled: e.disabled, checked: e.checked, type: e.type,
    })),
  }));
  console.log('[elgu] step3 dump', JSON.stringify(step3));
  await clickNext(page);

  await page.getByText(/Line of Business/i).first().waitFor({ timeout: 20_000 });
  await page.getByText('Main Office', { exact: true }).click();
  const lob = page.locator('[class*="-control"]').filter({ hasText: /Type to Search|Line of Business|Select/i }).first();
  await lob.click();
  await page.keyboard.type(SAMPLE.lobHint, { delay: 40 });
  await page.locator('[class*="-option"]:visible').first().waitFor({ timeout: 20_000 });
  const opts = (await page.locator('[class*="-option"]:visible').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  console.log('[elgu] LOB options', opts.slice(0, 20));
  const hit = opts.find((t) => t.includes(SAMPLE.lobHint)) || opts.find((t) => /residential/i.test(t)) || opts[0];
  await page.locator('[class*="-option"]:visible').filter({ hasText: hit }).first().click();
  await settle(page, 1500);
  console.log('[elgu] after LOB', (await body(page)).slice(0, 700));
  console.log('[elgu] after LOB controls', await page.locator('[class*="-control"]').allInnerTexts());
  await fillName(page, 'sqm', SAMPLE.area);
  const products = page.getByLabel(/Products/i).first();
  if (await products.count()) await products.fill(SAMPLE.products);
  const units = page.getByLabel(/No\. of Units/i).first();
  if (await units.count()) await units.fill(SAMPLE.units);
  const capital = page.getByLabel(/Capitalization/i).first();
  if (await capital.count()) await capital.fill(SAMPLE.capital);
  const step4 = await page.evaluate(() => ({
    nextDisabled: [...document.querySelectorAll('button')].some((b) => /^Next$/i.test(b.innerText) && b.disabled),
    values: [...document.querySelectorAll('input,select,textarea')].filter((e) => e.type !== 'hidden').map((e) => ({
      name: e.name, val: e.value, type: e.type, checked: e.checked,
    })),
  }));
  console.log('[elgu] step4 dump', JSON.stringify(step4));
  const already = /Update Activity/i.test(await body(page));
  const addAct = page.getByRole('button', { name: /Add Activity/i }).first();
  if (!already && step4.nextDisabled && await addAct.count()) {
    await addAct.click({ force: true });
    await settle(page, 1000);
    console.log('[elgu] added activity', (await body(page)).slice(0, 400));
  } else {
    console.log('[elgu] skip add activity', { already, nextDisabled: step4.nextDisabled });
  }
  console.log('[elgu] step4', (await body(page)).slice(0, 300));
  await clickNext(page);

  await ensureIdPng(page);
  await page.getByText(/Primary ID|Valid ID|Clear Photo/i).first().click({ force: true }).catch(() => {});
  const file = page.locator('input[type="file"]');
  const nFiles = await file.count();
  console.log('[elgu] file inputs', nFiles);
  if (nFiles) {
    await file.first().setInputFiles(ID_PNG);
    await settle(page, 1500);
    console.log('[elgu] uploaded sample ID');
  } else {
    console.log('[elgu] no file input', (await body(page)).slice(0, 400));
  }

  const submit = page.getByRole('button', { name: /submit|file application|^continue$/i });
  const labels = await submit.allInnerTexts().catch(() => []);
  console.log('[elgu] submit buttons', labels);
  const go = submit.filter({ hasNotText: /draft/i }).first();
  if (await go.count()) {
    await go.click();
    await settle(page, 2000);
  }
  console.log('[elgu] after file', page.url());
  console.log('[elgu] body', (await body(page)).slice(0, 1200));
  if (/Application Summary/i.test(await body(page))) {
    const agree = page.getByRole('checkbox').first();
    if (await agree.count()) await agree.check({ force: true }).catch(() => agree.click({ force: true }));
    await page.getByText(/I agree|I certify|confirm that|terms/i).first().click({ force: true }).catch(() => {});
    const fileBtn = page.getByRole('button', { name: /^Submit$/i }).first();
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('button')].find((el) => /^Submit$/i.test(el.innerText.trim()));
      return b && !b.disabled;
    }, null, { timeout: 20_000 }).catch(() => {});
    console.log('[elgu] summary', (await body(page)).slice(0, 400));
    await fileBtn.click({ force: true });
    await settle(page, 2500);
    console.log('[elgu] submitted', page.url());
    console.log('[elgu] after submit', (await body(page)).slice(0, 800));
  }
  console.log('[elgu] Browser stays open so you can inspect.');
  while (context.browser()?.isConnected()) await page.waitForTimeout(2000);
  await context.close().catch(() => {});
}

main().catch((err) => {
  console.error('[elgu] Fatal:', err);
  process.exit(1);
});
