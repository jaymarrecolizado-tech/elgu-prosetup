/**
 * List all CDP targets and inspect the eLGU page even when Playwright
 * contexts().pages() is empty (common with Playwright-launched Chromium).
 */
const { chromium } = require('playwright');

const CDP_PORT = Number(process.env.ELGU_CDP_PORT || 9333);
const OUT = require('path').join(__dirname, '..', 'session-inspect.json');
const fs = require('fs');

async function main() {
  const endpoint = `http://127.0.0.1:${CDP_PORT}`;
  console.log('[elgu] CDP connect', endpoint);

  const browser = await chromium.connectOverCDP(endpoint);
  const session = await browser.newBrowserCDPSession();
  const { targetInfos } = await session.send('Target.getTargets');

  console.log(
    '[elgu] targets:',
    targetInfos.map((t) => ({ type: t.type, title: t.title, url: t.url }))
  );

  const pageTarget = targetInfos.find(
    (t) =>
      t.type === 'page' &&
      t.url &&
      t.url !== 'about:blank' &&
      !t.url.startsWith('chrome://') &&
      !t.url.startsWith('devtools://')
  );

  if (!pageTarget) {
    throw new Error('No non-blank page target found. Is eLGU still open in the spawned browser?');
  }

  const { sessionId } = await session.send('Target.attachToTarget', {
    targetId: pageTarget.targetId,
    flatten: true,
  });

  // Use flat session API via Playwright CDP
  const pageSession = session; // flatten:true routes to same session in modern CDP
  await pageSession.send('Runtime.enable').catch(() => {});

  const evalResult = await pageSession.send('Runtime.evaluate', {
    expression: `(() => {
      const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 100).map(a => ({
        text: (a.innerText || a.textContent || '').trim().slice(0, 100),
        href: a.getAttribute('href')
      })).filter(x => x.text || x.href);
      const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]')).slice(0, 50).map(el => ({
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 100),
        id: el.id || null,
        name: el.getAttribute('name')
      }));
      const navHints = links.filter(l => /fee|revenue|config|setting|treasury|assessment|tax|module|admin|local|permit|business/i.test(l.text + ' ' + l.href));
      return {
        url: location.href,
        title: document.title,
        bodyTextSample: (document.body && document.body.innerText || '').slice(0, 2500),
        linkCount: document.querySelectorAll('a[href]').length,
        links,
        buttons,
        navHints
      };
    })()`,
    returnByValue: true,
    awaitPromise: true,
  });

  const value = evalResult.result?.value;
  if (!value) {
    console.error('[elgu] evaluate failed', JSON.stringify(evalResult, null, 2));
    throw new Error('Runtime.evaluate returned no value');
  }

  const payload = {
    inspectedAt: new Date().toISOString(),
    target: { title: pageTarget.title, url: pageTarget.url, targetId: pageTarget.targetId },
    sessionId,
    snapshot: value,
  };

  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), 'utf8');
  console.log('[elgu] Wrote', OUT);
  console.log(JSON.stringify({ url: value.url, title: value.title, navHints: value.navHints }, null, 2));
}

main().catch((err) => {
  console.error('[elgu]', err.message || err);
  process.exit(1);
});
