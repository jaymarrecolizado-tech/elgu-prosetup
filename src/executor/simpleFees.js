/**
 * Fixed Fee / Other Fee executor (separate eLGU pages, single-modal creation).
 * Patterns proven by FIXED-SAMPLE-S4H01 and OTHER-SAMPLE-S3X01.
 */
const { gotoSection, feeExists } = require('./browser');
const { typeInto, setCheckbox, selectReact, submitModal, cancelModal, hasField } = require('./modal');

/**
 * Fixed Fee page: code + description + amount (+ optional multiplier select).
 * Multiplier stays unset when config.multiplier is null (proven sample behavior).
 */
async function executeFixedFee(page, config, { dryRun = false } = {}) {
  await gotoSection(page, 'new-fixed-fees');
  if (await feeExists(page, config.code)) return { status: 'exists' };
  await page.getByRole('button', { name: /Add Fixed Fee/ }).first().click();
  await page.waitForTimeout(900);
  await typeInto(page, 'code', config.code);
  const desc = page.locator('.modal.show textarea[name="description"], [role=dialog] textarea[name="description"], .modal.show input[name="description"], [role=dialog] input[name="description"]');
  await desc.first().click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await desc.first().pressSequentially(config.description, { delay: 3 });
  await typeInto(page, 'amount', config.amount);
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

/**
 * Other Fee page: react-select #1 = fee type (BASIC), #2 = fee class
 * (COMMON FEE), then amount appears (proven OTHER-SAMPLE-S3X01 flow).
 */
async function executeOtherFee(page, config, { dryRun = false } = {}) {
  await gotoSection(page, 'new-other-fees');
  if (await feeExists(page, config.code)) return { status: 'exists' };
  await page.getByRole('button', { name: /Add Other Fee/ }).first().click();
  await page.waitForTimeout(900);
  await typeInto(page, 'code', config.code);
  const desc = page.locator('.modal.show textarea[name="description"], [role=dialog] textarea[name="description"], .modal.show input[name="description"], [role=dialog] input[name="description"]');
  await desc.first().click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await desc.first().pressSequentially(config.description, { delay: 3 });
  await selectReact(page, config.fee_type, 0);
  await selectReact(page, config.fee_class, 1);
  await page.waitForTimeout(500);
  if (await hasField(page, 'amount')) await typeInto(page, 'amount', config.amount);
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
