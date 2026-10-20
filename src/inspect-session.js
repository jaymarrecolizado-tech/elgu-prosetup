/**
 * Connect to the already-open Chromium (CDP) and dump page recon info.
 * Run after the user says they are logged in.
 *
 * Usage:  node src/inspect-session.js
 */

const { chromium } = require('playwright');

const CDP_PORT = Number(process.env.ELGU_CDP_PORT || 9333);

async function main() {
  const endpoint = `http://127.0.0.1:${CDP_PORT}`;
  console.log(`[elgu] Connecting to ${endpoint} ...`);

  const browser = await chromium.connectOverCDP(endpoint);
  const contexts = browser.contexts();
  const pages = contexts.flatMap((c) => c.pages());

  if (!pages.length) {
    throw new Error('No open pages found on CDP browser.');
  }

  // Prefer the frontmost non-blank page
  const page =
    pages.find((p) => {
      const u = p.url();
      return u && u !== 'about:blank' && !u.startsWith('chrome://');
    }) || pages[pages.length - 1];

  const url = page.url();
  const title = await page.title();

  const snapshot = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href]'))
      .slice(0, 80)
      .map((a) => ({
        text: (a.innerText || a.textContent || '').trim().slice(0, 80),
        href: a.getAttribute('href'),
      }))
      .filter((x) => x.text || x.href);

    const buttons = Array.from(
      document.querySelectorAll('button, [role="button"], input[type="submit"]')
    )
      .slice(0, 40)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.value || el.getAttribute('aria-label') || '')
          .trim()
          .slice(0, 80),
        id: el.id || null,
        name: el.getAttribute('name'),
      }));

    const navHints = links.filter((l) =>
      /fee|revenue|config|setting|treasury|assessment|tax|module|admin/i.test(
        `${l.text} ${l.href}`
      )
    );

    return {
      readyState: document.readyState,
      bodyTextSample: (document.body?.innerText || '').slice(0, 1200),
      linkCount: document.querySelectorAll('a[href]').length,
      links,
      buttons,
      navHints,
    };
  });

  console.log(
    JSON.stringify(
      {
        url,
        title,
        pageCount: pages.length,
        allUrls: pages.map((p) => p.url()),
        snapshot,
      },
      null,
      2
    )
  );

  // Do NOT call browser.close() — that would kill the manual-login window.
  // Ending this script disconnects the CDP client only.
}

main().catch((err) => {
  console.error('[elgu] Inspect failed:', err.message || err);
  process.exit(1);
});
