/**
 * Classification helpers: which eLGU page kind, calculation type, and multiplier
 * a fee's metadata points at. Deterministic keyword rules only (PLAN §5);
 * anything not provable here stays `null` and the caller downgrades confidence.
 */

/** target_page → §5 schema kind */
function pageKind(targetPage) {
  switch (targetPage) {
    case 'license':
    case 'permit':
    case 'sanitary':
    case 'garbage':
      return 'tax_revenue';
    case 'new-fixed-fees':
      return 'fixed_fee';
    case 'new-other-fees':
      return 'other_fee';
    default:
      return null;
  }
}

/** True when the fee's basis is capital investment (→ Capital Range / Capital Rate). */
function isCapitalBasis(fee) {
  return /capital/i.test(fee.rate_structure || '') || /capital investment/i.test(fee.amount_or_formula || '');
}

/** Range type from basis: Capital Range vs Gross Range (verified S3A01-1C chose Capital). */
function rangeType(fee) {
  return isCapitalBasis(fee) ? 'Capital Range' : 'Gross Range';
}

/** Rate type from basis: Capital Rate vs Gross Rate. */
function rateType(fee) {
  return isCapitalBasis(fee) ? 'Capital Rate' : 'Gross Rate';
}

/**
 * Tier unit → calculation multiplier code. Only codes proven in training are
 * returned; everything else is null (caller flags needs_ai).
 * Proven: sqm ("Sqm Range"), quantity, bank_type ("Bank Type").
 */
function unitToMultiplierCode(unit) {
  const u = String(unit || '').toLowerCase().replace(/\s+/g, '');
  if (/^sq\.?m\.?$|^sqm$|sq\.?m/.test(u)) return 'sqm';
  return null;
}

/** Rate-structure / name keywords → known Options multiplier codes (proven). */
function optionsMultiplierCode(fee) {
  const hay = `${fee.rate_structure || ''} ${fee.specific_fee_name || ''}`.toLowerCase();
  if (/bank|financial institution/.test(hay)) return 'bank_type';
  return null;
}

/**
 * Per-unit flat rule (both verified in training):
 *  - "per day" → Quantity (S3G01: 150.00 PHP per day → Quantity 150)
 *  - other per-units (per dog S4F01, per couple, per table) → Fixed Amount + note
 */
function isQuantityUnit(unitText) {
  return /per day\b|\/day\b/i.test(unitText || '');
}

module.exports = {
  pageKind,
  isCapitalBasis,
  rangeType,
  rateType,
  unitToMultiplierCode,
  optionsMultiplierCode,
  isQuantityUnit,
};
