'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { looksGraduated, parseGraduated, parseRetailerTiers } = require('../src/parser/graduated');
const { parseFee, parseAll } = require('../src/parser/index');

const ROOT = path.join(__dirname, '..');
const fees = JSON.parse(fs.readFileSync(path.join(ROOT, 'revenue_fees.json'), 'utf8'));
const byCode = (code) => fees.find((f) => f.code === code);
const parsed = (code) => parseFee(byCode(code));

test('graduated detection', () => {
  assert.ok(looksGraduated(byCode('MFG-2A02-A').amount_or_formula));
  assert.ok(looksGraduated(byCode('BUS-3A01-1').amount_or_formula));
  assert.ok(!looksGraduated(byCode('RET-2A02-D').amount_or_formula)); // two-tier %, not bracket list
  assert.ok(!looksGraduated(byCode('SEC-4D01').amount_or_formula));
});

test('§5 graduated rule: Less than / X to <Y / Z or more (verified S2A02-A: 20 ranges exact)', () => {
  const c = parsed('MFG-2A02-A');
  assert.equal(c.confidence, 'high');
  assert.equal(c.calculation.type, 'Gross Range');
  const d = c.calculation.details;
  assert.equal(d.length, 20);
  assert.deepEqual(d[0], { from: 0.01, to: 9999.99, amount: 181.5, rate: 0, for_excess_computation: false });
  assert.deepEqual(d[1], { from: 10000, to: 14999.99, amount: 242, rate: 0, for_excess_computation: false });
  // Top bracket: 6,500,000 or more → 41 1/4% of 1% = 0.004125, base = prev amount
  assert.deepEqual(d[19], { from: 6500000, to: 99999999999, amount: 26812, rate: 0.004125, for_excess_computation: true });
});

test('§5 graduated: WHO top bracket 55% of 1% → 0.0055', () => {
  const d = parsed('WHO-2A02-B').calculation.details;
  assert.equal(d[d.length - 1].rate, 0.0055);
  assert.equal(d[d.length - 1].for_excess_computation, true);
});

test('§5 graduated: CON top bracket parenthetical becomes a note, rate still parsed', () => {
  const c = parsed('CON-2A02-E');
  assert.equal(c.confidence, 'high');
  assert.equal(c.calculation.details.at(-1).rate, 0.0055);
  assert.ok(c.notes.some((n) => n.includes('minimum tax P12,650.00')));
});

test('§5 graduated: plain "2%" top bracket flags needs_ai (unproven reading)', () => {
  const c = parsed('SER-2A02-G');
  assert.equal(c.confidence, 'needs_ai');
  const top = c.calculation.details.at(-1);
  assert.equal(top.rate, 0.02);
  assert.equal(top.for_excess_computation, true);
  assert.ok(c.notes.some((n) => n.includes('confirm this reading')));
});

test('§5 excess clause: For every 5,000 in excess of 30,000 → top rate 0.003 (verified S3A01-1C)', () => {
  const c = parsed('BUS-3A01-1');
  assert.equal(c.confidence, 'high');
  assert.equal(c.calculation.type, 'Capital Range'); // rate_structure mentions capital
  const d = c.calculation.details;
  assert.equal(d.length, 5);
  assert.deepEqual(d[4], { from: 30000, to: 99999999999, amount: 200, rate: 0.003, for_excess_computation: true });
  assert.ok(c.notes.some((n) => n.includes('Gross Excess')));
});

test('§5 Retailers two-tier (verified S2A02-D)', () => {
  const r = parseRetailerTiers(byCode('RET-2A02-D').amount_or_formula);
  assert.deepEqual(r.details, [
    { from: 0.01, to: 400000, amount: 0, rate: 0.024, for_excess_computation: false },
    { from: 400000.01, to: 99999999999, amount: 9600, rate: 0.012, for_excess_computation: true },
  ]);
  const c = parsed('RET-2A02-D');
  assert.equal(c.confidence, 'high');
  assert.equal(c.calculation.type, 'Gross Range');
});

test('§5 pure % rules: Gross Rate / Capital Rate', () => {
  const bnk = parsed('BNK-2A02-F'); // 55% of 1% (0.55%) of gross receipts
  assert.equal(bnk.calculation.type, 'Gross Rate');
  assert.deepEqual(bnk.calculation.details, [{ amount: 0, rate: 0.0055 }]);

  const nu = parsed('NEW-2A05'); // 1/4 of 1% (0.25%) of capital investment
  assert.equal(nu.calculation.type, 'Capital Rate');
  assert.deepEqual(nu.calculation.details, [{ amount: 0, rate: 0.0025 }]);

  const min = parsed('MIN-2F02'); // 2% of annual gross receipts
  assert.equal(min.calculation.type, 'Gross Rate');
  assert.deepEqual(min.calculation.details, [{ amount: 0, rate: 0.02 }]);
});

test('§5 rate with "in excess" qualifier is never silently encoded (SEC-2J02)', () => {
  const c = parsed('SEC-2J02');
  assert.equal(c.confidence, 'needs_human');
});

