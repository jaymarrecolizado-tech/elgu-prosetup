/**
 * Thin CLI for audit mode (PLAN §6 Plan#2): re-read live config via API capture
 * and diff against elgu_config.json.
 *   node src/audit/cli.js [--codes A,B] [--in elgu_config.json]
 */
const fs = require('fs');
const path = require('path');
const { runAudit } = require('./audit');
const { diffConfig } = require('./diff');

const ROOT = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);
const val = (flag, def = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : def;
};

async function main() {
  const inPath = path.join(ROOT, val('--in', 'elgu_config.json'));
  const configs = JSON.parse(fs.readFileSync(inPath, 'utf8')).configs;
  const codes = val('--codes') ? val('--codes').split(',').map((s) => s.trim()).filter(Boolean) : null;
  const selected = codes ? configs.filter((c) => codes.includes(c.code)) : configs;

  const report = await runAudit({
    configs: selected,
    onEvent: (e) => {
      if (e.type === 'result') console.log(`  ${e.code}: ${e.verdict}`);
      else if (e.type === 'info') console.log(`[i] ${e.message}`);
    },
  });

  console.log('\n[audit] summary:', JSON.stringify(report.summary));
  console.log('[audit] report:', report.log_file);
  for (const r of report.results.filter((x) => x.verdict === 'FAIL')) {
    console.log(`  FAIL ${r.code}:`);
    r.checks.filter((c) => !c.ok).forEach((c) => console.log(`    - ${c.check}: ${c.detail}`));
  }
}

main().catch((e) => { console.error('[audit] fatal:', e); process.exit(1); });
