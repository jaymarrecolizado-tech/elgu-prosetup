/**
 * Modal form helpers — consolidated from the proven sample scripts.
 * Implements the hard-won PLAN §7 lessons:
 *   §7.2 Add forms tolerate fill(); Update/Edit modals (masked ₱ fields) only
 *        persist with real keyboard typing (pressSequentially)
 *   §7.6 verify via toast after every submit; Escape lingers away
 *   §7.7 React-Select fields have no name — target input[id^="react-select"]
 * NOTE: modal scoping uses :is(.modal.show, [role=dialog]) — interpolating a
 * comma-separated list into a descendant selector accidentally targets the
 * modal <div> itself (learned the hard way: fields silently never received
 * input).
 */

const MODAL_SCOPE = ':is(.modal.show, [role=dialog])';

/** Dump the open modal's fields (recon/debug aid; cheap and non-invasive). */
async function modalFields(page) {
  return page.evaluate(() => {
    const m = document.querySelector('.modal.show, [role=dialog]');
    if (!m) return null;
    const labelFor = (el) => el.closest('.form-group,div')?.querySelector('label')?.innerText.trim() || null;
    return {
      title: (m.querySelector('.modal-title,h4,h5')?.innerText || '').trim(),
      fields: [...m.querySelectorAll('input,select,textarea')]
        .filter((e) => e.type !== 'hidden')
        .map((e) => ({ type: e.type, name: e.name || null, id: e.id || null, label: labelFor(e), value: e.value })),
    };
  });
}

/**
 * Type a value into a named field inside the open modal using real keyboard
 * events (select-all → backspace → pressSequentially → Tab). Required on
 * Update/Edit modals where fill() silently reverts to 0.
 */
async function typeInto(page, name, value) {
  const loc = page.locator(`${MODAL_SCOPE} [name="${name}"]`);
  if (!(await loc.count())) throw new Error(`field "${name}" not found in modal`);
  await loc.first().click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await loc.first().pressSequentially(String(value), { delay: 5 });
  await page.keyboard.press('Tab');
}

/**
 * Fill a named field in an OPEN (Add/Create) modal with locator.fill().
 * Evidence split: Add forms tolerate fill(); Update modals revert — use
 * typeInto() on edit paths.
 */
async function fillInto(page, name, value) {
  const loc = page.locator(`${MODAL_SCOPE} input[name="${name}"], ${MODAL_SCOPE} textarea[name="${name}"]`);
  if (!(await loc.count())) throw new Error(`field "${name}" not found in modal`);
  await loc.first().fill(String(value));
}

async function hasField(page, name) {
  return (await page.locator(`${MODAL_SCOPE} [name="${name}"]`).count()) > 0;
}

/** Set a checkbox in the open modal to the wanted state. */
async function setCheckbox(page, name, want) {
  const cb = page.locator(`${MODAL_SCOPE} input[type="checkbox"][name="${name}"]`);
  if (!(await cb.count())) return false;
  if (want && !(await cb.isChecked())) await cb.first().check({ force: true });
  if (!want && (await cb.first().isChecked())) await cb.first().uncheck({ force: true });
  return true;
}

/** Click a named action button once; retry after a settle if the SPA stalled. */
async function clickAction(page, nameRe, { timeout = 15_000 } = {}) {
  const btn = page.getByRole('button', { name: nameRe }).first();
  try {
    await btn.click({ timeout });
  } catch {
    await page.waitForTimeout(1500);
    await btn.click({ timeout });
  }
}

/**
 * Pick an option in a React-Select control by its exact visible text (§7.7).
 * `which` is a 0-based input index, 'last', or { controlText } to target the
 * select whose control placeholder matches (modal selects remount and indices
 * go stale — e.g. the Other Fee modal grows an "Endorsing Office" search
 * after the type is picked).
 */
async function selectReact(page, optionText, which = 0) {
  let input;
  if (typeof which === 'object' && which.controlText) {
    const ctrl = page.locator(`${MODAL_SCOPE} [class*="-control"]`).filter({ hasText: which.controlText }).first();
    input = ctrl.locator('input[id^="react-select"]');
  } else {
    const inputs = page.locator(`${MODAL_SCOPE} input[id^="react-select"]`);
    input = which === 'last' ? inputs.last() : inputs.nth(which);
  }
  if (!(await input.count())) throw new Error(`react-select "${typeof which === 'object' ? which.controlText : which}" not found in modal`);
  // Open the menu and wait for its options. The modal re-renders while field
  // validation settles, which can swallow a click — blur, wait, and retry.
  let menuOpen = false;
  for (let attempt = 0; attempt < 4 && !menuOpen; attempt++) {
    await input.click({ force: true });
    await page.waitForTimeout(400 + attempt * 400);
    menuOpen = (await page.locator('[class*="-option"]:visible').count()) > 0;
    if (!menuOpen) {
      await page.locator(`${MODAL_SCOPE} .modal-title, ${MODAL_SCOPE} h4, ${MODAL_SCOPE} h5`).first().click({ timeout: 2_000 }).catch(() => {});
    }
  }
  if (!menuOpen) throw new Error(`react-select menu did not open for "${optionText}"`);
  const escaped = String(optionText).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const option = page
    .locator('[class*="-option"]')
    .filter({ hasText: new RegExp(`^\\s*${escaped}\\s*$`) })
    .first();
  await option.click({ timeout: 5_000 });
  await page.waitForTimeout(400);
}

/**
 * Submit the open modal. Returns the captured success toast text (or null) —
 * callers must treat a missing toast as a failure (PLAN §7.6/§7.8).
 */
async function submitModal(page) {
  await page.locator(`${MODAL_SCOPE} button:has-text("Submit")`).first().click({ timeout: 10_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(800);
  return toastText(page);
}

/** Dry-run counterpart: cancel the modal without submitting anything. */
async function cancelModal(page) {
  const cancel = page.locator(`${MODAL_SCOPE} button:has-text("Cancel"), ${MODAL_SCOPE} button:has-text("Close")`).first();
  if (await cancel.count()) await cancel.click({ timeout: 5_000 }).catch(() => {});
  else await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);
}

/** Last "successfully …" toast on the page, if any. */
async function toastText(page) {
  const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  return body.match(/successfully[^.]*\.?/i)?.[0] || null;
}

module.exports = { modalFields, typeInto, fillInto, hasField, setCheckbox, clickAction, selectReact, submitModal, cancelModal, toastText, MODAL_SCOPE };
