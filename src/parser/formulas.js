/**
 * Pure rate / flat / per-unit formula parsing (PLAN §5):
 *   "55% of 1% (0.55%) of gross receipts"  → Gross Rate 0.0055
 *   "1/4 of 1% (0.25%) of capital investment" → Capital Rate 0.0025
 *   "2% of annual gross receipts"          → Gross Rate 0.02
 *   "150.00 PHP per day"                   → Quantity 150
 *   "50.00 PHP per dog"                    → Fixed Amount 50 (+note)
 *   "120.00 PHP per annum"                 → Fixed Amount 120 (verified S3A01-6)
 */
const { parseMoney, parseRate, round2, round6 } = require('./sanitize');

/** Rate formula usable as a single calculation rate (no excess qualifiers). */
function parsePureRate(formula) {
  const s = String(formula);
  if (/in excess|excess of|not exceeding|maximum|minimum/i.test(s)) return null;
  const rate = parseRate(s);
  if (rate === null || rate <= 0) return null;
  // Require the formula to *be* about a rate, not just contain a % token.
  if (!/%|of 1/i.test(s)) return null;
  return { rate };
}

/** Single flat amount, optionally with a per-unit qualifier: "150.00 PHP per day". */
function parseFlat(formula) {
  const s = String(formula).trim().replace(/\.$/, '');
  const m = s.match(/^(?:P|₱)?\s*([\d,]+(?:\.\d+)?)\s*(?:PHP)?\s*(.*)$/i);
  if (!m) return null;
  const qualifier = (m[2] || '').trim();
  // "/day", "per dog" qualifiers are fine; digits/+/%/<>/":" mean a compound value.
  if (/[\d+<>%:]|\bper\s+\d/i.test(qualifier)) return null;
  const amount = parseMoney(m[1]);
  if (amount === null) return null;
  return { amount: round2(amount), qualifier };
}

module.exports = { parsePureRate, parseFlat };
