/**
 * Audit diff engine (PLAN §6 Plan#2 "Audit mode v1") — pure functions.
 * Compares a §5 config against the live API shape captured from eLGU
 * (see elgu_sample_audit.json for the authoritative live shapes) and yields
 * PASS / PARTIAL / FAIL with per-check evidence.
 */

/** §5 UI label → { apiType, defaultMultiplier } (from verified API dumps). */
const TYPE_MAP = {
  'Gross Range': { apiType: 'AMOUNT_RANGE', multiplier: 'gross_amount' },
  'Capital Range': { apiType: 'AMOUNT_RANGE', multiplier: 'capital_amount' },
  'Gross Rate': { apiType: 'BASIC', multiplier: 'gross_amount' },
  'Capital Rate': { apiType: 'BASIC', multiplier: 'capital_amount' },
  'Gross Excess': { apiType: 'EXCESS', multiplier: 'gross_amount' },
  Quantity: { apiType: 'QUANTITY', multiplier: null },
  Options: { apiType: 'OPTION', multiplier: null }, // multiplier = config's own
  'Other Range': { apiType: 'OTHER_RANGE', multiplier: null },
  'Fixed Amount': { apiType: 'FIXED_AMOUNT', multiplier: null },
};

const num = (v) => (v === null || v === undefined ? null : parseFloat(v));
const eqNum = (a, b, tol = 0.005) => Math.abs(num(a) - num(b)) <= tol;
const eqBool = (a, b) => !!Number(a) === !!b;

function near(a, b, tol) { return num(a) !== null && num(b) !== null && eqNum(a, b, tol); }

/** Compare one expected detail against one live detail row. */
function detailMatches(type, exp, live) {
  switch (type) {
    case 'Gross Range':
    case 'Capital Range':
      return (
        near(exp.from, live.from) && near(exp.to, live.to) &&
        near(exp.amount, live.amount) && near(exp.rate, live.rate, 1e-6) &&
        eqBool(exp.for_excess_computation, live.for_excess_computation)
      );
    case 'Other Range':
      return near(exp.from, live.from) && near(exp.to, live.to) && near(exp.amount, live.amount);
    case 'Gross Rate':
    case 'Capital Rate':
      return near(exp.rate, live.rate, 1e-6) && near(exp.amount ?? 0, live.amount ?? 0);
    case 'Fixed Amount':
    case 'Quantity':
      return near(exp.amount, live.amount);
    case 'Options':
      return String(exp.multiplier) === String(live.multiplier) && near(exp.amount, live.amount);
    case 'Gross Excess':
      return (
        near(exp.in_excess_of, live.in_excess_of) &&
        near(exp.for_every, live.for_every) &&
        near(exp.amount, live.amount)
      );
    default:
      return false;
  }
}

/**
 * Diff one §5 config against live API data.
 * taxRevenueLive: { found, attrs, calculations: [{ type, label, multiplier,
 *   for_new, for_renewal, for_retirement, details: [...] }] } (from audit.js)
 * simpleFeeLive:  { found, attrs } for fixed/other fees.
 * Returns { code, verdict, checks: [{check, ok, detail}], missing: [] }.
 */
function diffConfig(config, live) {
  const checks = [];
  const add = (check, ok, detail = '') => checks.push({ check, ok, detail });

  if (config.kind === 'fixed_fee' || config.kind === 'other_fee') {
    if (!live || !live.found) {
      add('fee exists on page', false, 'code not found in live list');
      return { code: config.code, verdict: 'FAIL', checks, missing: ['fee'] };
    }
    add('fee exists on page', true);
    const attrs = live.attrs;
    if (!eqNum(attrs.amount, config.amount)) add('amount', false, `expected ${config.amount}, live ${attrs.amount}`);
    else add('amount', true);
    if (config.kind === 'other_fee') {
      const t = String(attrs.type || '').toUpperCase();
      add('fee type', t === String(config.fee_type).toUpperCase(), `expected ${config.fee_type}, live ${t}`);
    }
    const verdict = checks.every((c) => c.ok) ? (config.partial_semantics ? 'PARTIAL' : 'PASS') : 'FAIL';
    return { code: config.code, verdict, checks };
  }

  // tax_revenue
  if (!live || !live.found) {
    add('fee exists on page', false, 'code not found in live list');
    return { code: config.code, verdict: 'FAIL', checks, missing: ['fee'] };
  }
  add('fee exists on page', true);

  const calc = config.calculation;
  const wanted = TYPE_MAP[calc.type];
  if (!wanted) return { code: config.code, verdict: 'FAIL', checks, missing: [`no API mapping for type ${calc.type}`] };

  const expMult = calc.type === 'Quantity' ? null : (calc.multiplier_code || wanted.multiplier);
  const calcLive = (live.calculations || []).find(
    (c) => c.type === wanted.apiType && c.multiplier === expMult,
  );
  if (!calcLive) {
    add(`calculation ${calc.type}`, false, `live calcs: ${(live.calculations || []).map((c) => `${c.type}/${c.multiplier}`).join(', ') || 'none'}`);
    return { code: config.code, verdict: 'FAIL', checks, missing: ['calculation'] };
  }
  add(`calculation ${calc.type}`, true, `label "${calcLive.label}"`);

  add('multiplier', calcLive.multiplier === expMult, `expected ${expMult}, live ${calcLive.multiplier}`);
  add('for_new', eqBool(calcLive.for_new, calc.for_new));
  add('for_renewal', eqBool(calcLive.for_renewal, calc.for_renewal));
  add('for_retirement', eqBool(calcLive.for_retirement, calc.for_retirement));

  const liveDetails = calcLive.details || [];
  const expected = calc.details || [];
  if (liveDetails.length !== expected.length) {
    add('detail count', false, `expected ${expected.length}, live ${liveDetails.length}`);
  } else {
    add('detail count', true, `${expected.length}`);
    const pool = [...liveDetails];
    let all = true;
    for (const exp of expected) {
      const i = pool.findIndex((l) => detailMatches(calc.type, exp, l));
      if (i < 0) { all = false; add('detail value', false, `no live row matches ${JSON.stringify(exp)}`); break; }
      pool.splice(i, 1);
    }
    if (all) add('detail values', true, 'all rows match');
  }

  const hardFail = checks.some((c) => !c.ok);
  const verdict = hardFail ? 'FAIL' : config.partial_semantics ? 'PARTIAL' : 'PASS';
  return {
    code: config.code,
    verdict,
    checks,
    partial_reasons: config.partial_semantics ? config.notes : undefined,
  };
}

module.exports = { diffConfig, TYPE_MAP, detailMatches };
