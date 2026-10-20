/* ELGU Fee Setup Assistant — plain JS, no build step (PLAN §6 Plan#2). */
const $ = (s) => document.querySelector(s);
let configs = [];
let audits = {}; // code -> verdict (latest audit job result)

async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

async function loadState() {
  const st = await api('/api/state');
  configs = st.configs;
  renderReport(st.report);
  renderTable();
  if (st.job) renderJob(st.job);
}

function renderReport(report) {
  const c = report.by_confidence;
  $('#report').innerHTML = `
    <span class="pill">fees <b>${report.source_count}</b></span>
    <span class="pill">high <b>${c.high}</b></span>
    <span class="pill">needs_ai <b>${c.needs_ai}</b></span>
    <span class="pill">needs_human <b>${c.needs_human}</b></span>
    <span class="pill">set errors <b>${(report.set_errors || []).length}</b></span>`;
}

function selectedCodes() {
  return [...document.querySelectorAll('#fees tbody input.code-check:checked')].map((i) => i.value);
}

function summaryLine(c) {
  const calc = c.calculation;
  if (!calc) return c.amount !== undefined ? `amount ${c.amount}` : '—';
  const bits = [];
  if (calc.multiplier_code) bits.push(calc.multiplier_code);
  bits.push(`${calc.details.length} detail${calc.details.length === 1 ? '' : 's'}`);
  return bits.join(' · ');
}

function renderTable() {
  const q = $('#filter').value.trim().toLowerCase();
  const onlyHigh = $('#only-high').checked;
  const tbody = $('#fees tbody');
  tbody.innerHTML = '';
  for (const c of configs) {
    if (q && !`${c.code} ${c.description} ${c.calculation?.type || ''}`.toLowerCase().includes(q)) continue;
    if (onlyHigh && c.confidence !== 'high') continue;
    const tr = document.createElement('tr');
    const audited = audits[c.code];
    tr.innerHTML = `
      <td><input type="checkbox" class="code-check" value="${c.code}" ${c.confidence === 'needs_human' ? 'disabled' : ''}></td>
      <td><code>${c.code}</code>${c._edited ? ' <span class="small" title="human-edited">✎</span>' : ''}</td>
      <td class="small">${c.target_page}</td>
      <td>${c.description}${c.notes?.length ? ` <span class="notes" title="${esc(c.notes.join('\n'))}">⚠ ${c.notes.length}</span>` : ''}</td>
      <td>${c.calculation ? `${c.calculation.type}` : '—'}</td>
      <td class="small">${summaryLine(c)}</td>
      <td><span class="conf ${c.confidence}">${c.confidence}</span></td>
      <td>${audited ? `<span class="verdict ${audited}" title="${esc(audits[c.code + ':detail'] || '')}">${audited}</span>` : '<span class="small">—</span>'}</td>`;
    tbody.appendChild(tr);

    // Expandable editor for the calculation details (amount/rate editable).
    const det = c.calculation?.details?.length ? c.calculation : null;
    if (det) {
      const row = document.createElement('tr');
      row.className = 'detail-row';
      row.style.display = 'none';
      const fields = det.details.map((d, i) => detailEditor(det.type, d, i)).join('');
      row.innerHTML = `<td></td><td colspan="7">
        <div class="edit"><span class="small">${esc(c.source.amount_or_formula).slice(0, 220)}</span>
        <table>${fields ? `<thead><tr>${detailHeader(det.type)}</tr></thead><tbody>${fields}</tbody>` : ''}</table>
        <button class="linkish" data-code="${c.code}">save edits</button></div></td>`;
      tbody.appendChild(row);
      tr.addEventListener('click', (e) => {
        if (e.target.closest('input')) return;
        row.style.display = row.style.display === 'none' ? '' : 'none';
      });
      row.querySelector('button').addEventListener('click', () => saveConfig(c.code, row));
    }
  }
  refreshButtons();
}

function detailHeader(type) {
  const cols = { range: ['from', 'to', 'amount', 'rate', 'excess'], other: ['from', 'to', 'amount'], basic: ['amount', 'rate'], option: ['multiplier', 'amount'], excess: ['in_excess_of', 'for_every', 'amount'], single: ['amount'] };
  const set = /Other Range/.test(type) ? cols.other : /Options/.test(type) ? cols.option : /Excess/.test(type) ? cols.excess : /Rate/.test(type) ? cols.basic : /Range/.test(type) ? cols.range : cols.single;
  return set.map((h) => `<th>${h}</th>`).join('');
}

function detailEditor(type, d, i) {
  const cell = (k) => `<td><input data-k="${k}" data-i="${i}" value="${d[k] ?? ''}" ${typeof d[k] === 'boolean' ? 'type="checkbox"' : ''} ${d[k] === true ? 'checked' : ''}></td>`;
  if (/Other Range/.test(type)) return cell('from') + cell('to') + cell('amount');
  if (/Options/.test(type)) return cell('multiplier') + cell('amount');
  if (/Excess/.test(type)) return cell('in_excess_of') + cell('for_every') + cell('amount');
  if (/Rate/.test(type)) return cell('amount') + cell('rate');
  if (/Range/.test(type)) return cell('from') + cell('to') + cell('amount') + cell('rate') + cell('for_excess_computation');
  return cell('amount');
}

