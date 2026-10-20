/**
 * Audit mode v1 — re-read created fees from the live API (same capture pattern
 * as the verified verify-all-samples.js) and diff against elgu_config.json.
 * Read-only: expands fees and records API responses; never submits anything.
 */
const fs = require('fs');
const path = require('path');
const { launch, gotoSection, expandFee, BASE_URL } = require('../executor/browser');
const { diffConfig } = require('./diff');

const ROOT = path.join(__dirname, '..', '..');

/** page slug → tax_revenue_type_id observed in list URLs (1=license,2=permit,3=sanitary,4=garbage). */
const PAGE_TYPE_ID = { license: 1, permit: 2, sanitary: 3, garbage: 4 };

/**
 * Capture the live state for the given configs. Groups by page, reloads each
 * page once per fee so expansion fetches are deterministic.
 */
async function captureLive(page, api, configs) {
  const live = {};
  const taxByPage = {};
  for (const c of configs) {
    if (c.kind === 'tax_revenue') (taxByPage[c.target_page] ||= []).push(c);
    else live[c.code] = await readSimpleFee(page, api, c);
  }
  for (const [slug, pageConfigs] of Object.entries(taxByPage)) {
    for (const c of pageConfigs) {
      api.length = 0;
      await gotoSection(page, slug);
      const list = api.find((a) => /tax_revenues\?/.test(a.url));
      const item = (list?.body?.data || []).find((d) => d.attributes.code === c.code);
      if (!item) { live[c.code] = { found: false }; continue; }
      api.length = 0;
      await expandFee(page, c.code);
      const calcEntry = api.find((a) => a.url.includes(`tax_revenues/${item.id}/calculations?`));
      const calculations = (calcEntry?.body?.data || []).map((calc) => {
        const includedRows = (calcEntry.body.included || [])
          .filter((i) => i.type.startsWith('bpls_tax_revenue_calculation_') && !i.type.includes('calculation_types'));
        // Details arrive via included rows; group by matching detail endpoints when present.
        const detailUrls = api.filter((a) => a.url.includes(`/calculations/${calc.id}/details`));
        const details = detailUrls.length
          ? [...new Map(detailUrls.flatMap((a) => (Array.isArray(a.body?.data) ? a.body.data : [a.body?.data]).filter(Boolean).map((d) => [JSON.stringify(d.attributes), d.attributes])).values()).map(([, v]) => v)]
          : includedRows.map((i) => i.attributes);
        return {
          type: calc.attributes.type,
          label: calc.attributes.label,
          multiplier: calc.attributes.multiplier,
          for_new: calc.attributes.for_new,
          for_renewal: calc.attributes.for_renewal,
          for_retirement: calc.attributes.for_retirement,
          details,
        };
      });
      live[c.code] = {
        found: true,
        attrs: item.attributes,
        revision: item.relationships?.revision?.data?.id ?? null,
        calculations,
      };
    }
  }
  return live;
}

async function readSimpleFee(page, api, config) {
  api.length = 0;
  await gotoSection(page, config.target_page);
  const list = api.find((a) => /(fixed_fees|other_fees)\?/.test(a.url));
  const item = (list?.body?.data || []).find((d) => d.attributes.code === config.code);
  return item ? { found: true, attrs: item.attributes } : { found: false };
}

/**
 * Run the audit for selected configs (or all usable ones). Writes
 * logs/audit-<ts>.json and returns the report.
 */
async function runAudit({ configs, headless = false, onEvent = () => {} }) {
  const usable = configs.filter((c) => c.confidence !== 'needs_human' && (c.calculation || c.amount !== undefined));
  const { context, page, api } = await launch({ headless });
  const report = { started_at: new Date().toISOString(), base_url: BASE_URL, results: [], summary: {} };
  try {
    onEvent({ type: 'info', message: `auditing ${usable.length} configs on ${BASE_URL}` });
    const live = await captureLive(page, api, usable);
    for (const c of usable) {
      const res = diffConfig(c, live[c.code]);
      report.results.push(res);
      onEvent({ type: 'result', code: c.code, verdict: res.verdict });
    }
  } finally {
    await context.close().catch(() => {});
  }
  report.summary = {
    total: report.results.length,
    pass: report.results.filter((r) => r.verdict === 'PASS').length,
    partial: report.results.filter((r) => r.verdict === 'PARTIAL').length,
    fail: report.results.filter((r) => r.verdict === 'FAIL').length,
  };
  report.finished_at = new Date().toISOString();
  fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
  const out = path.join(ROOT, 'logs', `audit-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
  report.log_file = out;
  return report;
}

module.exports = { runAudit, captureLive, PAGE_TYPE_ID };
