/**
 * ELGU Local Revenue Fee Configuration — Playwright runner
 *
 * Steps implemented now:
 *   1. Launch visible Chromium (non-headless)
 *   2. Open login page → page.pause() for manual login / CAPTCHA
 *
 * Later (Steps 3–4):
 *   - Navigate to Fee Configuration with resilient locators
 *   - Loop revenue_fees.json and fill/submit via portable DOM helpers
 *
 * Chrome Extension note:
 *   Form injection lives in src/form/domInject.js (vanilla DOM).
 *   Playwright will call those helpers via page.evaluate when we add Step 4.
 */

const { chromium } = require('playwright');
const { LOGIN_URL, SLOW_MO_MS } = require('./config');

async function main() {
  console.log('[elgu] Starting Chromium (headed)...');
  console.log(`[elgu] Login URL: ${LOGIN_URL}`);

  // Step 1 — visible browser on your desktop
  const browser = await chromium.launch({
    headless: false,
    slowMo: SLOW_MO_MS,
    // Keep DevTools closed by default; Inspector opens on pause()
  });

  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    // Persist nothing yet — after login flow is stable we can add storageState
  });

  const page = await context.newPage();

  // Step 2 — open login, then freeze for manual auth
  console.log('[elgu] Navigating to login page...');
  await page.goto(LOGIN_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });

  console.log(`
============================================================
  MANUAL LOGIN PAUSE
============================================================
  1. In the opened browser, enter your credentials.
  2. Solve CAPTCHA / MFA if prompted.
  3. Wait until you land on the ELGU dashboard.
  4. In the Playwright Inspector, click Resume (▶).

  Tip: If Inspector did not open, re-run with:
       npm run fees:configure:debug
============================================================
`);

  // Freezes the script until you click Resume in Playwright Inspector
  await page.pause();

  console.log('[elgu] Resume detected. Session is ready.');
  console.log('[elgu] Steps 3–4 (Fee Configuration + data loop) not wired yet.');
  console.log('[elgu] Leaving the browser open for 10s so you can confirm the dashboard...');

  await page.waitForTimeout(10_000);

  await browser.close();
  console.log('[elgu] Browser closed. Steps 1–2 OK.');
}

main().catch((err) => {
  console.error('[elgu] Fatal:', err);
  process.exit(1);
});
