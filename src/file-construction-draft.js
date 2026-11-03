/**
 * File the SAMPLE CON 41001 BUILDERS citizen draft (training only).
 */
require('dotenv').config();
const { launch } = require('./executor/browser');

const CITIZEN = 'https://elgu-r2-training.oueg.info';
const SAMPLE = 'SAMPLE CON 41001 BUILDERS';

async function settle(page, ms = 800) {
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

async function body(page) {
  return page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' '));
}

async function clickNamed(page, re) {
  const btn = page.getByRole('button', { name: re }).first();
  if (!(await btn.count())) return false;
  await btn.click({ force: true });
  await settle(page, 1200);
  return true;
}

async function main() {
  const { context, page } = await launch({
    headless: false,
    slowMo: 40,
    pattern: /transaction|application|draft|permit/i,
  });
  page.on('response', async (res) => {
    const m = res.request().method();
    if (!['POST', 'PUT', 'PATCH'].includes(m)) return;
    if (!/transaction|application|draft|permit/i.test(res.url())) return;
    const text = await res.text().catch(() => '');
    console.log(`[api] ${m} ${res.status()} ${res.url()} ${text.slice(0, 280)}`);
  });

  console.log('[elgu] File Construction draft — watch Chromium.');
  await page.goto(`${CITIZEN}/elgu-transaction`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await settle(page, 1200);
  if (/log\s*in/i.test(await body(page)) && !/Welcome/i.test(await body(page))) {
    throw new Error('citizen login required as JUANITO PARITO');
  }

  const tok = await page.evaluate(() => String(localStorage.getItem('token') || '').replace(/^"|"$/g, ''));
  const auth = tok ? (tok.startsWith('Bearer') ? tok : `Bearer ${tok}`) : '';
  const apiGets = [
    'https://elgu-r2-training-ws.oueg.info/api/v1/taxpayers/transaction_drafts',
    'https://elgu-r2-training-ws.oueg.info/api/v1/taxpayers/transaction_histories?per_page=20&page=1&sort_by=desc',
    'https://elgu-r2-training-ws.oueg.info/api/v1/bpls/taxpayer/business/permit/application_new_v2/initial_soa_computation',
  ];
  for (const url of apiGets) {
    const res = await page.request.fetch(url, {
      headers: { Accept: 'application/json', Authorization: auth },
      failOnStatusCode: false,
    });
    console.log('[elgu] GET', res.status(), url, (await res.text()).slice(0, 500));
  }

  await page.getByRole('button', { name: /^Drafts$/i }).click({ force: true });
  const dialog = page.locator('.modal.show, [role=dialog]').filter({ hasText: /Date Saved|Continue/i }).first();
  await dialog.waitFor({ timeout: 15_000 });
  const novRow = dialog.locator('tr').filter({ hasText: /November 02, 2026/i }).first();
  await novRow.waitFor({ timeout: 10_000 });
  console.log('[elgu] draft row', (await novRow.innerText()).replace(/\s+/g, ' '));
  const modalBtns = await page.evaluate(() => [...document.querySelectorAll('.modal.show button, .modal.show a')].map((el) => ({
    tag: el.tagName, text: el.innerText.trim(), href: el.getAttribute('href'), cls: String(el.className).slice(0, 80),
  })));
  console.log('[elgu] modal actions', modalBtns);
  const draft = await page.request.fetch('https://elgu-r2-training-ws.oueg.info/api/v1/taxpayers/transaction_drafts/a3205ea9-6728-4bd1-adba-ccf2fd2242b1', {
    headers: { Accept: 'application/json', Authorization: auth },
    failOnStatusCode: false,
  });
  console.log('[elgu] draft detail', (await draft.text()).slice(0, 1500));

  const btn = page.locator('.modal.show tr').filter({ hasText: /November 02, 2026/i }).locator('button.text-success');
  const box = await btn.boundingBox();
  console.log('[elgu] continue box', box);
  if (!box) throw new Error('Continue has no box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await settle(page, 2500);
  const active = context.pages().at(-1) || page;
  console.log('[elgu] pages', context.pages().map((p) => p.url()));
  console.log('[elgu] continued draft', active.url(), (await body(active)).slice(0, 500));

  if (!/Application Summary|Business Information|SAMPLE CON/i.test(await body(active))) {
    throw new Error(`Continue did not open the draft wizard at ${active.url()} | ${(await body(active)).slice(0, 400)}`);
  }
  for (let i = 0; i < 6 && !/Application Summary/i.test(await body(active)); i += 1) {
    const next = active.getByRole('button', { name: /^Next$/i }).first();
    if (await next.count() && !(await next.isDisabled())) {
      await next.click();
      await settle(active, 1000);
    } else break;
  }
  console.log('[elgu] pre-submit', active.url(), (await body(active)).slice(0, 400));
  const submit = active.getByRole('button', { name: /^Submit$/i }).first();
  if (!(await submit.count())) throw new Error('no Submit button');
  await submit.click();
  await settle(active, 2500);
  console.log('[elgu] after submit', active.url());
  console.log('[elgu] body', (await body(active)).slice(0, 1200));
  console.log('[elgu] Browser stays open.');
  while (context.browser()?.isConnected()) await page.waitForTimeout(2000);
  await context.close().catch(() => {});
}

main().catch((err) => {
  console.error('[elgu] Fatal:', err);
  process.exit(1);
});
