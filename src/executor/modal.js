/**
 * Modal form helpers — consolidated from the proven sample scripts.
 * Implements the hard-won PLAN §7 lessons:
 *   §7.2 masked amount/code fields only persist with real keyboard typing
 *   §7.6 verify via toast after every submit; Escape lingers away
 *   §7.7 React-Select fields have no name — target input[id^="react-select"]
 */

const MODAL = '.modal.show, [role=dialog]';

/** Dump the open modal's fields (recon/debug aid; cheap and non-invasive). */
async function modalFields(page) {
  return page.evaluate((sel) => {
    const m = document.querySelector(sel);
    if (!m) return null;
    const labelFor = (el) => el.closest('.form-group,div')?.querySelector('label')?.innerText.trim() || null;
    return {
      title: (m.querySelector('.modal-title,h4,h5')?.innerText || '').trim(),
      fields: [...m.querySelectorAll('input,select,textarea')]
        .filter((e) => e.type !== 'hidden')
        .map((e) => ({ type: e.type, name: e.name || null, id: e.id || null, label: labelFor(e), value: e.value })),
    };
  }, MODAL);
}

/**
 * Type a value into a named field inside the open modal using real keyboard
 * events (select-all → backspace → pressSequentially → Tab). `fill()` silently
 * reverts to 0 on Update-modal masked fields — never use it here.
 */
async function typeInto(page, name, value) {
  const loc = page.locator(`${MODAL} [name="${name}"]`);
  if (!(await loc.count())) throw new Error(`field "${name}" not found in modal`);
  await loc.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await loc.pressSequentially(String(value), { delay: 5 });
  await page.keyboard.press('Tab');
}

async function hasField(page, name) {
  return (await page.locator(`${MODAL} [name="${name}"]`).count()) > 0;
}

/** Set a checkbox in the open modal to the wanted state. */
async function setCheckbox(page, name, want) {
  const cb = page.locator(`${MODAL} input[name="${name}"]`);
  if (!(await cb.count())) return false;
  if (want && !(await cb.isChecked())) await cb.check({ force: true });
  if (!want && (await cb.isChecked())) await cb.uncheck({ force: true });
  return true;
}

/**
 * Pick an option in a React-Select control (nth react-select input in the
 * modal) by its exact visible text (PLAN §7.7).
 */
async function selectReact(page, optionText, nth = 0) {
  const input = page.locator(`${MODAL} input[id^="react-select"]`).nth(nth);
  if (!(await input.count())) throw new Error(`react-select #${nth} not found in modal`);
  await input.click({ force: true });
  await page.waitForTimeout(500);
  await page.getByText(optionText, { exact: true }).first().click();
  await page.waitForTimeout(400);
}

/**
 * Submit the open modal. Returns the captured success toast text (or null) —
 * callers must treat a missing toast as a failure (PLAN §7.6/§7.8).
 */
async function submitModal(page) {
  await page.locator(`${MODAL} button:has-text("Submit")`).first().click({ timeout: 10_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(800);
  return toastText(page);
}

/** Dry-run counterpart: cancel the modal without submitting anything. */
async function cancelModal(page) {
  const cancel = page.locator(`${MODAL} button:has-text("Cancel"), ${MODAL} button:has-text("Close")`).first();
  if (await cancel.count()) await cancel.click({ timeout: 5_000 }).catch(() => {});
  else await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);
}

/** Last "successfully …" toast on the page, if any. */
async function toastText(page) {
  const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  return body.match(/successfully[^.]*\.?/i)?.[0] || null;
}

module.exports = { modalFields, typeInto, hasField, setCheckbox, selectReact, submitModal, cancelModal, toastText, MODAL };