async function saveConfig(code, row) {
  const c = configs.find((x) => x.code === code);
  const calc = c.calculation;
  for (const input of row.querySelectorAll('input[data-k]')) {
    const k = input.dataset.k;
    const i = Number(input.dataset.i);
    let v = input.type === 'checkbox' ? input.checked : input.value;
    if (input.type !== 'checkbox' && k !== 'multiplier' && v !== '') v = Number(v);
    calc.details[i][k] = v;
  }
  c._edited = true;
  await api('/api/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(c) });
  logLine(`saved edits for ${code}`);
  renderTable();
}

// ---------- run / audit ----------
let pollTimer = null;

function refreshButtons() {
  const n = selectedCodes().length;
  $('#btn-dryrun').disabled = !n;
  $('#btn-submit').disabled = !n;
  $('#btn-audit').disabled = !n;
}

async function startRun(mode) {
  const codes = selectedCodes();
  const revision = $('#revision').value;
  const body = { mode, codes };
  if (mode === 'submit') body.confirmed = true;
  if (revision) body.revision = revision;
  if (mode === 'submit' && !revision) { logLine('✗ submit needs an explicit ordinance revision — refusing'); return; }
  try {
    await api('/api/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    startPolling(mode === 'submit' ? 'SUBMIT' : 'dry-run');
  } catch (e) { logLine(`✗ ${e.message}`); }
}

async function startAudit() {
  const codes = selectedCodes().filter((c2) => configs.find((x) => x.code === c2)?.confidence !== 'needs_human');
  if (!codes.length) { logLine('✗ audit: select at least one non-needs_human fee'); return; }
  try {
    await api('/api/audit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ codes }) });
    startPolling('audit');
  } catch (e) { logLine(`✗ ${e.message}`); }
}

function startPolling(label) {
  logLine(`▶ ${label} started`);
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    const job = await api('/api/job');
    renderJob(job);
    if (job.status !== 'running') {
      clearInterval(pollTimer);
      if (job.kind === 'audit' && job.result?.results) {
        audits = {};
        for (const r of job.result.results) {
          audits[r.code] = r.verdict;
          audits[r.code + ':detail'] = r.checks.filter((c) => !c.ok).map((c) => `${c.check}: ${c.detail}`).join('\n') || 'all checks ok';
        }
        renderTable();
      }
      logLine(`■ ${label} ${job.status}${job.result ? ' · ' + JSON.stringify(job.result.summary || {}) : ''}${job.error ? ' · ' + job.error : ''}`);
    }
  }, 1000);
}

function renderJob(job) {
  const badge = $('#job-badge');
  badge.className = `badge ${job.status === 'running' ? 'running' : job.status === 'error' ? 'error' : job.status || 'idle'}`;
  badge.textContent = job.status || 'idle';
  if (job.events) for (const e of job.events.slice(-200)) {
    const line = `[${e.at.slice(11, 19)}] ${e.type === 'done' ? `✓ ${e.code}: ${e.status}` : e.type === 'error' ? `✗ ${e.code}: ${e.error}` : e.type === 'start' ? `→ ${e.code}` : `i ${e.message}`}`;
    if (!seenLines.has(line)) { seenLines.add(line); logLine(line); }
  }
}
const seenLines = new Set();

function logLine(s) {
  $('#log').textContent += s + '\n';
  $('#log').scrollTop = $('#log').scrollHeight;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

// ---------- wire up ----------
$('#filter').addEventListener('input', renderTable);
$('#only-high').addEventListener('change', renderTable);
$('#fees').addEventListener('change', (e) => {
  if (e.target.id === 'check-all') {
    document.querySelectorAll('#fees tbody input.code-check:not(:disabled)').forEach((i) => { i.checked = e.target.checked; });
    refreshButtons();
  } else if (e.target.classList.contains('code-check')) refreshButtons();
});
$('#sel-high').addEventListener('click', () => {
  document.querySelectorAll('#fees tbody input.code-check:not(:disabled)').forEach((i) => { i.checked = false; });
  configs.filter((c) => c.confidence === 'high').forEach((c) => {
    const el = document.querySelector(`#fees tbody input.code-check[value="${c.code}"]`);
    if (el) el.checked = true;
  });
  renderTable();
});
$('#sel-none').addEventListener('click', () => { document.querySelectorAll('input.code-check').forEach((i) => { i.checked = false; }); renderTable(); });
$('#btn-reparse').addEventListener('click', async () => { await api('/api/parse', { method: 'POST' }); await loadState(); logLine('re-parsed revenue_fees.json'); });
$('#btn-dryrun').addEventListener('click', () => startRun('dry-run'));
$('#btn-audit').addEventListener('click', startAudit);
$('#btn-submit').addEventListener('click', () => {
  const rev = $('#revision').value;
  if (!rev) { logLine('✗ pick the ordinance revision first (submit refuses without one)'); return; }
  $('#confirm-revision').textContent = rev;
  $('#confirm-input').value = '';
  $('#confirm-ok').disabled = true;
  $('#confirm-submit').showModal();
});
$('#confirm-input').addEventListener('input', (e) => { $('#confirm-ok').disabled = e.target.value !== 'SUBMIT'; });
$('#confirm-submit').addEventListener('close', (e) => {
  if (e.target.returnValue === 'ok') startRun('submit');
});

loadState().catch((e) => logLine('✗ ' + e.message));
