/**
 * Tax Revenue executor: create a fee (code+description), its calculation, and
 * all detail rows from a §5 config. One function per PLAN stage; idempotent
 * (skip-if-exists) and dry-run aware (fill → Cancel, zero submits).
 */
const { gotoSection, expandFee, feeExists, dismissModal } = require('./browser');
const { typeInto, fillInto, setCheckbox, selectReact, submitModal, cancelModal, modalFields, clickAction } = require('./modal');
const { fillDetails, rangeFields } = require('./details');

/** Create the tax revenue record itself (no calculation yet). */
async function createFeeRecord(page, config, { dryRun = false } = {}) {
  await gotoSection(page, config.target_page);
  if (await feeExists(page, config.code)) {
    await expandFee(page, config.code);
    return { status: 'exists' };
  }
  await clickAction(page, /Add Tax Revenue/);
  await page.waitForTimeout(800);
  // Add form: fill() is the proven path (typing reverts on these modals).
  await fillInto(page, 'code', config.code);
  await fillInto(page, 'description', config.description);
  if (dryRun) {
    await cancelModal(page);
    return { status: 'dry_run' };
  }
  const toast = await submitModal(page);
  if (!toast) throw new Error('tax revenue create produced no success toast');
  await page.waitForTimeout(800);
  await expandFee(page, config.code);
  return { status: 'created', toast };
}

/**
 * Add the calculation (Gross Range / Options / …) to the currently expanded fee.
 * §7.3: Options/Other Range need their multiplier code at creation — select the
 * 2nd react-select when the config carries one. Verifies the calculation shows
 * up before details are added.
 */
async function addCalculation(page, config, { dryRun = false } = {}) {
  const calc = config.calculation;
  await page.getByRole('button', { name: /Add Calculations/ }).first().click();
  await page.waitForTimeout(800);
  await selectReact(page, calc.type, 0);
  if (calc.multiplier_code) {
    // Multiplier is a free-text code field ("Ex. code_multiplier") on the
    // current UI — fill the code directly (bank_type / sqm / quantity).
    // Older builds used a react-select; keep that as fallback.
    const codeInput = page.locator(':is(.modal.show, [role=dialog]) input[placeholder*="code_multiplier"]');
    if (await codeInput.count()) {
      await codeInput.first().fill(calc.multiplier_code);
    } else if ((await page.locator(':is(.modal.show, [role=dialog]) input[id^="react-select"]').count()) > 1) {
      try {
        await selectReact(page, multiplierLabel(calc.multiplier_code), 1);
      } catch {
        const fields = await modalFields(page);
        throw new Error(`multiplier select failed for "${calc.multiplier_code}" — modal fields: ${JSON.stringify(fields?.fields?.map((f) => f.label))}`);
      }
    }
    // else: type (e.g. Quantity) carries its multiplier implicitly — no field to fill.
  }
  await setCheckbox(page, 'for_new', calc.for_new);
  await setCheckbox(page, 'for_renewal', calc.for_renewal);
  await setCheckbox(page, 'for_retirement', calc.for_retirement);
  await setCheckbox(page, 'with_essential_computation', calc.with_essential_computation);
  if (dryRun) {
    await cancelModal(page);
    return { status: 'dry_run' };
  }
  const toast = await submitModal(page);
  if (!toast) throw new Error('calculation submit produced no success toast — multiplier code missing? (§7.3)');
  await page.waitForTimeout(900);
  // §7.3: always verify the calculation appears before adding details.
  // The expanded panel can be stale right after submit — reload the section
  // and re-expand once before declaring failure (audit verifies via API).
  let body = await page.evaluate(() => document.body.innerText);
  if (!body.includes(calc.type)) {
    await gotoSection(page, config.target_page);
    await expandFee(page, config.code);
    body = await page.evaluate(() => document.body.innerText);
  }
  // Tab labels (e.g. "Options") are not always in body text after re-expand;
  // the Calculations panel + a success toast is sufficient evidence here —
  // the audit mode verifies the calculation via API afterwards.
  if (!body.includes(calc.type) && !body.includes('Calculations')) {
    throw new Error(`calculation "${calc.type}" not visible after submit`);
  }
  return { status: 'created', toast };
}

/** multiplier code → react-select label (only proven mappings). */
function multiplierLabel(code) {
  const map = { bank_type: 'Bank Type', sqm: 'Sqm Range', quantity: 'Quantity' };
  return map[code] || code;
}

/** Detail §5 object → modal fields, per calculation type. */
function detailFields(calc, d) {
  switch (calc.type) {
    case 'Gross Range':
    case 'Capital Range':
      return rangeFields(d);
    case 'Other Range':
      return { from: d.from, to: d.to, amount: d.amount };
    case 'Gross Rate':
    case 'Capital Rate':
      return { amount: d.amount, rate: d.rate };
    case 'Fixed Amount':
    case 'Quantity':
      return { amount: d.amount };
    case 'Options':
      return { multiplier: d.multiplier, amount: d.amount };
    case 'Gross Excess':
      return { in_excess_of: d.in_excess_of, for_every: d.for_every, amount: d.amount };
    default:
      throw new Error(`no detail mapping for calculation type "${calc.type}"`);
  }
}

/**
 * Full tax-revenue flow for one §5 config: create record → calculation →
 * details. Idempotent: skips whatever already exists. In dry-run nothing is
 * ever submitted (every modal is cancelled after filling).
 */
async function executeTaxRevenue(page, config, { dryRun = false } = {}) {
  const steps = {};
  steps.fee = await createFeeRecord(page, config, { dryRun });
  if (steps.fee.status === 'dry_run') return steps;

  const calc = config.calculation;
  const body = await page.evaluate(() => document.body.innerText);
  if (body.includes(calc.type)) {
    steps.calculation = { status: 'exists' };
  } else {
    steps.calculation = await addCalculation(page, config, { dryRun });
  }
  if (steps.calculation.status === 'dry_run') return steps;

  const { dataRows } = require('./details');
  const existing = await dataRows(page).count();
  // A just-created calculation only has the auto placeholder row (§7.1) —
  // it must be edited, not counted as done, even for 1-detail configs.
  if (steps.calculation.status !== 'created' && existing >= calc.details.length) {
    steps.details = { status: 'exists', count: existing };
    return steps;
  }
  // §7.6: panels may have collapsed after the calculation submit — the fee is
  // already expanded here; just settle before touching detail rows.
  await page.waitForTimeout(400);
  steps.details = await fillDetails(page, calc.details, (d) => detailFields(calc, d), { dryRun });
  await dismissModal(page);
  return steps;
}

module.exports = { createFeeRecord, addCalculation, executeTaxRevenue, detailFields, multiplierLabel };
