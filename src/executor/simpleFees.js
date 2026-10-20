/**
 * Fixed Fee / Other Fee executor (separate eLGU pages, single-modal creation).
 * Patterns proven by FIXED-SAMPLE-S4H01 and OTHER-SAMPLE-S3X01:
 *   - Add modals: fill() for text fields (typing reverts on these forms)
 *   - react-select #1 = fee type (BASIC), #2 = fee class (COMMON FEE)
 *   - page reload before interacting (a prior tax-revenue page visit leaves
 *     the SPA's react-select state stale and menus never open)
 */
const { gotoSection, feeExists } = require('./browser');
const { fillInto, setCheckbox, selectReact, submitModal, cancelModal, hasField, clickAction } = require('./modal');

/** Verify the section is fresh, then open the Add modal (retry once if the SPA stalls). */
async function openAddModal(page, code, buttonRe) {
  if (await feeExists(page, code)) return 'exists';
  await clickAction(page, buttonRe);
  await page.waitForTimeout(900);
  return 'open';
}

async function typeDescription(page, description) {
  const desc = page.locator(
    '.modal.show textarea[name="description"], [role=dialog] textarea[name="description"], .modal.show input[name="description"], [role=dialog] input[name="description"]',
  );
  await desc.first().fill(description);
}

/** Fixed Fee page: code + description + amount (+ optional multiplier select). */
async function executeFixedFee(page, config, { dryRun = false } = {}) {
  await gotoSection(page, 'new-fixed-fees', { fresh: true });
  if ((await openAddModal(page, config.code, /Add Fixed Fee/)) === 'exists') return { status: 'exists' };
  await fillInto(page, 'code', config.code);
  await typeDescription(page, config.description);
  await fillInto(page, 'amount', config.amount);
  await setCheckbox(page, 'for_new', true);
  await setCheckbox(page, 'for_renewal', true);
  if (dryRun) {
    await cancelModal(page);
    return { status: 'dry_run' };
  }
  const toast = await submitModal(page);
  if (!toast) throw new Error('fixed fee submit produced no success toast');
  return { status: 'created', toast };
}

/** Other Fee page: fee type + fee class react-selects, then amount (proven S3X01 flow). */
async function executeOtherFee(page, config, { dryRun = false } = {}) {
  await gotoSection(page, 'new-other-fees', { fresh: true });
  if ((await openAddModal(page, config.code, /Add Other Fee/)) === 'exists') return { status: 'exists' };
  await fillInto(page, 'code', config.code);
  await typeDescription(page, config.description);
  await selectReact(page, config.fee_type, { controlText: 'Select Type' });
  await page.waitForTimeout(700); // modal re-renders (amount + endorsing-office fields appear)
  // §5 schema stores code-style values (COMMON_FEE); the UI shows them spaced.
  await selectReact(page, String(config.fee_class).replace(/_/g, ' '), { controlText: 'Select Fee Type' });
  await page.waitForTimeout(500);
  if (await hasField(page, 'amount')) await fillInto(page, 'amount', config.amount);
  await setCheckbox(page, 'for_new', true);
  await setCheckbox(page, 'for_renewal', true);
  if (dryRun) {
    await cancelModal(page);
    return { status: 'dry_run' };
  }
  const toast = await submitModal(page);
  if (!toast) throw new Error('other fee submit produced no success toast');
  return { status: 'created', toast };
}

/** Dispatch by §5 kind. */
function executeSimpleFee(page, config, opts) {
  if (config.kind === 'fixed_fee') return executeFixedFee(page, config, opts);
  if (config.kind === 'other_fee') return executeOtherFee(page, config, opts);
  throw new Error(`executeSimpleFee: kind "${config.kind}" is not a simple fee`);
}

module.exports = { executeFixedFee, executeOtherFee, executeSimpleFee };
