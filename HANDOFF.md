# Handoff — ELGU Prosetup

Continue from here on any machine after cloning:

`https://github.com/jaymarrecolizado-tech/elgu-prosetup`

Same Cursor account does **not** sync Agent chat history. Open this file in a new chat and say: *continue from HANDOFF.md*.

---

## Goal

Automate configuring LGU revenue fees into eLGU BPLS **Tax Revenue** (License / Permit / Sanitary / Garbage / Fixed Fees / Other Fees), driven by `revenue_fees.json`, with DOM helpers portable later to a Chrome Extension.

Training app used for samples:

- UI: `https://elgu-r2-training-core.oueg.info`
- API: `https://elgu-r2-training-ws.oueg.info/api/v1/bpls/administrator/...`
- Active ordinance UI filter: revision id `2` (“2026 Ordinance”, YEAR 2026–2027)

---

## Done

1. **Toolchain:** RTK, Graphify (project rule), Kodelyth ECC (Cursor project install). Prefer English ECC rules if reinstall overwrites with Chinese.
2. **Playwright scaffold:** persistent Chromium profile at `.auth/chrome-profile` (local only — **never commit**). Login once via `npm run browser:login` / `src/spawn-login-browser.js`.
3. **System model observed (API + UI):**
   - Tax revenues (types 1–4): code + description → **Calculations** → detail rows (ranges / rate / options / quantity / excess / fixed amount).
   - Fixed Fees / Other Fees: separate endpoints (`tax_revenue/fixed_fees`, `tax_revenue/other_fees`).
4. **Verified SAMPLE entries** live in training (API-checked). Report: `elgu_sample_verification.json`, audit dump: `elgu_sample_audit.json`.
5. **`revenue_fees.json` updated** (65 fees) with production-style codes, e.g. `MFG-2A.02(a)` → code `MFG-2A02-A`. Importer: `src/import-updated-fees.js`.
6. **Repo pushed** (secrets excluded): `main` @ GitHub.

### Sample patterns proven (by calculation type)

| Type | Example SAMPLE code | Source |
|------|---------------------|--------|
| Gross Range (graduated amounts) | LICENSE-SAMPLE-S2A02-A | §2A.02(a) |
| Gross Range (rate tiers) | LICENSE-SAMPLE-S2A02-D | §2A.02(d) |
| Gross Rate | LICENSE-SAMPLE-S2A02-F | §2A.02(f) |
| Capital Range | PERMIT-SAMPLE-S3A01-1C | §3A.01(1) |
| Gross Excess | PERMIT-SAMPLE-S3A01-1X | §3A.01(1) excess |
| Options | PERMIT-SAMPLE-S3A01-2 | §3A.01(2) banks |
| Other Range (sqm) | SANITARY-SAMPLE-S4D01 | §4D.01 |
| Quantity | PERMIT-SAMPLE-S3G01 | §3G.01 |
| Fixed Amount | PERMIT-SAMPLE-S3A01-6, SANITARY-SAMPLE-S4F01, GARBAGE-SAMPLE-S5B01 | flat fees |
| Fixed Fee page | FIXED-SAMPLE-S4H01 | §4H.01 |
| Other Fee BASIC | OTHER-SAMPLE-S3X01 | §3X.01 |

**PARTIAL (not full ordinance):** Garbage SAMPLE = one tier (₱420) only; Sanitary dog / Other dog = amount OK but “per dog” not encoded unless Quantity.

---

## Critical automation lessons

1. Creating a Calculation **auto-creates a placeholder detail** (e.g. `0–1000` / `option` / `quantity`). **Edit** that row first, then Add the rest.
2. **Masked amount fields (`₱`)** and some code fields only save reliably with **keyboard typing** (`pressSequentially`), not `fill` / native setter — especially on **Update** modals.
3. **Options / Other Range** need a Multiplier **code** when creating the calculation (`bank_type` → label “Bank Type”, `sqm` → “Sqm Range”). Option detail multipliers must be code-style (`rural_thrift_savings_banks`), not display labels.
4. **Gross Excess** fields are `in_excess_of`, `for_every`, `amount` — **no rate field**.
5. Table rows often include an empty spacer `<tr>` — target `tr:has(button)` for edit/delete.
6. After Submit, detail panels may collapse — re-expand the fee item before the next Add.

---

## Secrets / local-only (never commit or copy to GitHub)

| Path | Why |
|------|-----|
| `.env` | Login URL / env secrets |
| `.auth/` | Browser cookies / logged-in profile |
| `session-*.json`, `browser-status.json` | Live page dumps |
| `node_modules/`, `graphify-out/`, `.cursor/` | Local tooling |
| `_incoming_fees.json`, `elgu_fee_type_samples.json` | Scratch / large dumps |

Safe to commit: `revenue_fees.json`, `elgu_sample*.json`, `src/`, `package.json`, `.env.example`, this handoff.

On the laptop after clone:

```bash
npm install
copy .env.example .env   # set ELGU_LOGIN_URL
# Windows: set PLAYWRIGHT_BROWSERS_PATH=%LOCALAPPDATA%\ms-playwright
npm run browser:login    # log in manually; profile saved under .auth/
```

---

## Next work (recommended order)

1. **Confirm** target ordinance revision for real data (training default is id `2`; Maddela revisions 3/4 also exist — avoid colliding with seed codes).
2. **Build modular runner** (dry-run first: fill → Cancel, no Submit):
   - Parse `revenue_fees.json` → typed config (Gross Range / Rate / Options / Other Range / Quantity / Excess / Fixed / Other Fee).
   - Use `code` field from JSON (e.g. `MFG-2A02-A`), description = `specific_fee_name`.
   - Per-fee log: success / fail / skip.
   - Fold one-off scripts (`fix-fee-type-details*.js`, `make-*.js`) into `src/form/` + `src/run-configure-fees.js`.
3. **Expand PARTIAL fees** (Garbage §5B.01, multi-tier Fixed/Other) into Options / Other Range rows, not one flat amount.
4. Only after dry-run OK: Submit mode with explicit user confirmation.
5. Later: Chrome Extension port of `src/form/domInject.js`.

---

## Useful commands

```bash
npm run browser:login
npm run fees:configure          # scaffold — not full 65 yet
node src/import-updated-fees.js # regenerate revenue_fees.json from _incoming_fees.json
node src/verify-all-samples.js  # API audit of SAMPLE-* records (needs .auth login)
```

Project rule: run `graphify query "..."` before broad codebase exploration; `graphify update .` after code changes.

---

## Open questions for the human

1. Top bracket “41¼% of 1%”: keep base+excess (as SAMPLE-S2A02-A) or pure % of gross?
2. With Essential Rate flag for exporters / essential commodities (§2A.02(c))?
3. Production codes: use sanitized `code` as-is (`MFG-2A02-A`), or keep punctuation in UI?
4. Delete training `SAMPLE-*` records before loading real codes?

---

*Last updated for handoff after revenue_fees code update (65 fees) and GitHub push.*
