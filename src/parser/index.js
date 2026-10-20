/**
 * Deterministic fee parser (PLAN §5): revenue_fees.json row → elgu_config.json
 * entry. No browser, no AI, no I/O — pure functions. AI never touches this path;
 * ambiguous fees come out as confidence "needs_ai"/"needs_human" with reasons.
 */
const { pageKind, rangeType, rateType, unitToMultiplierCode, optionsMultiplierCode, isQuantityUnit } = require('./classify');
const { looksGraduated, isExcessOnly, parseGraduated, parseRetailerTiers } = require('./graduated');
const { parseTieredFormula, parseOptionsList } = require('./lists');
const { parsePureRate, parseFlat } = require('./formulas');
const { validateConfig, validateAll } = require('./validate');
const { round2 } = require('./sanitize');

function baseConfig(fee) {
  return {
    code: fee.code,
    article_section: fee.article_section,
    target_page: fee.target_page,
    description: fee.specific_fee_name,
    source: {
      article_section: fee.article_section,
      rate_structure: fee.rate_structure,
      amount_or_formula: fee.amount_or_formula,
    },
    kind: pageKind(fee.target_page),
    confidence: 'high',
    notes: [],
  };
}

function calcDefaults(fee, type, extra = {}) {
  return {
    type,
    multiplier_code: null,
    // All 13 verified samples show for_retirement=1 in the API even when the
    // checkbox was left unchecked — default true to match live behavior.
    for_new: true,
    for_renewal: true,
    for_retirement: true,
    with_essential_computation: false,
    include_for_higher_value_comparison: false,
    details: [],
    ...extra,
  };
}

function human(config, reason) {
  config.confidence = 'needs_human';
  config.notes.push(reason);
  delete config.calculation;
  delete config.amount;
  delete config.fee_type;
  return config;
}

/** Parse one fee row → §5 config. Never throws; ambiguity → needs_human. */
function parseFee(fee) {
  const config = baseConfig(fee);
  const formula = (fee.amount_or_formula || '').trim();

  if (!config.kind) return human(config, `unknown target_page "${fee.target_page}"`);

  try {
    // ---- Gross Excess only ("For every N in excess of M: A PHP") ----
    if (isExcessOnly(formula)) {
      const m = formula.match(/for every\s*([\d,.]+)\s*(?:php\s*)?in excess of\s*([\d,.]+)\s*:\s*([\d,.]+)/i);
      config.calculation = calcDefaults(fee, 'Gross Excess', {
        details: [{ in_excess_of: round2(parseFloat(m[2].replace(/,/g, ''))), for_every: round2(parseFloat(m[1].replace(/,/g, ''))), amount: round2(parseFloat(m[3].replace(/,/g, ''))) }],
      });
      return finish(config, fee);
    }

    // ---- Graduated bracket schedules (§5 graduated rules) ----
    if (looksGraduated(formula)) {
      const parsed = parseGraduated(formula);
      if (!parsed) return human(config, 'graduated formula contains an unparseable bracket — refusing to guess');
      config.calculation = calcDefaults(fee, rangeType(fee), { details: parsed.details });
      config.notes.push(...parsed.notes);
      config.confidence = parsed.confidence;
      return finish(config, fee);
    }

    // ---- Retailers two-tier % (verified S2A02-D) ----
    const retailers = parseRetailerTiers(formula);
    if (retailers) {
      config.calculation = calcDefaults(fee, 'Gross Range', { details: retailers.details });
      config.notes.push(...retailers.notes);
      return finish(config, fee);
    }

    // ---- Pure percentage (§5: Gross Rate / Capital Rate) ----
    const pureRate = parsePureRate(formula);
    if (pureRate) {
      config.calculation = calcDefaults(fee, rateType(fee), {
        details: [{ amount: 0, rate: pureRate.rate }],
      });
      return finish(config, fee);
    }

    // ---- Conditional tiers → Other Range (sqm verified S4D01) ----
    const tiered = parseTieredFormula(formula);
    if (tiered && tiered.multi) {
      return human(config, `multi-concept tiered fee (${tiered.reason}) — split ordinance sections before encoding`);
    }
    if (tiered) {
      const multiplier = unitToMultiplierCode(tiered.unit);
      config.calculation = calcDefaults(fee, 'Other Range', {
        multiplier_code: multiplier,
        details: tiered.tiers,
      });
      config.partial_semantics = tiered.excluded.length > 0;
      for (const f of tiered.excluded) {
        config.notes.push(`excluded from this calculation: "${f.label}" ${f.amount} (needs its own fee/option — verified subset behavior, S4D01)`);
      }
      if (!multiplier) {
        config.confidence = 'needs_ai';
        config.notes.push(`tier unit "${tiered.unit}" has no proven multiplier code (sqm is the only verified one) — pick the multiplier at creation`);
      }
      return finish(config, fee);
    }

    // ---- Enumerated label:amount lists → Options ----
    const options = parseOptionsList(formula);
    if (options) {
      if (config.kind === 'other_fee') {
        return human(config, `detected ${options.details.length}-item options list, but Other Fee page OPTION subtype is unsampled — encode manually after sampling`);
      }
      if (config.kind === 'fixed_fee') {
        // Fixed Fee page stores one amount per fee code — an Options calculation
        // cannot live there. Surface the parsed items for a human split decision.
        config.confidence = 'needs_ai';
        config.notes.push(
          `Fixed Fee page holds one amount per code; this list of ${options.details.length} items needs one fee per item (codes could be ${fee.code}-1…${fee.code}-${options.details.length}) — confirm the split before submit`,
          `items: ${options.details.map((d) => `${d.label}=${d.amount}`).join('; ')}`,
        );
        return config;
      }
      const multiplier = optionsMultiplierCode(fee);
      config.calculation = calcDefaults(fee, 'Options', {
        multiplier_code: multiplier,
        details: options.details.map(({ multiplier: m, amount }) => ({ multiplier: m, amount })),
      });
      config.notes.push(...options.notes);
      config.partial_semantics = options.notes.length > 0;
      if (!multiplier) {
        config.confidence = 'needs_ai';
        config.notes.push('options multiplier dimension unverified (bank_type/sqm/quantity are the proven codes) — select at calculation creation');
      }
      return finish(config, fee);
    }

    // ---- Single flat / per-unit amount ----
    const flat = parseFlat(formula);
    if (flat) {
      return finishFlat(config, fee, flat);
    }

    return human(config, 'formula does not match any deterministic rule (external reference, cap, or compound wording)');
  } catch (err) {
    return human(config, `parser error: ${err.message}`);
  }
}

