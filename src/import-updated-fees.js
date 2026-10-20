/**
 * One-shot: normalize pasted fee JSON → revenue_fees.json
 * Usage: node src/import-updated-fees.js path/to/incoming.json
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const incomingPath = process.argv[2] || path.join(ROOT, '_incoming_fees.json');
const outPath = path.join(ROOT, 'revenue_fees.json');

const PAGE = {
  'License fee (Business Tax)': 'license',
  'Permit (Mayors permit)': 'permit',
  Sanitary: 'sanitary',
  Garbage: 'garbage',
  'fixed fees': 'new-fixed-fees',
  'Other Fees': 'new-other-fees',
};

function decode(s) {
  return String(s || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** eLGU code field: keep prefix + section, drop dots/parens → MFG-2A02-A */
function toCode(article) {
  return decode(article)
    .replace(/\./g, '')
    .replace(/\(([a-z0-9]+)\)/gi, '-$1')
    .replace(/[^A-Za-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toUpperCase();
}

const raw = JSON.parse(fs.readFileSync(incomingPath, 'utf8'));
const fees = raw.map((f) => {
  const category = decode(f.elgu_system_category).trim();
  const page = PAGE[category];
  if (!page) throw new Error(`Unknown category: ${category}`);
  const article = decode(f.article_section).trim();
  return {
    elgu_system_category: category,
    target_page: page,
    code: toCode(article),
    article_section: article,
    specific_fee_name: decode(f.specific_fee_name).trim(),
    rate_structure: decode(f.rate_structure).trim(),
    amount_or_formula: decode(f.amount_or_formula).trim(),
  };
});

const codes = fees.map((f) => f.code);
const dupes = codes.filter((c, i) => codes.indexOf(c) !== i);
if (dupes.length) throw new Error(`Duplicate codes: ${[...new Set(dupes)].join(', ')}`);

fs.writeFileSync(outPath, JSON.stringify(fees, null, 2) + '\n', 'utf8');
const byPage = fees.reduce((a, f) => { a[f.target_page] = (a[f.target_page] || 0) + 1; return a; }, {});
console.log(`[import] wrote ${fees.length} fees → ${outPath}`);
console.log('[import] by page:', byPage);
console.log('[import] sample codes:', fees.slice(0, 5).map((f) => f.code).join(', '));
