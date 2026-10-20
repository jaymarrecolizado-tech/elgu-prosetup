'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { diffConfig } = require('../src/audit/diff');
const { parseFee } = require('../src/parser');

const ROOT = path.join(__dirname, '..');
const fees = JSON.parse(fs.readFileSync(path.join(ROOT, 'revenue_fees.json'), 'utf8'));
const dump = JSON.parse(fs.readFileSync(path.join(ROOT, 'elgu_sample_audit.json'), 'utf8'));

const taxLive = Object.fromEntries(dump.tax.map((t) => [t.code, t]));
const feeLive = Object.fromEntries(dump.fees.map((f) => [f.attrs?.code || f.code, f]));

/** Convert the captured dump into the live shape diffConfig expects. */
function liveFor(sampleCode) {
  const t = taxLive[sampleCode];
  if (t) {
    return {
      found: true,
      attrs: t,
      calculations: (t.calculations || []).map((c) => ({
        type: c.type,
        label: c.label,
        multiplier: c.multiplier,
        for_new: c.for_new,
        for_renewal: c.for_renewal,
        for_retirement: c.for_retirement,
        details: c.included || [],
      })),
    };
  }
  const f = feeLive[sampleCode];
  return f ? { found: true, attrs: f.attrs } : { found: false };
}

/** Re-key a parsed production config onto its SAMPLE-* twin. */
function asSample(prodCode, sampleCode, extra = {}) {
  const base = fees.find((f) => f.code === prodCode);
  const c = parseFee(base);
  c.code = sampleCode;
  return { ...c, ...extra };
}

test('audit diff: graduated gross (S2A02-A) → PASS, 20/20 ranges', () => {
  const c = asSample('MFG-2A02-A', 'SAMPLE-S2A02-A');
  const r = diffConfig(c, liveFor('SAMPLE-S2A02-A'));
  assert.equal(r.verdict, 'PASS', JSON.stringify(r.checks.filter((x) => !x.ok)));
});

test('audit diff: retailer rate tiers (S2A02-D) → PASS', () => {
  const r = diffConfig(asSample('RET-2A02-D', 'SAMPLE-S2A02-D'), liveFor('SAMPLE-S2A02-D'));
  assert.equal(r.verdict, 'PASS', JSON.stringify(r.checks.filter((x) => !x.ok)));
});

test('audit diff: gross rate (S2A02-F) → PASS', () => {
  const r = diffConfig(asSample('BNK-2A02-F', 'SAMPLE-S2A02-F'), liveFor('SAMPLE-S2A02-F'));
  assert.equal(r.verdict, 'PASS', JSON.stringify(r.checks.filter((x) => !x.ok)));
});

test('audit diff: capital range with excess top (S3A01-1C) → PASS', () => {
  const r = diffConfig(asSample('BUS-3A01-1', 'SAMPLE-S3A01-1C'), liveFor('SAMPLE-S3A01-1C'));
  assert.equal(r.verdict, 'PASS', JSON.stringify(r.checks.filter((x) => !x.ok)));
});

test('audit diff: gross excess (S3A01-1X) → PASS (no rate field on live side)', () => {
  const c = {
    code: 'SAMPLE-S3A01-1X',
    kind: 'tax_revenue',
    confidence: 'high',
    notes: [],
    calculation: {
      type: 'Gross Excess', multiplier_code: null,
      for_new: true, for_renewal: true, for_retirement: true,
      with_essential_computation: false, include_for_higher_value_comparison: false,
      details: [{ in_excess_of: 30000, for_every: 5000, amount: 15 }],
    },
  };
  const r = diffConfig(c, liveFor('SAMPLE-S3A01-1X'));
  assert.equal(r.verdict, 'PASS', JSON.stringify(r.checks.filter((x) => !x.ok)));
});

test('audit diff: options with bank_type (S3A01-2) → PASS', () => {
  const r = diffConfig(asSample('BNK-3A01-2', 'SAMPLE-S3A01-2'), liveFor('SAMPLE-S3A01-2'));
  assert.equal(r.verdict, 'PASS', JSON.stringify(r.checks.filter((x) => !x.ok)));
});

test('audit diff: quantity (S3G01) and fixed amount (S3A01-6) → PASS', () => {
  assert.equal(diffConfig(asSample('AMU-3G01', 'SAMPLE-S3G01'), liveFor('SAMPLE-S3G01')).verdict, 'PASS');
  assert.equal(diffConfig(asSample('SEC-3A01-6', 'SAMPLE-S3A01-6'), liveFor('SAMPLE-S3A01-6')).verdict, 'PASS');
});

test('audit diff: sqm subset (S4D01) → PARTIAL with reason (excluded flat)', () => {
  const r = diffConfig(asSample('SEC-4D01', 'SAMPLE-S4D01'), liveFor('SAMPLE-S4D01'));
  assert.equal(r.verdict, 'PARTIAL');
  assert.ok((r.partial_reasons || []).some((n) => n.includes('House for rent')));
});

test('audit diff: per-dog fixed (S4F01) → PARTIAL semantics', () => {
  const r = diffConfig(asSample('SEC-4F01', 'SAMPLE-S4F01'), liveFor('SAMPLE-S4F01'));
  assert.equal(r.verdict, 'PARTIAL');
});

test('audit diff: garbage single tier (S5B01) → PARTIAL (§2 known case)', () => {
  // The SAMPLE encoded only the Manufacturers ≤100sqm tier (₱420) as Fixed Amount.
  const c = {
    code: 'SAMPLE-S5B01', kind: 'tax_revenue', confidence: 'high',
    partial_semantics: true, notes: ['single tier of the per-establishment schedule encoded'],
    calculation: {
      type: 'Fixed Amount', multiplier_code: null,
      for_new: true, for_renewal: true, for_retirement: true,
      with_essential_computation: false, include_for_higher_value_comparison: false,
      details: [{ amount: 420 }],
    },
  };
  const r = diffConfig(c, liveFor('SAMPLE-S5B01'));
  assert.equal(r.verdict, 'PARTIAL');
});

test('audit diff: fixed fee (S4H01) → PASS; other fee basic (S3X01) → PARTIAL semantics', () => {
  const fixed = { code: 'SAMPLE-S4H01', kind: 'fixed_fee', confidence: 'high', notes: [], amount: 50 };
  assert.equal(diffConfig(fixed, liveFor('SAMPLE-S4H01')).verdict, 'PASS');

  const other = asSample('SEC-3X01', 'SAMPLE-S3X01');
  assert.equal(diffConfig(other, liveFor('SAMPLE-S3X01')).verdict, 'PARTIAL');
});

test('audit diff: missing fee → FAIL with evidence; wrong rate → FAIL', () => {
  const missing = diffConfig(asSample('MFG-2A02-A', 'NOPE-404'), { found: false });
  assert.equal(missing.verdict, 'FAIL');

  const c = asSample('BNK-2A02-F', 'SAMPLE-S2A02-F');
  c.calculation.details[0].rate = 0.0061; // tamper
  const wrong = diffConfig(c, liveFor('SAMPLE-S2A02-F'));
  assert.equal(wrong.verdict, 'FAIL');
  assert.ok(wrong.checks.some((x) => !x.ok));
});
