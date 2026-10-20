/**
 * Thin CLI for the deterministic runner (PLAN §6 Plan#2).
 *
 *   node src/run-configure-fees.js --dry-run [--confidence high] [--codes A,B]
 *   node src/run-configure-fees.js --submit --revision 2 --codes A,B   (types SUBMIT to confirm)
 */
const fs = require('fs');
const path = require('path');
const { parseAll } = require('./parser');
const { runConfigs, cliConfirm } = require('./executor/runner');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const val = (flag, def = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : def;
};

async function main() {
  const mode = has('--submit') ? 'submit' : 'dry-run';
  const revision = val('--revision');
  const codes = val('--codes') ? val('--codes').split(',').map((s) => s.trim()).filter(Boolean) : null;
  const confidence = val('--confidence', 'high'); // which confidences to include

  const inPath = path.join(ROOT, val('--in', 'elgu_config.json'));
  let configs;
  if (fs.existsSync(inPath)) {
    configs = JSON.parse(fs.readFileSync(inPath, 'utf8')).configs;
  } else {
    const fees = JSON.parse(fs.readFileSync(path.join(ROOT, 'revenue_fees.json'), 'utf8'));
    configs = parseAll(fees).configs;
    console.log('[runner] elgu_config.json not found — parsed revenue_fees.json directly');
  }

  let selected = configs;
  if (codes) selected = selected.filter((c) => codes.includes(c.code));
  else if (confidence) {
    const allow = confidence.split(',');
    selected = selected.filter((c) => allow.includes(c.confidence));
  }
  console.log(`[runner] ${selected.length} config(s) selected | mode=${mode} revision=${revision || '(none)'}`);

  let confirmed = false;
  if (mode === 'submit') {
    confirmed = await cliConfirm();
    if (!confirmed) {
      console.log('[runner] not confirmed — aborting (nothing was submitted)');
      process.exit(0);
    }
  }

  const log = await runConfigs({
    configs: selected,
    mode,
    revision,
    confirmSubmit: confirmed,
    onEvent: (e) => {
      if (e.type === 'start') console.log(`  → ${e.code}`);
      else if (e.type === 'done') console.log(`  ✓ ${e.code}: ${e.status}${e.reason ? ' — ' + e.reason : ''}`);
      else if (e.type === 'error') console.log(`  ✗ ${e.code}: ${e.error}`);
      else if (e.type === 'info') console.log(`[i] ${e.message}`);
    },
  });
  console.log('\n[runner] summary:', JSON.stringify(log.summary));
  console.log('[runner] log:', log.log_file);
}

main().catch((e) => { console.error('[runner] fatal:', e); process.exit(1); });
