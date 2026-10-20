'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMoney, parseFraction, parseRate, toMultiplierCode, round2, round6 } = require('../src/parser/sanitize');

test('parseMoney strips commas, P/₱ and picks the number', () => {
  assert.equal(parseMoney('1,000.00'), 1000);
  assert.equal(parseMoney('P400,000.00'), 400000);
  assert.equal(parseMoney('₱75'), 75);
  assert.equal(parseMoney('41.5'), 41.5);
  assert.equal(parseMoney('no digits'), null);
});

test('parseFraction handles mixed fractions (§5 top-bracket rates)', () => {
  assert.equal(parseFraction('41 1/4'), 41.25);
  assert.equal(parseFraction('55'), 55);
  assert.equal(parseFraction('1/4'), 0.25);
});

test('parseRate: "% of 1%" → /100/100, plain % → /100', () => {
  assert.equal(parseRate('55% of 1%'), 0.0055);
  assert.equal(parseRate('41 1/4% of 1%'), 0.004125);
  assert.equal(parseRate('1/4 of 1% (0.25%)'), 0.0025);
  assert.equal(parseRate('2%'), 0.02);
  assert.equal(parseRate('2.4%'), 0.024);
  assert.equal(parseRate('no rate here'), null);
});

test('toMultiplierCode produces eLGU code-style option values (verified S3A01-2)', () => {
  assert.equal(toMultiplierCode('Rural, Thrift, and Savings Banks'), 'rural_thrift_savings_banks');
  assert.equal(toMultiplierCode('Commercial, Industrial, Dev Banks'), 'commercial_industrial_dev_banks');
  assert.equal(toMultiplierCode('Universal Banks/Insurance'), 'universal_banks_insurance');
  assert.equal(toMultiplierCode('Pawnshops/Money Shops/Lending'), 'pawnshops_money_shops_lending');
});

test('rounding helpers', () => {
  assert.equal(round2(400000 * 0.024), 9600);
  assert.equal(round6(41.25 / 100 / 100), 0.004125);
});
