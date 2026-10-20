/**
 * Spawns visible Chromium for manual ELGU login.
 * Continuously writes browser-status.json so the agent can inspect without CDP.
 *
 * Stop: create .stop-browser  OR close the window / Ctrl+C
 * Inspect now: create .login-ready  (writes session-inspect.json)
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const STOP_FILE = path.join(ROOT, '.stop-browser');
const READY_FILE = path.join(ROOT, '.login-ready');
const STATUS_FILE = path.join(ROOT, 'browser-status.json');
const INSPECT_FILE = path.join(ROOT, 'session-inspect.json');
const USER_DATA = path.join(ROOT, '.auth', 'chrome-profile');
const START_URL = process.env.ELGU_LOGIN_URL || 'about:blank';

async function collectSnapshot(page) {
  const url = page.url();
  const title = await page.title();
  const snapshot = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href]'))
      .slice(0, 120)
      .map((a) => ({
        text: (a.innerText || a.textContent || '').trim().slice(0, 100),
        href: a.getAttribute('href'),
      }))
      .filter((x) => x.text || x.href);

    const buttons = Array.from(
      document.querySelectorAll('button, [role="button"], input[type="submit"]')
    )
      .slice(0, 50)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.value || el.getAttribute('aria-label') || '')
          .trim()
          .slice(0, 100),
        id: el.id || null,
        name: el.getAttribute('name'),
      }));

    const navHints = links.filter((l) =>
      /fee|revenue|config|setting|treasury|assessment|tax|module|admin|local|permit|business|dashboard/i.test(
        `${l.text} ${l.href}`
      )
    );

    return {
      readyState: document.readyState,
      bodyTextSample: (document.body?.innerText || '').slice(0, 2500),
      linkCount: document.querySelectorAll('a[href]').length,
      links,
      buttons,
      navHints,
    };
  });

  return { url, title, snapshot };
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

async function main() {
  fs.mkdirSync(USER_DATA, { recursive: true });
  for (const f of [STOP_FILE, READY_FILE]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  console.log('[elgu] Launching visible Chromium (persistent profile)...');
  console.log(`[elgu] Profile: ${USER_DATA}`);

  // Persistent context keeps cookies if you need to re-open later
  const context = await chromium.launchPersistentContext(USER_DATA, {
    headless: false,
    viewport: { width: 1400, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const page = context.pages()[0] || (await context.newPage());
  if (page.url() === 'about:blank' || page.url() === '') {
    await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  }

  console.log(`
============================================================
  MANUAL LOGIN BROWSER IS OPEN
============================================================
  1. Type/paste your ELGU login URL in the address bar (if blank).
  2. Log in (CAPTCHA / MFA OK).
  3. When you reach the dashboard, reply in chat: I'm logged in

  Leave this window open.
============================================================
`);

  let lastUrl = '';
  let inspected = false;

  while (context.browser()?.isConnected()) {
    if (fs.existsSync(STOP_FILE)) {
      console.log('[elgu] Stop file detected — closing.');
      break;
    }

    try {
      const status = {
        updatedAt: new Date().toISOString(),
        url: page.url(),
        title: await page.title(),
      };
      writeJson(STATUS_FILE, status);

      if (status.url !== lastUrl) {
        lastUrl = status.url;
        console.log(`[elgu] navigated → ${status.title} | ${status.url}`);
      }

      if (fs.existsSync(READY_FILE) && !inspected) {
        console.log('[elgu] .login-ready — dumping full inspection...');
        const full = await collectSnapshot(page);
        writeJson(INSPECT_FILE, { inspectedAt: new Date().toISOString(), ...full });
        console.log(`[elgu] Wrote ${INSPECT_FILE}`);
        inspected = true;
      }
    } catch (err) {
      console.error('[elgu] status loop:', err.message || err);
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  await context.close().catch(() => {});
  console.log('[elgu] Browser closed.');
}

main().catch((err) => {
  console.error('[elgu] Fatal:', err);
  process.exit(1);
});
