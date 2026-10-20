/**
 * Deterministic text → number / code helpers shared by all parser rules.
 * Pure functions only — no browser, no AI, no I/O.
 */

const MAX_TO = 99999999999; // eLGU top-bracket ceiling (verified in samples)

/** "1,000.00" → 1000 ; "P400,000.00" → 400000 */
function parseMoney(s) {
  if (s === null || s === undefined) return null;
  const m = String(s).replace(/[P₱]/gi, '').replace(/,/g, '').trim().match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function round6(n) {
  return Math.round((n + Number.EPSILON) * 1e6) / 1e6;
}

/** "41 1/4" → 41.25 ; "1/4" → 0.25 ; "55" → 55 ; "2.4" → 2.4 */
function parseFraction(s) {
  const tokens = String(s).trim().split(/\s+/).filter(Boolean);
  let total = 0;
  for (const t of tokens) {
    if (t.includes('/')) {
      const [num, den] = t.split('/').map(Number);
      if (!den) return null;
      total += num / den;
    } else {
      const v = parseFloat(t);
      if (Number.isNaN(v)) return null;
      total += v;
    }
  }
  return tokens.length ? total : null;
}

/**
 * Rate expression → decimal fraction.
 *   "55% of 1%"        → 0.0055   (55% × 1%)
 *   "41 1/4% of 1%"    → 0.004125
 *   "1/4 of 1% (0.25%)" → 0.0025
 *   "2%" / "2.4%"      → 0.02 / 0.024
 * Returns null when no rate literal is found.
 */
function parseRate(expr) {
  const s = String(expr);
  // "55% of 1%" (percent of a percent → /100/100) vs "1/4 of 1%" (fraction
  // of one percent → /100 only).
  const ofOnePct = s.match(/([\d\s\/.]+?)\s*(%?)\s*of\s*1\s*%/i);
  if (ofOnePct) {
    const pct = parseFraction(ofOnePct[1]);
    if (pct !== null) {
      return round6(ofOnePct[2] === '%' ? pct / 100 / 100 : pct / 100);
    }
  }
  const plain = s.match(/(\d+(?:\.\d+)?)\s*%/);
  if (plain) return round6(parseFloat(plain[1]) / 100);
  return null;
}

/**
 * Display label → eLGU code-style multiplier value.
 * "Rural, Thrift, and Savings Banks" → "rural_thrift_savings_banks"
 * (Verified in training: option multiplier must be code-style, not display text.)
 */
function toMultiplierCode(label) {
  return String(label)
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/\band\b/g, ' ') // verified codes drop "and": rural_thrift_savings_banks
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
}

module.exports = { MAX_TO, parseMoney, round2, round6, parseFraction, parseRate, toMultiplierCode };