function finishFlat(config, fee, flat) {
  const q = flat.qualifier.toLowerCase();
  if (config.kind === 'fixed_fee') {
    config.amount = flat.amount;
    config.multiplier = null;
    if (q) {
      config.partial_semantics = true;
      config.notes.push(`qualifier "${flat.qualifier}" not encoded on Fixed Fee page (single amount field)`);
    }
    return finish(config, fee);
  }
  if (config.kind === 'other_fee') {
    config.fee_type = 'BASIC';
    config.fee_class = 'COMMON_FEE';
    config.amount = flat.amount;
    if (q) {
      config.partial_semantics = true;
      config.notes.push(`qualifier "${flat.qualifier}" not encoded in Other Fee BASIC (verified S3X01 partial-semantics pattern)`);
    }
    return finish(config, fee);
  }
  // tax_revenue: per day → Quantity (verified S3G01); other units → Fixed Amount (verified S4F01)
  if (isQuantityUnit(flat.qualifier)) {
    config.calculation = calcDefaults(fee, 'Quantity', {
      multiplier_code: 'quantity',
      details: [{ amount: flat.amount }],
    });
    config.notes.push(`per-unit basis "${flat.qualifier}" encoded as Quantity (verified S3G01)`);
    // Quantity encodes per-unit semantics fully — not partial.
  } else {
    config.calculation = calcDefaults(fee, 'Fixed Amount', { details: [{ amount: flat.amount }] });
    if (q) {
      // Period qualifiers (per annum/year) are fully encoded by a fixed amount
      // (verified S3A01-6 = PASS); countable units (per dog/couple/table) are
      // not (verified S4F01 = PARTIAL semantics).
      const countable = !/per annum|per year|yearly|annually/i.test(flat.qualifier);
      config.partial_semantics = countable;
      config.notes.push(
        countable
          ? `qualifier "${flat.qualifier}" encoded as Fixed Amount (verified S4F01 pattern); switch to Quantity if per-unit charging is required`
          : `period qualifier "${flat.qualifier}" fully encoded as Fixed Amount (verified S3A01-6)`,
      );
    }
  }
  return finish(config, fee);
}

/** Run §5 validation; any error downgrades to needs_human. */
function finish(config, fee) {
  const errors = validateConfig(config);
  if (errors.length) {
    return human(config, `validation failed: ${errors.join('; ')}`);
  }
  return config;
}

/** Parse a whole revenue_fees.json array → { configs, report }. */
function parseAll(fees) {
  const configs = fees.map(parseFee);
  const errors = validateAll(configs, fees.length);
  const byConfidence = { high: 0, needs_ai: 0, needs_human: 0 };
  const byType = {};
  for (const c of configs) {
    byConfidence[c.confidence] += 1;
    const t = c.calculation ? c.calculation.type : c.kind === 'fixed_fee' ? 'Fixed Fee' : c.kind === 'other_fee' ? `Other Fee ${c.fee_type || ''}`.trim() : '(none)';
    byType[t] = (byType[t] || 0) + 1;
  }
  return {
    configs,
    report: {
      source_count: fees.length,
      config_count: configs.length,
      by_confidence: byConfidence,
      by_type: byType,
      set_errors: errors,
    },
  };
}

module.exports = { parseFee, parseAll, baseConfig };
