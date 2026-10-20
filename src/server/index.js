/**
 * Local web app (PLAN §6 Plan#2): localhost-only control plane.
 * Binds 127.0.0.1 exclusively (§8). No framework, no build step.
 *
 *   GET  /api/state        configs + report + current/last job
 *   POST /api/parse        re-run the deterministic parser over revenue_fees.json
 *   PUT  /api/config       save human edits to one config (amount/rate/type/…)
 *   POST /api/run          start a dry-run or submit job (submit needs confirmed+revision)
 *   POST /api/audit        start an audit job (API re-read + diff)
 *   GET  /api/job          live job status/events (polled by the UI)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { parseAll } = require('../parser');
const { runConfigs } = require('../executor/runner');
const { runAudit } = require('../audit/audit');

const ROOT = path.join(__dirname, '..', '..');
const PORT = Number(process.env.ELGU_APP_PORT || 8765);
const HOST = '127.0.0.1';

const CONFIG_FILE = path.join(ROOT, 'elgu_config.json');
const FEES_FILE = path.join(ROOT, 'revenue_fees.json');

// ---------- state ----------
let state = loadState();

function loadState() {
  if (fs.existsSync(CONFIG_FILE)) {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return { configs: parsed.configs, report: parsed.report };
  }
  const fees = JSON.parse(fs.readFileSync(FEES_FILE, 'utf8'));
  const { configs, report } = parseAll(fees);
  return { configs, report };
}

function persistState() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ generated_at: new Date().toISOString(), report: state.report, configs: state.configs }, null, 2), 'utf8');
}

// ---------- job manager (one job at a time; the browser profile is single-user) ----------
let job = null;

function startJob(kind, runner) {
  if (job && job.status === 'running') return { error: 'a job is already running' };
  job = { id: `job-${Date.now()}`, kind, status: 'running', started_at: new Date().toISOString(), events: [], result: null, error: null };
  run().catch((e) => {
    job.status = 'error';
    job.error = String(e.message || e);
  });
  return { job_id: job.id };

  async function run() {
    await runner({
      event: (e) => {
        job.events.push({ at: new Date().toISOString(), ...e });
        if (job.events.length > 2000) job.events.splice(0, job.events.length - 2000);
      },
      done: (result) => {
        job.status = 'done';
        job.result = result;
        job.finished_at = new Date().toISOString();
      },
    });
  }
}

// ---------- http plumbing ----------
const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

async function readBody(req) {
  let data = '';
  for await (const chunk of req) data += chunk;
  return data ? JSON.parse(data) : {};
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);

    if (url.pathname.startsWith('/api/')) {
      // ---- state ----
      if (req.method === 'GET' && url.pathname === '/api/state') {
        return json(res, 200, { report: state.report, configs: state.configs, job });
      }

      // ---- re-parse ----
      if (req.method === 'POST' && url.pathname === '/api/parse') {
        const fees = JSON.parse(fs.readFileSync(FEES_FILE, 'utf8'));
        const { configs, report } = parseAll(fees);
        state = { configs, report };
        persistState();
        return json(res, 200, { report });
      }

      // ---- save config edits ----
      if (req.method === 'PUT' && url.pathname === '/api/config') {
        const edited = await readBody(req);
        const i = state.configs.findIndex((c) => c.code === edited.code);
        if (i < 0) return json(res, 404, { error: `unknown code ${edited.code}` });
        state.configs[i] = { ...state.configs[i], ...edited, _edited: true };
        persistState();
        return json(res, 200, { ok: true });
      }

      // ---- run (dry-run / submit) ----
      if (req.method === 'POST' && url.pathname === '/api/run') {
        const body = await readBody(req);
        if (body.mode === 'submit' && body.confirmed !== true) {
          return json(res, 400, { error: 'submit requires typed confirmation in the UI' });
        }
        if (body.mode === 'submit' && !body.revision) {
          return json(res, 400, { error: 'submit requires an explicit ordinance revision (PLAN §3: never assume)' });
        }
        const selected = state.configs.filter((c) => (body.codes || []).includes(c.code));
        if (!selected.length) return json(res, 400, { error: 'no codes selected' });
        const started = startJob(`run:${body.mode}`, async ({ event, done }) => {
          const result = await runConfigs({
            configs: selected,
            mode: body.mode,
            revision: body.revision || null,
            confirmSubmit: body.mode !== 'submit' || body.confirmed === true,
            onEvent: event,
          });
          done({ summary: result.summary, log_file: result.log_file, revision_selection: result.revision_selection });
        });
        return started.error ? json(res, 409, started) : json(res, 200, started);
      }

      // ---- audit ----
      if (req.method === 'POST' && url.pathname === '/api/audit') {
        const body = await readBody(req).catch(() => ({}));
        const selected = state.configs.filter((c) =>
          (body.codes || []).includes(c.code) && c.confidence !== 'needs_human');
        if (!selected.length) return json(res, 400, { error: 'no auditable codes selected' });
        const started = startJob('audit', async ({ event, done }) => {
          const result = await runAudit({ configs: selected, onEvent: event });
          done({ summary: result.summary, log_file: result.log_file, results: result.results });
        });
        return started.error ? json(res, 409, started) : json(res, 200, started);
      }

      // ---- job status ----
      if (req.method === 'GET' && url.pathname === '/api/job') {
        return json(res, 200, job || { status: 'idle' });
      }

      return json(res, 404, { error: 'unknown api route' });
    }

    // ---- static (public/) ----
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const file = path.join(ROOT, 'public', rel);
    if (!file.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('not found');
    }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    json(res, 500, { error: String(e.message || e) });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`[elgu-app] http://${HOST}:${PORT}  (configs: ${state.configs.length})`);
    console.log('[elgu-app] dry-run default; submit needs typed confirmation + revision');
  });
}

module.exports = { server, loadState };
