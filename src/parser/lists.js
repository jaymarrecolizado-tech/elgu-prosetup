/**
 * Enumerated-list parsing (PLAN §5):
 *   - label:amount lists (banks, amusement, vehicle types) → Options
 *   - conditional tier groups ("<25 sq.m.: 100.00 PHP, 25 to <50 sq.m.: ...") → Other Range
 */
const { MAX_TO, parseMoney, round2, toMultiplierCode } = require('./sanitize');
const { unitToMultiplierCode } = require('./classify');

const TIER_RE =
  /^(?:([A-Za-z][A-Za-z ]*?)\s+)?(?:([\d,.]+)\s*(?:to\s*<|–|—|-)\s*([\d,.]+)|(<=|>=|<|>)\s*([\d,.]+))\s*(.*)$/i;

/** Match "…<25 sq.m." / "25 to <50 sq.m." / ">=1000 sq.m." / "15-25 tons" / "Gross weight <15 tons". */
function matchTier(bracketText) {
  const s = String(bracketText).trim();
  const m = s.match(TIER_RE);
  if (!m) return null;
  let from = null;
  let to = null;
  if (m[2] !== undefined && m[3] !== undefined) {
    from = parseMoney(m[2]);
    // "25 to <50" and dash spans both end just below the upper bound (verified
    // S4D01 tiers are X.99-topped); dash spans get the same centavo convention.
    to = round2(parseMoney(m[3]) - 0.01);
  } else if (m[4] !== undefined) {
    const v = parseMoney(m[5]);
    if (m[4] === '<' || m[4] === '<=') { from = 0.01; to = round2(v - 0.01); }
    else { from = round2(v); to = MAX_TO; }
  }
  if (from === null || to === null) return null;
  const unit = (m[6] || '').trim();
  const lead = (m[1] || '').trim().toLowerCase();
  return { from, to, unit, lead };
}

/** Trailing text we refuse as part of a flat amount (compound/conditional values). */
const BAD_TRAILING = /[\d+<>%:]|\bper\s+\d/i;

/** A "Label: 220.00 PHP" segment (unit suffixes like /day allowed in trailing text). */
const FLAT_RE = /^([^:]{2,120}?)\s*:\s*(?:P|₱)?\s*([\d,]+(?:\.\d+)?)\s*(?:PHP|php)?\s*(.*)$/;

function matchFlat(segment) {
  const m = String(segment).trim().match(FLAT_RE);
  if (!m) return null;
  const amount = parseMoney(m[2]);
  if (amount === null) return null;
  const trailing = (m[3] || '').trim();
  // "/day", "/truck" style qualifiers are fine; digits/+/%/":" mean a compound value.
  if (BAD_TRAILING.test(trailing)) return null;
  return { label: m[1].trim(), amount, trailing };
}

/** Split a segment into comma-subparts "tier: amount" (used by tier groups). */
function parseTierGroup(text) {
  // "Business/industrial/agricultural: <25 sq.m.: 100.00 PHP, 25 to <50 sq.m.: 150.00 PHP, ..."
  const idx = text.indexOf(':');
  if (idx < 0) return null;
  const label = text.slice(0, idx).trim();
  const rest = text.slice(idx + 1);
  const pairs = rest.split(',').map((s) => s.trim()).filter(Boolean);
  const tiers = [];
  const units = new Set();
  for (const pair of pairs) {
    const c = pair.indexOf(':');
    if (c < 0) return null;
    const tier = matchTier(pair.slice(0, c));
    const amount = parseMoney(pair.slice(c + 1));
    if (!tier || amount === null) return null;
    tiers.push({ from: tier.from, to: tier.to, amount: round2(amount) });
    if (tier.unit) units.add(tier.unit.toLowerCase());
  }
  if (tiers.length < 2) return null;
  return { label, tiers, units: [...units] };
}

/**
 * Segment the formula on ';' and classify each part:
 *  tier      — whole segment is "tier-spec: amount" (e.g. "Gross weight <15 tons: 200.00 PHP/truck")
 *  tiergroup — "Label: tier: amount, tier: amount, …" (e.g. SEC-4D01 business tiers)
 *  flat      — "Label: amount"
 */
function segmentFormula(formula) {
  return String(formula)
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Options list → §5 Options details (multiplier code-style, amount exact).
 * Returns null when any segment is not a clean label:amount.
 */
function parseOptionsList(formula) {
  const segments = segmentFormula(formula);
  if (segments.length < 2) return null;
  const details = [];
  const notes = [];
  for (const seg of segments) {
    const flat = matchFlat(seg);
    if (!flat) return null;
    details.push({ multiplier: toMultiplierCode(flat.label), label: flat.label, amount: round2(flat.amount) });
    if (flat.trailing && /\//.test(flat.trailing)) {
      notes.push(`option "${flat.label}" has unit qualifier "${flat.trailing}" — Options details carry amount only; per-unit semantics will not be encoded`);
    }
  }
  return { details, notes };
}

/**
 * Conditional tiers → Other Range candidate.
 * Returns { tiers, unit, excluded: [flatLabels], notes } or null when the shape
 * is not a single uniform tier set. `{ multi: true, reason }` marks fees that
 * mix several tier dimensions (caller marks needs_human).
 */
function parseTieredFormula(formula) {
  const segments = segmentFormula(formula);
  const tierSegments = [];
  const tierGroups = [];
  const flats = [];
  let sawTierish = false;

  for (const seg of segments) {
    if (/<|>|<=|>=|to\s*<|–/.test(seg)) sawTierish = true;
    const group = parseTierGroup(seg);
    if (group) { tierGroups.push(group); continue; }
    const c = seg.indexOf(':');
    const head = c >= 0 ? seg.slice(0, c) : seg;
    const tail = c >= 0 ? seg.slice(c + 1) : '';
    const tier = matchTier(head);
    if (tier && parseMoney(tail) !== null && !tail.includes(',') && !/[+%]/.test(tail)) {
      tierSegments.push({ ...tier, amount: round2(parseMoney(tail)) });
      continue;
    }
    const flat = matchFlat(seg);
    if (flat) { flats.push(flat); continue; }
    return null; // unrecognized segment — caller marks needs_human
  }

  if (!sawTierish || (tierSegments.length === 0 && tierGroups.length === 0)) return null;

  // Single tier-group (+ optional flats excluded, verified as SEC-4D01 subset)
  if (tierGroups.length === 1 && tierSegments.length === 0) {
    const g = tierGroups[0];
    if (g.units.length !== 1) return { multi: true, reason: 'tier group mixes units' };
    return { tiers: g.tiers, unit: g.units[0], label: g.label, excluded: flats, notes: [] };
  }

  // Pure tier segments ("Gross weight <15 tons: 200/truck; …")
  if (tierSegments.length >= 2 && tierGroups.length === 0 && flats.length === 0) {
    const units = new Set(tierSegments.map((t) => (t.unit || '').toLowerCase()));
    if (units.size !== 1) return { multi: true, reason: 'tier segments mix units' };
    const leads = new Set(tierSegments.map((t) => t.lead || ''));
    if (leads.size !== 1) return { multi: true, reason: 'tier segments describe different dimensions' };
    return {
      tiers: tierSegments.map(({ from, to, amount }) => ({ from, to, amount })),
      unit: [...units][0],
      excluded: [],
      notes: [],
    };
  }

  return { multi: true, reason: 'tier and flat segments mixed in one fee' };
}

module.exports = { matchTier, matchFlat, parseTierGroup, parseOptionsList, parseTieredFormula, segmentFormula };
