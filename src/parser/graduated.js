/**
 * Graduated bracket parsing (PLAN §5 rules — proven against verified samples).
 *
 * Shapes handled:
 *   "Less than 10,000: 181.50 PHP; 10,000 to <15,000: 242.00 PHP; ...;
 *    6,500,000 or more: 41 1/4% of 1%"
 *   "Less than 5,000: 30.00 PHP; ...; For every 5,000 in excess of 30,000: 15.00 PHP"
 *   "2.4% per annum on P400,000.00 or less; 1.2% per annum on excess over P400,000.00"
 */
const { MAX_TO, parseMoney, round2, round6, parseRate } = require('./sanitize');

const EXCESS_CLAUSE =
  /for every\s*([\d,.]+)\s*(?:php\s*)?in excess of\s*([\d,.]+)/i;

const TOP_PCT_OF_ONE = /([\d\s\/.]+?)\s*%?\s*of\s*1\s*%/i;
const TOP_PLAIN_PCT = /^(\d+(?:\.\d+)?)\s*%$/;

/** True when the formula looks like a `;`-separated bracket schedule. */
function looksGraduated(formula) {
  const parts = String(formula).split(';').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return false;
  const bracketish = parts.filter(
    (p) => /less than/i.test(p) || /\bto\s*<\s*[\d,.]+/i.test(p) || /or more/i.test(p) || EXCESS_CLAUSE.test(p),
  );
  return bracketish.length === parts.length && parts.every((p) => p.includes(':'));
}

/** True when the formula is exactly one excess clause. */
function isExcessOnly(formula) {
  const s = String(formula).trim();
  return EXCESS_CLAUSE.test(s) && s.split(';').length === 1;
}

/**
 * Parse one bracket schedule into §5 range details.
 * Returns { details, notes, confidence } or null when a part cannot be parsed
 * deterministically.
 */
function parseGraduated(formula) {
  const parts = String(formula).split(';').map((s) => s.trim()).filter(Boolean);
  const details = [];
  const notes = [];
  let confidence = 'high';

  for (const part of parts) {
    const idx = part.indexOf(':');
    if (idx < 0) return null;
    const bracket = part.slice(0, idx).trim();
    let value = part.slice(idx + 1).trim();

    // Capture parentheticals (e.g. "(minimum tax P12,650.00)") as notes
    const parens = value.match(/\(([^)]+)\)/);
    if (parens) {
      notes.push(`top bracket: ${parens[1]}`);
      value = value.replace(/\([^)]*\)/g, '').trim();
    }

    const excess = bracket.match(EXCESS_CLAUSE);
    if (excess) {
      // "For every 5,000 in excess of 30,000: 15.00 PHP" → top bracket with
      // rate = amount/for_every (verified PASS as S3A01-1C: 15/5000 = 0.003).
      const forEvery = parseMoney(excess[1]);
      const inExcessOf = parseMoney(excess[2]);
      const amount = parseMoney(value);
      if (![forEvery, inExcessOf, amount].every((v) => v !== null)) return null;
      const prev = details[details.length - 1];
      details.push({
        from: round2(inExcessOf),
        to: MAX_TO,
        amount: prev ? prev.amount : 0,
        rate: round6(amount / forEvery),
        for_excess_computation: true,
      });
      notes.push(
        `excess clause encoded as top-bracket rate ${round6(amount / forEvery)} (verified S3A01-1C); alternative: separate Gross Excess calculation {in_excess_of ${inExcessOf}, for_every ${forEvery}, amount ${amount}}`,
      );
      continue;
    }

    if (/less than/i.test(bracket)) {
      const to = parseMoney(bracket.replace(/less than/i, ''));
      const amount = parseMoney(value);
      if (to === null || amount === null) return null;
      details.push({ from: 0.01, to: round2(to - 0.01), amount: round2(amount), rate: 0, for_excess_computation: false });
      continue;
    }

    const top = bracket.match(/([\d,.]+)\s*or more/i);
    if (top) {
      const from = parseMoney(top[1]);
      if (from === null) return null;
      const prev = details[details.length - 1];
      const ofOne = value.match(TOP_PCT_OF_ONE);
      const plain = value.match(TOP_PLAIN_PCT);
      if (ofOne) {
        // "41 1/4% of 1%" → rate 0.004125, amount = previous bracket (verified S2A02-A)
        const rate = parseRate(value);
        if (rate === null) return null;
        details.push({ from: round2(from), to: MAX_TO, amount: prev ? prev.amount : 0, rate, for_excess_computation: true });
      } else if (plain) {
        // Plain "2%" top bracket: encode base+excess like the proven pattern, but
        // flag for review — the ordinance text does not say "of the excess".
        const rate = parseFloat(plain[1]) / 100;
        details.push({ from: round2(from), to: MAX_TO, amount: prev ? prev.amount : 0, rate: round6(rate), for_excess_computation: true });
        notes.push(`top bracket "${value}" read as base amount + ${plain[1]}% on excess (same encoding as "% of 1%" brackets); confirm this reading before submit`);
        confidence = 'needs_ai';
      } else {
        const amount = parseMoney(value);
        if (amount === null) return null;
        details.push({ from: round2(from), to: MAX_TO, amount: round2(amount), rate: 0, for_excess_computation: false });
      }
      continue;
    }

    // "10,000 to <15,000"
    const span = bracket.split(/\s+to\s*</i);
    if (span.length === 2) {
      const lo = parseMoney(span[0]);
      const hi = parseMoney(span[1]);
      const amount = parseMoney(value);
      if ([lo, hi, amount].some((v) => v === null)) return null;
      details.push({ from: round2(lo), to: round2(hi - 0.01), amount: round2(amount), rate: 0, for_excess_computation: false });
      continue;
    }

    return null; // unknown bracket shape — never guess
  }

  return { details, notes, confidence };
}

/**
 * Retailers two-tier rule (verified S2A02-D):
 * "2.4% per annum on P400,000.00 or less; 1.2% per annum on excess over P400,000.00"
 * → tier 1 rate 0.024; tier 2 amount = cap × rate1 (9,600), rate 0.012, excess.
 */
function parseRetailerTiers(formula) {
  const m = String(formula).match(
    /(\d+(?:\.\d+)?)\s*%\s*(?:per annum\s*)?on\s*P?([\d,.]+)\s*or less\s*;\s*(\d+(?:\.\d+)?)\s*%\s*(?:per annum\s*)?on\s*excess over\s*P?([\d,.]+)/i,
  );
  if (!m) return null;
  const rate1 = parseFloat(m[1]) / 100;
  const cap = parseMoney(m[2]);
  const rate2 = parseFloat(m[3]) / 100;
  const excessOver = parseMoney(m[4]);
  if (cap === null || excessOver === null) return null;
  return {
    details: [
      { from: 0.01, to: round2(cap), amount: 0, rate: round6(rate1), for_excess_computation: false },
      { from: round2(cap + 0.01), to: MAX_TO, amount: round2(cap * rate1), rate: round6(rate2), for_excess_computation: true },
    ],
    notes: [`tier-2 base amount ${round2(cap * rate1)} = ${cap} × ${m[1]}% (verified S2A02-D)`],
    confidence: 'high',
  };
}

module.exports = { looksGraduated, isExcessOnly, parseGraduated, parseRetailerTiers, EXCESS_CLAUSE };
