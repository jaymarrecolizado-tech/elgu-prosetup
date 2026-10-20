# Handoff — ELGU Prosetup

Continue from here on any machine after cloning:

`https://github.com/jaymarrecolizado-tech/elgu-prosetup`

Open this file in a new chat and say: *continue from HANDOFF.md*.

---

## Goal

Automate configuring LGU revenue fees into eLGU BPLS **Tax Revenue** (License / Permit / Sanitary / Garbage / Fixed Fees / Other Fees), driven by `revenue_fees.json`, human-approved before any submit. Follow `PLAN.md` (Plan#1–Plan#5).

Training app used for samples:

- UI: `https://elgu-r2-training-core.oueg.info`
- API: `https://elgu-r2-training-ws.oueg.info/api/v1/bpls/administrator/...`
- Active ordinance UI filter: revision id `2` (“2026 Ordinance”, YEAR 2026–2027); revisions 1 (2019), 3 (2027), 4 (2028) also exist.

---

## Plan status (verified 2026-10-21 by inspection + tests)

| Plan | Status | Evidence |
|------|--------|----------|
| Plan#1 Consolidate | ✅ **Complete** | `src/parser/`, `src/executor/`, `scripts/archive/`; `npm test` = **34 pass / 0 fail** |
| Plan#2 Runner + web UI + audit | 🟡 **Code complete; live acceptance incomplete** | `elgu_config.json` (65: 19 high / 22 needs_ai / 24 needs_human); web UI serves HTTP 200 at 127.0.0.1:8765; audit diff regression-tested vs 13 samples. Tax-revenue dry-run 33/41 passed. **Fixed/Other Fees dry-run still failing** (react-select / fill errors, see `logs/`); **5-fee submit + audit not yet done** |
| Plan#3 AI assist (Ollama) | ❌ Not started | No `src/ai/`, no Ollama integration, no Excel import |
| Plan#4 Chrome extension | ❌ Not started | No `extension/` directory |
| Plan#5 Fine-tune | ❌ Not started (also gated on Plan#3) | No `training/` directory |

> **Do not claim Plan#2–#5 are "done" from code presence alone.** Plan#2 acceptance still requires: Fixed/Other dry-run green, then a 5-fee **submit** in training followed by audit PASS.
>
> ⚠️ **Uncommitted WIP:** `src/executor/{browser,modal,runner,simpleFees,taxRevenue}.js` have uncommitted debugging changes (fill vs typing split, react-select retry, fresh-reload for Fixed/Other pages, login guard). Latest local logs still show errors on Other Fees, so this WIP was **left uncommitted** — review/fix before committing. Committed code is at the Plan#2 commit.

## Done

1. **Plan#1 (consolidate) — COMPLETE.** Deterministic parser in `src/parser/`
   (§5 rules: graduated brackets, `% of 1%` top brackets, excess clauses,
   retailer two-tier, sqm tiers, options lists, flats), executor helpers in
   `src/executor/` (typing §7.2, placeholder-edit §7.1, multiplier codes §7.3,
   toast verification §7.6), one-off probes archived to `scripts/archive/`.
   `npm test` → 34 tests green (parser + audit-diff vs the 13 verified samples).
2. **Plan#2 (runner + web UI) — CODE COMPLETE, live acceptance pending (see status table).**
   - `npm run parse` → `elgu_config.json` (65 fees: **19 high / 22 needs_ai / 24 needs_human**, report embedded).
   - `npm run fees:configure -- --dry-run` / `--submit --revision N` (CLI types `SUBMIT` to confirm); idempotent skip-if-exists; per-run log `logs/run-*.json` (gitignored).
   - **Web UI:** `npm run app` → http://127.0.0.1:8765 — preview table (editable details), revision selector (required for submit), dry-run/submit (typed `SUBMIT` confirmation dialog)/audit buttons, live log.
   - **Audit mode v1:** `npm run audit [-- --codes A,B]` re-reads live config via API capture and diffs PASS/PARTIAL/FAIL (regression-tested against `elgu_sample_audit.json`: all 13 verified samples reproduce their verdicts).
3. Prior work: Playwright scaffold + persistent profile (`.auth/chrome-profile`), 13 verified SAMPLE fees (report: `elgu_sample_verification.json`), `revenue_fees.json` (65 fees, sanitized codes), repo on GitHub `main`.

## What is NOT done yet (needs the human / next session)

- **Finish Plan#2 acceptance:** fix Fixed/Other Fees dry-run (start from the uncommitted WIP + latest `logs/run-*.json` errors), re-run dry-run, then 5-fee submit in training + audit PASS. Requires manual login (`.env` + `npm run browser:login`).
- Plan#3 (Ollama AI assist), Plan#4 (Chrome extension), Plan#5 (fine-tune) — not started.

---

## How to run (after clone)

```bash
npm install
copy .env.example .env        # set ELGU_LOGIN_URL
npm test                      # 34 tests
npm run parse                 # revenue_fees.json → elgu_config.json
npm run browser:login         # manual login once; profile saved under .auth/
npm run app                   # open http://127.0.0.1:8765
# pick revision → select fees → Dry-run → review log → Submit (types SUBMIT) → Audit
```

CLI equivalents:

```bash
node src/run-configure-fees.js --dry-run                       # all high-confidence
node src/run-configure-fees.js --dry-run --codes MFG-2A02-A,RET-2A02-D
node src/run-configure-fees.js --submit --revision 2 --codes ...   # types SUBMIT to confirm
node src/audit/cli.js --codes MFG-2A02-A,RET-2A02-D,BNK-3A01-2
```

---

## Architecture (post-Plan#2)

| Path | Role |
|------|------|
| `src/parser/` | Deterministic §5 rules → `elgu_config.json` (`index.js` orchestrates; `graduated.js`, `lists.js`, `formulas.js`, `classify.js`, `sanitize.js`, `validate.js`) |
| `src/executor/` | `browser.js` (persistent profile + API capture), `modal.js` (typed input §7.2), `details.js` (placeholder edit §7.1), `taxRevenue.js`, `simpleFees.js`, `runner.js` (dry-run/submit, revision check, run logs) |
| `src/audit/` | `diff.js` (pure PASS/PARTIAL/FAIL engine), `audit.js` (live API re-read), `cli.js` |
| `src/server/` + `public/` | localhost web UI (127.0.0.1:8765), no framework |
| `elgu_config.json` | The §5 contract between parser/UI/executor/audit (committed) |
| `logs/` | Run + audit logs (gitignored) |
| `scripts/archive/` | Old one-off probes (reference only) |

Confidence levels: `high` (deterministic, verified pattern) · `needs_ai`
(parseable but a choice is unproven — multiplier dimension, plain-`%` top
bracket, fixed-fee list split) · `needs_human` (multi-concept/external
reference — parser refuses to guess).

### API facts learned (beyond earlier lessons)

- Tax-revenue list URLs: `.../tax_revenues?q=&sort_by=desc&tax_revenue_type_id=<1-4>&ordinance_revision_id=<n>` (1=license, 2=permit, 3=sanitary, 4=garbage).
- Calc internal types: Gross/Capital Range=`AMOUNT_RANGE` (multiplier `gross_amount`/`capital_amount`), Gross/Capital Rate=`BASIC`, Gross Excess=`EXCESS`, Options=`OPTION`, Other Range=`OTHER_RANGE` (multiplier `sqm`), Quantity=`QUANTITY` (calc multiplier **null**; detail row carries `multiplier:"quantity"`), Fixed Amount=`FIXED_AMOUNT`.
- Live API shows `for_retirement=1` even when the creation checkbox was unchecked — parser defaults all three flags true.
- Ordinance revisions API: `bpls_ordinance_revisions` (ids 1–4 in training).

---

## Critical automation lessons (still enforced in `src/executor/`)

1. Creating a Calculation **auto-creates a placeholder detail** — **Edit** row 1, then Add the rest.
2. **fill() vs typing:** Add/Create modals tolerate `fill()` (`fillInto`); Update/Edit modals (masked ₱ fields) silently revert unless keyboard-typed (`typeInto`). Applying typing everywhere made the Other Fee Add form's typed code revert to empty on blur.
3. Options/Other Range need a **multiplier code at creation** (`bank_type`/`sqm` proven; others unverified → parser flags `needs_ai`).
4. Option detail multipliers must be **code-style** (`rural_thrift_savings_banks`).
5. Detail rows: target `tr:has(button)`; **never click delete**.
6. Verify via toast after every submit; Escape lingering modals on error.
7. React-Select: `input[id^="react-select"]` inside the open modal, plus:
   - pick options via `[class*="-option"]` (emotion classes), never `getByText` (list rows contain look-alike text like `<b>BASIC</b>`);
   - after a selection the modal remounts its selects (Other Fee grows an "Endorsing Office" search) — target by control placeholder (`{ controlText: 'Select Fee Type' }`), never a saved index;
   - §5 code-style values must be spaced for UI text (`COMMON_FEE` → "COMMON FEE");
   - a prior tax-revenue page visit leaves SPA select state stale — `gotoSection(slug, { fresh: true })` (reload) before Fixed/Other Fee pages.
8. `networkidle` + settle delay after every navigation/submit.
9. **Modal selector composition:** never interpolate `'.modal.show, [role=dialog]'` into `${MODAL} input[name=x]` — the bare `.modal.show` alternative matches the modal div itself and `.first()` targets the div (fields silently receive no input). All helpers use `:is(.modal.show, [role=dialog])`.
10. Keep the persistent profile: `.auth/chrome-profile`; never commit `.auth/`.

## Dry-run status (2026-10-21, training app)

Full sweep of all runnable configs: **41 → 36 dry_run (fill+cancel, zero
submits) + 5 refused (fixed-fee lists awaiting human split) + 0 errors**.
Verified via API afterwards that no records were created. The 24 `needs_human`
fees never reach the executor. Submit of a 5-fee subset (Plan#2 acceptance)
awaits the human: `npm run app` → pick revision → select fees → Submit (types
SUBMIT).

---

## Secrets / local-only (never commit)

`.env`, `.auth/`, `session-*.json`, `browser-status.json`, `node_modules/`,
`graphify-out/`, `.cursor/`, `_incoming_fees.json`, `elgu_fee_type_samples.json`,
`logs/`, `_tmp_*` — all in `.gitignore`.

---

## Open questions for the human (unchanged from PLAN §12)

1. Top bracket “41¼% of 1%”: keep base+excess (current) or pure % of gross?
2. `with_essential_computation` for §2A.02(c) essential commodities?
3. Production target ordinance revision id (training default `2`)?
4. Delete training `SAMPLE-*` records before real loads?
5. First real input beyond JSON: Excel or ordinance PDF?

---

*Last updated 2026-10-21 — verified: Plan#1 complete; Plan#2 code complete (live Fixed/Other + submit acceptance pending, uncommitted executor WIP); Plan#3–#5 not started.*
