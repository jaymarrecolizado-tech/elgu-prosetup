/**
 * Browser session helpers — the only place that owns Playwright context setup.
 * Pattern kept from the proven sample scripts: persistent Chromium profile at
 * .auth/chrome-profile (PLAN §7.9) + JSON:API response capture for auditing.
 */
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const PROFILE = path.join(ROOT, '.auth', 'chrome-profile');

/** eLGU app origin (training default); override with ELGU_BASE_URL in .env. */
const BASE_URL = process.env.ELGU_BASE_URL || 'https://elgu-r2-training-core.oueg.info';

/**
 * Launch the persistent-context browser and attach an API-capture listener.
 * Returns { context, page, api } where api is the growing array of
 * { url, body } JSON responses matching `pattern` (used by audit + idempotency).
 */
async function launch({ headless = false, pattern = /tax_revenue|fixed_fees|other_fees/, slowMo = 0 } = {}) {
  const context = await chromium.launchPersistentContext(PROFILE, {
    headless,
    slowMo,
    viewport: { width: 1400, height: 900 },
  });
  const page = context.pages()[0] || (await context.newPage());
  const api = [];
  page.on('response', async (res) => {
    try {
      if (!(res.headers()['content-type'] || '').includes('json')) return;
      if (!pattern.test(res.url())) return;
      const body = await res.json().catch(() => null);
      if (body) api.push({ url: res.url(), body });
    } catch { /* response body no longer available — ignore */ }
  });
  return { context, page, api };
}

/**
 * Navigate to a tax-revenue section and settle (PLAN §7.8: networkidle + delay).
 * `fresh` reloads once after navigation — required before the Fixed/Other Fee
 * pages' react-selects: a prior visit to a tax-revenue page leaves the SPA's
 * dropdown state stale and the Add-modal react-select menus never open.
 */
async function gotoSection(page, slug, { fresh = false } = {}) {
  await page.goto(`${BASE_URL}/bpls/tax-revenue/${slug}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  if (fresh) {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  }
  await page.waitForTimeout(800);
}

/** Expand (open) one fee item by its code so its calculation panel loads. */
async function expandFee(page, code) {
  await page.evaluate((c) => {
    const els = [...document.querySelectorAll('div,span,a,h5,h6,li')];
    const el =
      els.find((e) => e.innerText?.trim().endsWith(c) && e.innerText.trim().length < c.length + 12) ||
      els.find((e) => e.innerText?.includes(c));
    el?.click();
  }, code);
  await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
  await page.waitForTimeout(700);
}

/** True when the fee code is already listed on the current section page. */
async function feeExists(page, code) {
  return (await page.getByText(code, { exact: false }).count()) > 0;
}

/** Dismiss any lingering modal (PLAN §7.6) without submitting anything. */
async function dismissModal(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
}

module.exports = { launch, gotoSection, expandFee, feeExists, dismissModal, BASE_URL, PROFILE };
