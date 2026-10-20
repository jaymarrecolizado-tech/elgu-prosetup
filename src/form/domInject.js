/**
 * Portable DOM value-injection helpers.
 *
 * Design goal: these functions use only browser-native DOM APIs so they can
 * later move into a Chrome Extension (MV3) content script with minimal changes.
 *
 * Playwright wrappers will call these via page.evaluate(...) so the same
 * logic runs inside the real page context.
 *
 * NOTE: Steps 3–4 will expand this module (dropdowns, modals, submit).
 * For Steps 1–2 we only need the scaffold.
 */

/**
 * Set a text / number input value and fire the events legacy apps listen for.
 * @param {HTMLInputElement|HTMLTextAreaElement} el
 * @param {string|number} value
 */
function setNativeInputValue(el, value) {
  if (!el) throw new Error('setNativeInputValue: element is null');

  const proto =
    el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;

  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  if (descriptor && descriptor.set) {
    descriptor.set.call(el, String(value));
  } else {
    el.value = String(value);
  }

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
}

/**
 * Select an <option> by visible label or value attribute.
 * @param {HTMLSelectElement} selectEl
 * @param {string} optionTextOrValue
 */
function setNativeSelectValue(selectEl, optionTextOrValue) {
  if (!selectEl) throw new Error('setNativeSelectValue: element is null');

  const needle = String(optionTextOrValue).trim().toLowerCase();
  const options = Array.from(selectEl.options);
  const match =
    options.find((o) => o.value.toLowerCase() === needle) ||
    options.find((o) => o.textContent.trim().toLowerCase() === needle) ||
    options.find((o) => o.textContent.trim().toLowerCase().includes(needle));

  if (!match) {
    throw new Error(`setNativeSelectValue: no option matched "${optionTextOrValue}"`);
  }

  selectEl.value = match.value;
  selectEl.dispatchEvent(new Event('input', { bubbles: true }));
  selectEl.dispatchEvent(new Event('change', { bubbles: true }));
}

module.exports = {
  setNativeInputValue,
  setNativeSelectValue,
};