test('§5 floor-area tiers → Other Range sqm, excluded flat noted (verified S4D01)', () => {
  const c = parsed('SEC-4D01');
  assert.equal(c.confidence, 'high');
  assert.equal(c.calculation.type, 'Other Range');
  assert.equal(c.calculation.multiplier_code, 'sqm');
  const d = c.calculation.details;
  assert.equal(d.length, 7);
  assert.deepEqual(d[0], { from: 0.01, to: 24.99, amount: 100 });
  assert.deepEqual(d[6], { from: 1000, to: 99999999999, amount: 500 });
  assert.ok(c.notes.some((n) => n.includes('House for rent')));
});

test('§5 options: bank list → bank_type multiplier + code-style values (verified S3A01-2)', () => {
  const c = parsed('BNK-3A01-2');
  assert.equal(c.confidence, 'high');
  assert.equal(c.calculation.type, 'Options');
  assert.equal(c.calculation.multiplier_code, 'bank_type');
  const amounts = Object.fromEntries(c.calculation.details.map((d) => [d.multiplier, d.amount]));
  assert.deepEqual(amounts, {
    rural_thrift_savings_banks: 220,
    commercial_industrial_dev_banks: 330,
    universal_banks_insurance: 220,
    pawnshops_money_shops_lending: 440,
  });
});

test('§5 options with unproven multiplier dimension → needs_ai', () => {
  for (const code of ['PED-2D01', 'PUV-2A02-H', 'LIQ-3A01-3']) {
    const c = parsed(code);
    assert.equal(c.confidence, 'needs_ai', code);
    assert.equal(c.calculation.type, 'Options', code);
    assert.equal(c.calculation.multiplier_code, null, code);
  }
});

test('§5 flat rules per target_page (all verified patterns)', () => {
  const q = parsed('AMU-3G01'); // 150.00 PHP per day → Quantity
  assert.equal(q.calculation.type, 'Quantity');
  assert.equal(q.calculation.multiplier_code, 'quantity');
  assert.deepEqual(q.calculation.details, [{ amount: 150 }]);

  const s6 = parsed('SEC-3A01-6'); // 120.00 PHP per annum → Fixed Amount
  assert.equal(s6.calculation.type, 'Fixed Amount');
  assert.deepEqual(s6.calculation.details, [{ amount: 120 }]);

  const dog = parsed('SEC-4F01'); // 50.00 PHP per dog → Fixed Amount + note
  assert.equal(dog.calculation.type, 'Fixed Amount');
  assert.deepEqual(dog.calculation.details, [{ amount: 50 }]);
  assert.ok(dog.notes.some((n) => n.includes('per dog')));

  const otherDog = parsed('SEC-3X01'); // 25.00 PHP per dog → Other Fee BASIC
  assert.equal(otherDog.kind, 'other_fee');
  assert.equal(otherDog.fee_type, 'BASIC');
  assert.equal(otherDog.fee_class, 'COMMON_FEE');
  assert.equal(otherDog.amount, 25);
});

test('§5 multi-concept / external references → needs_human, never guessed', () => {
  for (const code of [
    'EXP-2A02-C', // half of rates of other subsections
    'SIG-2H01', // mixed signage units/ranges
    'SEC-2I02', // "not exceeding 60% of actual cost" cap
    'SEC-3O01', // external Building Code reference
    'SEC-3P01', // storage tiers per fuel + flats
    'SEC-3Q01', // HP tiers × two engine types
    'SEC-5B01', // garbage per establishment type + area tiers
    'MAR-5I03', // market stalls mixed per table/sqm/day
    'IND-602', // basic + additional per income
    'COR-603',
  ]) {
    const c = parsed(code);
    assert.equal(c.confidence, 'needs_human', `${code} should be needs_human`);
    assert.ok(c.notes.length >= 1, `${code} needs a reason note`);
    assert.equal(c.calculation, undefined, `${code} must not carry a guess`);
  }
});

test('fixed-fee lists surface a split decision instead of a bad single amount', () => {
  const c = parsed('SEC-4H01'); // clearance purposes list (one item was the verified sample)
  assert.equal(c.confidence, 'needs_ai');
  assert.equal(c.calculation, undefined);
  assert.ok(c.notes.some((n) => n.includes('6 items')));
});

test('parseAll: every fee yields exactly one config; brackets validated; codes unique', () => {
  const { configs, report } = parseAll(fees);
  assert.equal(configs.length, fees.length);
  assert.equal(report.set_errors.length, 0);
  const sum = report.by_confidence.high + report.by_confidence.needs_ai + report.by_confidence.needs_human;
  assert.equal(sum, fees.length);
  // All high-confidence graduated/range configs passed contiguity by construction
  // (validation failure would downgrade them); sanity-check one count floor.
  assert.ok(report.by_confidence.high >= 15, `expected most proven shapes to stay high (got ${report.by_confidence.high})`);
});

test('graduated parser refuses unknown bracket shapes', () => {
  assert.equal(parseGraduated('Weird thing: 10 PHP; Another weird: 20 PHP'), null);
});
