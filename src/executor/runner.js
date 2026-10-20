/**
 * Deterministic runner (PLAN §6 Plan#2): execute §5 configs against eLGU.
 * - Idempotent: whatever already exists (fee / calculation / details) is skipped.
 * - `dryRun`: every modal is filled then CANCELLED — zero submits, ever.
 * - `submit`: only reachable after explicit human confirmation (CLI prompt or
 *   typed confirmation in the web UI); never automatic.
 * - One structured log per run under logs/ (gitignored).
 */
const fs = require('fs');
const path = require('path');
const { launch, gotoSection, dismissModal, BASE_URL } = require('./browser');
const { executeTaxRevenue } = require('./taxRevenue');
const { executeSimpleFee } = require('./simpleFees');

const ROOT = path.join(__dirname, '..', '..');

/**
 * Best-effort selection of the ordinance revision filter. The tax-revenue list
 * requests carry ordinance_revision_id=<id>; we set the visible selector and
 * then verify the next list fetch actually used the wanted id. Selection is
 * *reported*, never silently assumed (PLAN §3 "never assume").
 */
async function selectRevision(page, api, revisionId) {
  const wanted = String(revisionId);
  const picked = await page.evaluate((rid) => {
    for (const sel of document.querySelectorAll('select')) {
      const opt = [...sel.options].find((o) => o.value === rid);
      if (!opt) continue;
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return { label: sel.previousElementSibling?.innerText || sel.name || 'select', option: opt.text.trim() };
    }
    return null;
  }, wanted);
  if (!picked) return { ok: false, message: `no <select> offers revision id ${wanted} — pick it manually in the UI before running` };
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(800);
  const listFetch = [...api].reverse().find((a) => /tax_revenues\?/.test(a.url) || /ordinance_revision_id=/.test(a.url));
  const ok = listFetch ? listFetch.url.includes(`ordinance_revision_id=${wanted}`) : false;
  return {
    ok,
    message: ok
      ? `revision ${wanted} active (selector "${picked.label}" → "${picked.option}", list requests filtered)`
      : `selector set to "${picked.option}" but could not confirm ordinance_revision_id=${wanted} in list requests — verify manually`,
  };
}

/**
 * Run configs. Options:
 *   mode: 'dry-run' | 'submit'
 *   revision: ordinance revision id (required for submit runs)
 *   onEvent: progress callback ({type:'start'|'skip'|'done'|'error'|'info', ...})
 */
async function runConfigs({ configs, mode = 'dry-run', revision = null, onEvent = () => {}, headless = false, confirmSubmit = false }) {
  if (mode === 'submit' && !confirmSubmit) throw new Error('submit mode requires explicit human confirmation');
  if (mode === 'submit' && !revision) throw new Error('submit mode requires an explicit ordinance revision id (PLAN §3: never assume)');

  const runLog = {
    started_at: new Date().toISOString(),
    mode,
    revision: revision ? String(revision) : null,
    base_url: BASE_URL,
    results: [],
  };

  const { context, page, api } = await launch({ headless });
  try {
    onEvent({ type: 'info', message: `browser up (${mode})` });
    if (revision) {
      await gotoSection(page, 'license');
      const sel = await selectRevision(page, api, revision);
      runLog.revision_selection = sel;
      onEvent({ type: 'info', message: `revision: ${sel.message}` });
      if (mode === 'submit' && !sel.ok) {
        throw new Error(`refusing to submit: ordinance revision ${revision} could not be confirmed active — ${sel.message}`);
      }
    }

    for (const config of configs) {
      const entry = { code: config.code, kind: config.kind, page: config.target_page, confidence: config.confidence, started: new Date().toISOString() };
      onEvent({ type: 'start', code: config.code });
      try {
        if (config.confidence === 'needs_human') {
          entry.status = 'refused';
          entry.reason = 'needs_human — parser flagged this fee; encode it manually';
        } else if (config.kind === 'tax_revenue' && !config.calculation) {
          entry.status = 'refused';
          entry.reason = 'no calculation to encode';
        } else {
          const steps = config.kind === 'tax_revenue'
            ? await executeTaxRevenue(page, config, { dryRun: mode === 'dry-run' })
            : await executeSimpleFee(page, config, { dryRun: mode === 'dry-run' });
          entry.steps = steps;
          const statuses = Object.values(steps).map((s) => s?.status).filter(Boolean);
          entry.status = statuses.includes('dry_run') ? 'dry_run'
            : statuses.every((s) => s === 'exists') ? 'exists'
            : 'created';
        }
      } catch (err) {
        entry.status = 'error';
        entry.error = String(err.message || err).split('\n')[0];
        await dismissModal(page);
        await page.waitForTimeout(500);
      }
      entry.finished = new Date().toISOString();
      runLog.results.push(entry);
      onEvent({ type: entry.status === 'error' ? 'error' : 'done', code: config.code, status: entry.status, error: entry.error, reason: entry.reason });
    }
  } finally {
    await context.close().catch(() => {});
  }

  runLog.finished_at = new Date().toISOString();
  runLog.summary = {
    total: runLog.results.length,
    created: runLog.results.filter((r) => r.status === 'created').length,
    exists: runLog.results.filter((r) => r.status === 'exists').length,
    dry_run: runLog.results.filter((r) => r.status === 'dry_run').length,
    refused: runLog.results.filter((r) => r.status === 'refused').length,
    error: runLog.results.filter((r) => r.status === 'error').length,
  };
  fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.join(ROOT, 'logs', `run-${stamp}-${mode}.json`);
  fs.writeFileSync(out, JSON.stringify(runLog, null, 2), 'utf8');
  runLog.log_file = out;
  onEvent({ type: 'info', message: `log written: ${out}` });
  return runLog;
}

/** CLI confirmation for --submit: require typing SUBMIT (PLAN §6 Plan#2). */
function cliConfirm() {
  return new Promise((resolve) => {
    process.stdout.write('\n*** SUBMIT mode will create/modify real records in eLGU ***\nType SUBMIT to continue (anything else cancels): ');
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (chunk) => {
      buf = chunk.trim();
      process.stdin.pause();
      resolve(buf === 'SUBMIT');
    });
  });
}

module.exports = { runConfigs, cliConfirm, selectRevision };
