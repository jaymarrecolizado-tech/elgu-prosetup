/**
 * §5 validation rules — the parser must enforce these before a config is
 * considered usable: contiguous non-overlapping brackets, non-negative values,
 * top bracket present for graduated schedules, unique codes.
 */

const { MAX_TO } = require('./sanitize');

function validateDetails(calculation) {
  const errors = [];
  const type = calculation.type;
  const details = calculation.details || [];

  if (['Gross Range', 'Capital Range', 'Other Range'].includes(type)) {
    if (details.length === 0) errors.push('range calculation has no details');
    let prev = null;
    for (const d of details) {
      if (d.from === null || d.to === null || Number.isNaN(d.from) || Number.isNaN(d.to)) {
        errors.push(`range detail has non-numeric bounds: ${JSON.stringify(d)}`);
        continue;
      }
      if (d.from <= 0) errors.push(`range detail from must be > 0 (got ${d.from})`);
      if (d.to < d.from) errors.push(`range detail to < from (${d.from} → ${d.to})`);
      if (d.amount !== undefined && (d.amount < 0 || Number.isNaN(d.amount))) errors.push(`negative amount in ${d.from}–${d.to}`);
      if (d.rate !== undefined && (d.rate < 0 || Number.isNaN(d.rate))) errors.push(`negative rate in ${d.from}–${d.to}`);
      if (prev) {
        const expectedFrom = Math.round((prev.to + 0.01) * 100) / 100;
        if (Math.abs(d.from - expectedFrom) > 0.005) {
          errors.push(`brackets not contiguous: ${prev.from}–${prev.to} then ${d.from}–${d.to} (expected from ${expectedFrom})`);
        }
      }
      prev = d;
    }
    // Graduated schedules must be open-ended at the top.
    if (details.length && details[details.length - 1].to !== MAX_TO) {
      errors.push(`top bracket must end at ${MAX_TO} (got ${details[details.length - 1].to})`);
    }
  }

  if (type === 'Gross Rate' || type === 'Capital Rate') {
    const d = details[0];
    if (!d) errors.push('rate calculation has no detail');
    else {
      if (!(d.rate > 0)) errors.push(`rate must be > 0 (got ${d.rate})`);
      if (d.amount !== undefined && d.amount < 0) errors.push(`negative amount ${d.amount}`);
    }
  }

  if (type === 'Options') {
    if (details.length < 2) errors.push('Options calculation needs at least 2 details');
    for (const d of details) {
      if (!d.multiplier) errors.push('option detail missing code-style multiplier');
      if (!(d.amount >= 0)) errors.push(`option ${d.multiplier} amount must be ≥ 0`);
    }
  }

  if (type === 'Quantity' || type === 'Fixed Amount') {
    const d = details[0];
    if (!d) errors.push(`${type} calculation has no detail`);
    else if (!(d.amount >= 0)) errors.push(`${type} amount must be ≥ 0`);
  }

  if (type === 'Gross Excess') {
    const d = details[0];
    if (!d) errors.push('Gross Excess calculation has no detail');
    else {
      if (!(d.in_excess_of >= 0)) errors.push('in_excess_of must be ≥ 0');
      if (!(d.for_every > 0)) errors.push('for_every must be > 0');
      if (!(d.amount >= 0)) errors.push('amount must be ≥ 0');
    }
  }

  return errors;
}

/** Validate one §5 config; returns list of error strings (empty = valid). */
function validateConfig(config) {
  const errors = [];
  if (!config.code) errors.push('missing code');
  if (!config.kind) errors.push(`unknown target_page → kind for ${config.code}`);
  if (config.confidence !== 'needs_human') {
    if (config.kind === 'fixed_fee') {
      if (!(config.amount >= 0)) errors.push('fixed_fee amount must be ≥ 0');
    } else if (config.kind === 'other_fee') {
      if (!(config.amount >= 0)) errors.push('other_fee amount must be ≥ 0');
      if (!config.fee_type) errors.push('other_fee needs fee_type');
    } else if (!config.calculation || !config.calculation.type) {
      errors.push('missing calculation type');
    } else {
      errors.push(...validateDetails(config.calculation));
    }
  }
  return errors;
}

/** Whole-set checks (duplicate codes, every fee accounted for). */
function validateAll(configs, sourceCount) {
  const errors = [];
  const seen = new Map();
  for (const c of configs) {
    if (seen.has(c.code)) errors.push(`duplicate code ${c.code} (${seen.get(c.code)} and ${c.article_section})`);
    seen.set(c.code, c.article_section);
  }
  if (sourceCount !== undefined && configs.length !== sourceCount) {
    errors.push(`expected ${sourceCount} configs, produced ${configs.length}`);
  }
  return errors;
}

module.exports = { validateConfig, validateAll, validateDetails };
