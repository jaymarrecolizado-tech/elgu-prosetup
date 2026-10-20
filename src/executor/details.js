/**
 * Detail-row editing inside an expanded fee's calculation panel.
 * Consolidates the §7 lessons:
 *   §7.1 calculation creation auto-creates a placeholder detail — EDIT row 1,
 *        then Add the rest; never leave the placeholder
 *   §7.5 tables contain a spacer <tr> — target tr:has(button); first button =
 *        edit, second = delete (automation NEVER clicks delete)
 */
const { typeInto, hasField, setCheckbox, submitModal, cancelModal } = require('./modal');

/** Detail table rows with action buttons (skips spacer rows). */
const dataRows = (page) => page.locator('table tbody tr:has(button)');

/** Count real detail rows currently rendered. */
async function rowCount(page) {
  return dataRows(page).count();
}

/**
 * Fill the fields of whatever detail modal is open, then submit or cancel.
 * `fields` is an ordered map (object); boolean values target checkboxes,
 * everything else is keyboard-typed (§7.2).
 */
async function fillDetailModal(page, fields, { dryRun = false } = {}) {
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'boolean') {
      await setCheckbox(page, name, value);
    } else if (await hasField(page, name)) {
      await typeInto(page, name, value);
    }
  }
  if (dryRun) {
    await cancelModal(page);
    return { dryRun: true };
  }
  const toast = await submitModal(page);
  if (!toast) throw new Error('detail submit produced no success toast — modal may have stayed open');
  return { toast };
}

/**
 * Add every detail row for a calculation.
 * Row 0: try editing the auto-created placeholder first (§7.1); fall back to Add.
 * Rows 1+: use the panel's Add control (exact text "Add", not "Add Calculations").
 */
async function fillDetails(page, details, toFields, { dryRun = false } = {}) {
  const done = [];
  for (let i = 0; i < details.length; i++) {
    let opened = false;
    if (i === 0 && (await rowCount(page)) > 0) {
      await dataRows(page).first().locator('button').first().click(); // edit, never delete
      await page.waitForTimeout(700);
      opened = (await page.locator('.modal.show, [role=dialog]').count()) > 0;
    }
    if (!opened) {
      await page.locator(':text-is("Add")').first().click({ timeout: 8_000 });
      await page.waitForTimeout(700);
    }
    const res = await fillDetailModal(page, toFields(details[i], i), { dryRun });
    done.push({ index: i, ...res });
  }
  return done;
}

/** Map a §5 detail object → modal field map for range-style rows. */
function rangeFields(d) {
  const out = { from: d.from, to: d.to, amount: d.amount, rate: d.rate };
  if (d.for_excess_computation !== undefined) out.for_excess_computation = !!d.for_excess_computation;
  return out;
}

module.exports = { dataRows, rowCount, fillDetails, fillDetailModal, rangeFields };
