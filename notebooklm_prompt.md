# NotebookLM prompt — eLGU BPLS fee extraction

Paste the block under **Prompt (copy this)** into NotebookLM with the ordinance PDF as a source.

This project does **not** want NotebookLM to design eLGU calculations. It only transcribes ordinance text into grouped JSON that matches the six Tax Revenue tabs. Then:

1. Save the JSON as `_incoming_fees.json` (gitignored).
2. `node src/import-updated-fees.js` → `revenue_fees.json` (codes like `MFG-2A02-A`).
3. `npm run parse` → `elgu_config.json` (`high` / `needs_ai` / `needs_human`).
4. Human-approved dry-run / submit in training.

---

## Prompt (copy this)

```text
You extract LGU revenue-code fees from the attached Municipal Revenue Code / Tax Ordinance for encoding into eLGU BPLS → Tax Revenue.

You are a TRANSCRIBER. Not a tax lawyer. Not a programmer.
- Copy amounts, rates, mixed fractions, labels, and units EXACTLY. Never compute, round, convert %, or fill a missing table.
- If a section only cross-references another (e.g. "one-half of subsections (a), (b), and (d)"), copy that sentence. Do not substitute the referenced amounts.
- Do NOT invent eLGU calculation types (Gross Range, Options, Quantity, …), multiplier codes (bank_type, liquor_dealer_type, sqm), or encoding confidence. A downstream parser does that.

============================================================
OUTPUT — grouped JSON matching the eLGU Tax Revenue tabs
============================================================
Return ONE JSON object (not a flat array). After it, write:

Total fees extracted: N
By tab: License=a Permit=b Sanitary=c Garbage=d Fixed Fees=e Other Fees=f
SKIPPED: <section — reason>   (or "none")

Root shape:

{
  "meta": {
    "lgu": "<municipality from the ordinance, or empty>",
    "ordinance_title": "<title/year if stated>",
    "source_note": "transcribed from attached ordinance; amounts unmodified"
  },
  "groups": [
    {
      "elgu_tab": "License",
      "elgu_system_category": "License fee (Business Tax)",
      "target_page": "license",
      "fees": [ /* fee objects */ ]
    },
    {
      "elgu_tab": "Permit",
      "elgu_system_category": "Permit (Mayors permit)",
      "target_page": "permit",
      "fees": []
    },
    {
      "elgu_tab": "Sanitary",
      "elgu_system_category": "Sanitary",
      "target_page": "sanitary",
      "fees": []
    },
    {
      "elgu_tab": "Garbage",
      "elgu_system_category": "Garbage",
      "target_page": "garbage",
      "fees": []
    },
    {
      "elgu_tab": "Fixed Fees",
      "elgu_system_category": "fixed fees",
      "target_page": "new-fixed-fees",
      "fees": []
    },
    {
      "elgu_tab": "Other Fees",
      "elgu_system_category": "Other Fees",
      "target_page": "new-other-fees",
      "fees": []
    }
  ]
}

Always emit all six groups, in that order, even if a group's fees array is empty.
Never put the same ordinance section in two groups.

============================================================
ONE FEE OBJECT (inside groups[].fees)
============================================================
{
  "article_section": "MFG-2A.02(a)",
  "specific_fee_name": "<title from the ordinance>",
  "rate_structure": "<one short phrase>",
  "amount_or_formula": "<complete rate text, formatted by the rules below>",
  "business_applicable": true
}

No other keys. Do not add code, confidence, notes, calculation, or multiplier.

============================================================
HOW THE SIX TABS MAP (do not misfile)
============================================================
License     = business TAXES (manufacturers, wholesalers, retailers, contractors,
              banks, services, PUVs, peddlers, mining tax, forest, signs, newly-started).
Permit      = Mayor's permit / occupation / inspection permits (typically Article 3A–3W).
Sanitary    = sanitary inspection / health-exam fees for establishments.
Garbage     = garbage collection service charges for businesses (and related).
Fixed Fees  = one-amount-per-code service charges used in business processing
              (tax clearance, treasurer/assessor certs, police clearance if required
              as a business endorsement, general certification).
Other Fees  = remaining BPLS-relevant fees (market, slaughter, mining occupation,
              endorsements, dog license if used as other-fee BASIC, etc.).

TRAPS:
- Tax on Retailers §2A.02(d) is License (business tax). NEVER a Permit fee.
- A retailer's Mayor's Permit is the GENERIC "Mayor's Permit Fee on Business"
  §3A.01(1). Do not invent a retailer-specific permit.
- Mahjong table LICENSE fee (e.g. §3V.01) is License, not Permit.
- Building permit that only cites PD 1096 / DPWH DO still belongs in Permit,
  with amount_or_formula = the cross-reference sentence (do not invent a table).

============================================================
SCOPE — BPLS business application only
============================================================
INCLUDE only fees charged when applying for / renewing a BUSINESS permit.

EXCLUDE — list under SKIPPED, do not put in groups[].fees:
- Local Civil Registry (marriage, birth, death, legitimation, change of name)
- Impounding of animals or motor vehicles
- Secretary's / judicial copy fees
- Cemetery, public parking, pre-marriage seminars
- Special levy on lands, socialized housing tax (real property, not BPLS)
- Personal CTC on individuals unless the ordinance treats it as a business requirement
  (juridical-person community tax MAY be included under Fixed Fees)

If a schedule mixes business and personal lines (e.g. sanitary: house-for-rent PLUS
business floor-area tiers), INCLUDE the whole schedule in the matching tab.

Do NOT split one ordinance section into many JSON fees (e.g. do not emit
SEC-4C01-1, SEC-4C01-2). One section = one object. Keep the list in amount_or_formula.
A human later decides whether Fixed Fee lists become one eLGU code per item.

============================================================
article_section — mnemonic prefix REQUIRED
============================================================
Format: PREFIX-Section.Sub(id)

  2A.02(a)=MFG  (b)=WHO  (c)=EXP  (d)=RET  (e)=CON  (f)=BNK  (g)=SER  (h)=PUV
  2A.05=NEW  2D.01=PED  2E.01=AMU  2F.02=MIN  2G.02=FOR  2H.01=SIG
  3A.01(1)=BUS  (2)=BNK  (3)=LIQ  (4)=AMU  (5)=OTH  (6)=SEC
  3B.02=COC  3C.02=COC  3G.01=AMU  3L.01=AGR  3M.01=TRU  3N.01=OCC
  3W.01=HOG
  5E.02=MIN  5F.02=MIN  5G.01=SLA  5I.03=MAR
  6.02=IND  6.03=COR
  Everything else: SEC-  (SEC-3I.01, SEC-4D.01, SEC-4C.01, SEC-5B.01)

GOOD: "MFG-2A.02(a)"  "WHO-2A.02(b)"  "RET-2A.02(d)"  "BUS-3A.01(1)"
BAD:  "2A.02(a)"  "Section 2A.02(a)"  (importer would code these as 2A02-A)

============================================================
amount_or_formula — the parser will FAIL without this punctuation
============================================================
Separate clauses with "; " (semicolon + space). Every clause has exactly one colon.

1) GRADUATED BRACKETS — only these shapes:
   "Less than 10,000: 181.50 PHP"
   "10,000 to <15,000: 242.00 PHP"
   "6,500,000 or more: 41 1/4% of 1%"
Convert ordinance wording:
   "X or more but less than Y"  →  "X to <Y"
   NEVER write "or more but less than".
Keep mixed fractions and "% of 1%" verbatim. Do not convert 41 1/4% of 1% to a decimal.
Keep "(minimum tax P12,650.00)" on the top-bracket value.

2) TWO-TIER PERCENT (retailers):
   "2.4% per annum on P400,000.00 or less; 1.2% per annum on excess over P400,000.00"

3) EXCESS CLAUSE as its own last clause:
   "For every 5,000 in excess of 30,000: 15.00 PHP"

4) ENUMERATED LIST (keep human labels; do NOT invent snake_case codes):
   "Rural, Thrift and Savings Banks: 220.00 PHP; Commercial, Industrial and Development Banks: 330.00 PHP; Universal Banks/Insurance company: 220.00 PHP; Pawnshops/Money shops/Lending Investor: 440.00 PHP"

5) SINGLE FLAT:
   "120.00 PHP per annum"
   "150.00 PHP/per day"
   "25.00 PHP/per dog"

6) CROSS-REFERENCE:
   "One-half (1/2) of the rates prescribed under subsections (a), (b), and (d)"

============================================================
GOLD EXAMPLES (put these in the matching group)
============================================================
License / Manufacturers — article_section "MFG-2A.02(a)":
"Less than 10,000: 181.50 PHP; 10,000 to <15,000: 242.00 PHP; 15,000 to <20,000: 332.00 PHP; 6,500,000 or more: 41 1/4% of 1%"
(full table: every bracket; this is abbreviated)

License / Retailers — "RET-2A.02(d)"  [NOT Permit]:
"2.4% per annum on P400,000.00 or less; 1.2% per annum on excess over P400,000.00"

Permit / Mayor's Permit on Business — "BUS-3A.01(1)"  [generic, all lines including retailers]:
"Less than 5,000: 30.00 PHP; 5,000 to <10,000: 60.00 PHP; 10,000 to <20,000: 120.00 PHP; 20,000 to <30,000: 200.00 PHP; For every 5,000 in excess of 30,000: 15.00 PHP"

Permit / Banks — "BNK-3A.01(2)":
"Rural, Thrift and Savings Banks: 220.00 PHP; Commercial, Industrial and Development Banks: 330.00 PHP; Universal Banks/Insurance company: 220.00 PHP; Pawnshops/Money shops/Lending Investor: 440.00 PHP"

If 3A.01(5) is an enumerated list and 3A.01(6) is the catch-all, keep (5) as the list and (6) as a single flat ("120.00 PHP per annum") unless the ordinance clearly gives (6) its own distinct schedule.

============================================================
WORK ORDER
============================================================
1. Walk the ordinance article by article.
2. Assign each fee-bearing section to exactly one of the six tabs.
3. Format amount_or_formula using the rules above.
4. Emit the grouped JSON, then the three summary lines.
No markdown commentary before the JSON.
```

---

## After NotebookLM replies

Save the JSON object as `_incoming_fees.json`, then:

```bash
node src/import-updated-fees.js
npm run parse
```

`import-updated-fees.js` accepts either this grouped `{ groups: [...] }` shape or a legacy flat array.
