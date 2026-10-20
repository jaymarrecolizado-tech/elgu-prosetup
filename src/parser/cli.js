/**
 * Thin CLI: revenue_fees.json → elgu_config.json + confidence report (PLAN §6 Plan#2).
 * Usage: npm run parse [-- --in revenue_fees.json --out elgu_config.json]
 */
const fs = require('fs');
const path = require('path');
const { parseAll } = require('.');

const ROOT = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};

const IN = path.join(ROOT, arg('in', 'revenue_fees.json'));
const OUT = path.join(ROOT, arg('out', 'elgu_config.json'));

const fees = JSON.parse(fs.readFileSync(IN, 'utf8'));
const { configs, report } = parseAll(fees);

fs.writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), report, configs }, null, 2), 'utf8');

console.log(`[parse] ${fees.length} fees → ${configs.length} configs`);
console.log(`[parse] confidence: high=${report.by_confidence.high} needs_ai=${report.by_confidence.needs_ai} needs_human=${report.by_confidence.needs_human}`);
console.log('[parse] by type:', JSON.stringify(report.by_type));
if (report.set_errors.length) {
  console.error('[parse] SET ERRORS:', report.set_errors);
  process.exitCode = 1;
}
console.log('[parse] wrote', OUT);
