// popup.js - reads the job from the active tab, runs the rule check, asks Claude for a score, logs to Notion.
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const FIELDS = ['company', 'role', 'link', 'source', 'location', 'work_mode', 'job_type', 'salary', 'experience', 'sponsorship', 'seniority', 'sponsorship_note', 'posted', 'applicants', 'auth_lines', 'jd'];
const OPT_START = '2026-09-12'; // unemployment day 1
const OPT_LIMIT = 90;
let SCHOOL = 'Florida Atlantic University';
const STAGES = ['Saved', 'Applied', 'OA', 'Screen', 'Interview', 'Offer', 'Rejected'];
const DEFAULT_TEMPLATE = [
  'Job: {{role}} at {{company}}',
  'Link: {{link}}',
  'Source: {{source}}',
  'Location: {{location}} | Mode: {{work_mode}} | Type: {{job_type}}',
  'Salary: {{salary}}',
  'Experience asked: {{experience}} | Seniority: {{seniority}}',
  'Sponsorship: {{sponsorship}} ({{sponsorship_note}})',
  'Work auth lines from JD:',
  '{{auth_lines}}',
  'Posted: {{posted}} | Applicants: {{applicants}} | Deadline: {{deadline}}',
  'Score: {{score}} | Keywords: {{keywords}}',
  '',
  '--- Job description ---',
  '{{jd}}'
].join('\n');
const DEFAULT_SETTINGS = { anthropicKey: '', notionToken: '', notionDataSourceId: '42d52ecb-1841-82ad-939d-87b508593635', notionDatabaseId: '54352ecb18418259b0fc817076dabcbc', autoLog: true, autoLogMin: 70, autoCheck: false, deep: false, weeklyGoal: 20 };
const bandFor = (score) => (score >= 70 ? 'APPLY' : score >= 40 ? 'MAYBE' : 'SKIP');
const bandWord = { APPLY: 'apply', MAYBE: 'maybe', SKIP: 'skip' };
const scoreLabel = (v) => (v && typeof v.score === 'number' ? `${v.score}%` : (v && v.verdict) || '');

let current = null;    // last extracted/edited job
let lastRules = null;
let lastVerdict = null;
let notionPage = null; // {id,url} for the current job
let stageFilter = 'All';

// ---------- small utils ----------
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 1600);
}
function setStatus(msg) { $('#status').textContent = msg; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
async function copy(text, label) {
  try { await navigator.clipboard.writeText(text); toast(label || 'Copied'); }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove(); toast(label || 'Copied');
  }
}
function setSelect(sel, value) {
  if (!value) return;
  if (![...sel.options].some((o) => o.value === value)) { const o = document.createElement('option'); o.textContent = value; sel.appendChild(o); }
  sel.value = value;
}
function optDay() {
  const start = new Date(OPT_START + 'T00:00:00');
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.floor((now - start) / 86400000) + 1;
}
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function weekStart() { const d = new Date(); d.setHours(0, 0, 0, 0); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return d; } // Monday
function send(msg) { return chrome.runtime.sendMessage(msg); }

// ---------- storage ----------
const store = {
  async getTemplate() { const r = await chrome.storage.sync.get('template'); return r.template || DEFAULT_TEMPLATE; },
  async setTemplate(t) { await chrome.storage.sync.set({ template: t }); },
  async getJobs() { const r = await chrome.storage.local.get('jobs'); return r.jobs || []; },
  async setJobs(jobs) { await chrome.storage.local.set({ jobs }); },
  async getSettings() { const r = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS)); return Object.assign({}, DEFAULT_SETTINGS, r); },
  async setSettings(patch) { await chrome.storage.local.set(patch); }
};

// ---------- extraction ----------
async function getTab() { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); return tab; }

function scoreResult(r) {
  let s = (r.jd || '').length;
  if (r.role) s += 1000;
  if (r.company) s += 500;
  if (r._debug && r._debug.jsonld) s += 5000;
  if (r._debug && r._debug.extractor !== 'generic') s += 5000;
  if (r._debug && r._debug.from_body) s -= 4000;
  return s;
}

async function extractFromTab() {
  const tab = await getTab();
  if (!tab || !/^https?:/.test(tab.url || '')) throw new Error('Open a job posting (http/https page) first.');
  const run = async (allFrames) => {
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames }, files: ['extractor.js'] });
    return chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames }, func: () => (window.__jdFillerExtract ? window.__jdFillerExtract() : null) });
  };
  let results;
  try { results = await run(true); } catch (e) { results = await run(false); }
  const items = (results || []).map((r) => r && r.result).filter(Boolean);
  if (!items.length) throw new Error('Could not read this page. Chrome blocks extensions on some pages (Web Store, chrome://).');
  items.sort((a, b) => scoreResult(b) - scoreResult(a));
  const best = items[0];
  if (!best.link) best.link = tab.url;
  return best;
}

// ---------- form <-> object ----------
function fill(job) {
  current = job;
  for (const k of FIELDS) {
    const el = $(`#f_${k}`);
    if (!el) continue;
    let v = job[k];
    if (k === 'auth_lines') v = Array.isArray(v) ? v.map((l) => '- ' + l).join('\n') : (v || '');
    if (el.tagName === 'SELECT') setSelect(el, v || '');
    else el.value = v || '';
  }
  $('#jdLen').textContent = job.jd ? `${job.jd.length} chars` : 'empty';
  const d = job._debug || {};
  $('#debug').textContent = `Read via ${d.extractor || 'generic'}${d.jsonld ? ' + JSON-LD' : ''}${d.from_body ? ' (fallback: whole page text, trim the JD)' : ''}${d.err ? ' | error: ' + d.err : ''}`;
  renderHero(job);
}

function read() {
  const job = Object.assign({}, current || {});
  for (const k of FIELDS) {
    const el = $(`#f_${k}`);
    if (!el) continue;
    let v = el.value.trim();
    if (k === 'auth_lines') v = v.split('\n').map((l) => l.replace(/^-\s*/, '').trim()).filter(Boolean);
    job[k] = v;
  }
  return job;
}

// ---------- hero ----------
function shortSalary(s) {
  if (!s || s === 'Not stated') return '';
  return s.replace(/,000\b/g, 'K').replace(/\s*\/\s*year/i, '/yr').replace(/\s*(?:-|–|—|to)\s*/, '–').replace(/USD\s?/i, '$').replace(/\$\$/g, '$');
}
function renderHero(job) {
  $('#h_role').textContent = job.role || 'No title found';
  $('#h_company').textContent = job.company || '';
  $('#h_location').textContent = job.location || '';
  const chips = [];
  if (job.work_mode && job.work_mode !== 'Unknown') chips.push(job.work_mode);
  if (job.job_type && job.job_type !== 'Unknown') chips.push(job.job_type);
  const sal = shortSalary(job.salary); if (sal) chips.push(sal);
  if (job.experience && job.experience !== 'Not stated') chips.push(job.experience);
  if (job.posted) chips.push(job.posted);
  if (job.applicants) chips.push(job.applicants);
  if (job.source) chips.push(job.source);
  const sp = job.sponsorship === 'Sponsors' ? ['Sponsors visa', 'apply'] : job.sponsorship === 'No sponsorship' ? ['No sponsorship', 'maybe'] : null;
  $('#h_chips').innerHTML = chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('') + (sp ? `<span class="chip ${sp[1]}">${esc(sp[0])}</span>` : '');
  const co = (job.company || '').trim();
  const q = encodeURIComponent;
  $('#h_links').innerHTML = co ? [
    [`https://www.google.com/search?q=${q(co + ' H-1B sponsorship history h1bgrader')}`, 'H-1B history'],
    [`https://www.linkedin.com/search/results/people/?keywords=${q(co + ' ' + SCHOOL)}`, 'Alumni at ' + co],
    [`https://www.linkedin.com/search/results/people/?keywords=${q(co + ' recruiter')}`, 'Recruiters'],
    [`https://www.glassdoor.com/Search/results.htm?keyword=${q(co)}`, 'Glassdoor'],
    [`https://www.google.com/search?q=${q(co + ' e-verify employer')}`, 'E-Verify']
  ].map(([href, text]) => `<a href="${href}" target="_blank" rel="noopener">${esc(text)}</a>`).join('') : '';
}

// ---------- template rendering ----------
function render(tpl, job) {
  const val = (k) => {
    let v = job[k];
    if (k === 'auth_lines') return Array.isArray(v) && v.length ? v.map((l) => '- "' + l + '"').join('\n') : '- (none found)';
    if (k === 'date') return todayStr();
    if (k === 'score') return lastVerdict && typeof lastVerdict.score === 'number' ? `${lastVerdict.score}% (${lastVerdict.reason || ''})` : 'Not checked';
    if (k === 'keywords') return lastVerdict && lastVerdict.keywords && lastVerdict.keywords.length ? lastVerdict.keywords.join(', ') : 'Not checked';
    if (v === undefined || v === null || v === '') return 'Not stated';
    return String(v);
  };
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => val(k)).trim();
}
function factsTemplate(tpl) {
  const lines = tpl.split('\n');
  const idx = lines.findIndex((l) => l.includes('{{jd}}'));
  let head = idx === -1 ? lines : lines.slice(0, idx);
  while (head.length && /^\s*$|^[-=_\s]*(?:job description)?[-=_\s]*$/i.test(head[head.length - 1])) head.pop();
  return head.join('\n');
}
function resumePrompt(job) {
  const v = lastVerdict || {};
  const lines = [
    `Tailor my resume for this job. Use only my real experience; do not add tools or results I have not listed.`,
    `Role: ${job.role || 'Not stated'} at ${job.company || 'Not stated'} (${job.location || 'Not stated'}, ${job.work_mode || 'Unknown'})`,
    `Link: ${job.link || ''}`,
    v.keywords && v.keywords.length ? `Keywords from the JD to include where true: ${v.keywords.join(', ')}` : '',
    v.lead_with ? `Lead with: ${v.lead_with}` : '',
    v.dont_claim ? `Do not claim: ${v.dont_claim}` : '',
    v.fit && v.fit.length ? `Fit map: ${v.fit.map((f) => `${f.point} (${f.level})`).join('; ')}` : '',
    '',
    '--- Job description ---',
    (job.jd || '').slice(0, 12000)
  ].filter((l) => l !== '');
  return lines.join('\n');
}

// ---------- rules ----------
function runRules() {
  const job = read();
  lastRules = window.JDRules ? window.JDRules.check(job) : { skip: [], maybe: [] };
  const item = (h) => `<b>${esc(h.rule)}</b><span class="q">"${esc(h.quote)}"</span>`;
  let html = '';
  if (lastRules.skip.length) html += `<div class="banner skip"><b>Auto-skip</b>${lastRules.skip.map(item).join('')}</div>`;
  if (lastRules.maybe.length) html += `<div class="banner maybe"><b>Worth a second look</b>${lastRules.maybe.map(item).join('')}</div>`;
  $('#rules').innerHTML = html;
  return lastRules;
}

// ---------- score ring + verdict ----------
function setRing(state, score) {
  const ring = $('#ringBtn');
  const fill = $('#ringFill');
  const text = $('#ringText');
  ring.className = 'ring';
  if (state === 'busy') { ring.classList.add('busy'); text.textContent = '…'; fill.style.strokeDashoffset = 95; return; }
  if (state === 'empty' || typeof score !== 'number') { ring.classList.add('empty'); text.textContent = 'Check'; fill.style.strokeDashoffset = 125.66; return; }
  const band = bandFor(score);
  ring.classList.add(band);
  text.textContent = `${score}%`;
  fill.style.strokeDashoffset = 125.66 * (1 - score / 100);
}

function verdictHtml(v, meta) {
  const row = (k, html) => `<div class="row"><span class="k">${k}</span><span class="v">${html}</span></div>`;
  const quotes = (v.auth && v.auth.quotes || []).filter(Boolean);
  const fit = (v.fit || []).slice(0, 3).map((f) => `<span class="tag ${esc(f.level)}">${esc(f.point)} · ${esc(f.level).toLowerCase()}</span>`).join('');
  const flags = (v.red_flags || []).filter(Boolean);
  const kws = (v.keywords || []).filter(Boolean);
  const band = v.verdict || bandFor(v.score || 0);
  return `<div class="verdict">
    <div class="why"><b>${typeof v.score === 'number' ? v.score + '% · ' + bandWord[band] : esc(band)}.</b> ${esc(v.reason)}</div>
    ${row('Role', `${esc(v.level)} · ${esc(v.job_type)} · years asked ${esc(v.years_asked)} · ${esc(v.pay)}`)}
    ${row('Auth', `${esc(v.auth && v.auth.sponsorship)}${quotes.length ? '<br><span class="muted">' + quotes.map((q) => `"${esc(q)}"`).join('<br>') + '</span>' : ''}<br><span class="muted">OPT day ${optDay()}/${OPT_LIMIT}</span>`)}
    ${row('Fit', `<span class="fit">${fit || '<span class="muted">none</span>'}</span>`)}
    ${row('Lead with', esc(v.lead_with))}
    ${row("Don't claim", esc(v.dont_claim))}
    ${row('Do now', esc(v.do_now))}
    ${kws.length ? row('Keywords', `<span class="kw">${kws.map((k) => `<span class="chip">${esc(k)}</span>`).join('')}<button id="copyKw" class="quiet" title="Copy keywords">copy</button></span>`) : ''}
    ${flags.length ? row('Red flags', esc(flags.join('; '))) : ''}
    <div class="meta">${esc(meta.model)} · ${(meta.ms / 1000).toFixed(1)}s · ${meta.input} in / ${meta.output} out${meta.cache_read ? ' · cache hit' : meta.cache_write ? ' · cache written' : ''}</div>
  </div>`;
}

function errorRow(prefix, err, retryId) {
  return `<div class="error-row"><span class="err">${esc(prefix)} ${esc(err)}</span><button id="${retryId}" class="quiet">Retry</button></div>`;
}

async function doCheck() {
  const job = read();
  if (!job.jd && !job.role) { toast('Nothing to check yet'); return; }
  const rules = runRules();
  const settings = await store.getSettings();
  const deep = $('#deep').checked;
  const box = $('#verdict');
  box.innerHTML = `<div class="verdict muted">Scoring with Opus 5.5${deep ? ' at xhigh effort' : ''}…</div>`;
  setRing('busy');
  $('#check').disabled = true;
  try {
    const res = await send({ type: 'claude.verdict', job: stripForApi(job), rules, deep });
    if (!res || !res.ok) throw Object.assign(new Error((res && res.error) || 'No response from background'), { retryable: res && res.retryable });
    lastVerdict = res.verdict;
    current = Object.assign(current || {}, { verdict: res.verdict, verdict_meta: res.meta });
    box.innerHTML = verdictHtml(res.verdict, res.meta);
    setRing('done', res.verdict.score);
    const kwBtn = $('#copyKw'); if (kwBtn) kwBtn.addEventListener('click', () => copy((res.verdict.keywords || []).join(', '), 'Keywords copied'));
    const score = typeof res.verdict.score === 'number' ? res.verdict.score : 0;
    if (settings.autoLog && score >= Number(settings.autoLogMin || 70)) await logToNotion(true);
  } catch (e) {
    box.innerHTML = errorRow('Claude:', e.message, 'retryCheck');
    setRing('empty');
    $('#retryCheck').addEventListener('click', doCheck);
  } finally {
    $('#check').disabled = false;
  }
}

function stripForApi(job) {
  const j = Object.assign({}, job);
  delete j._debug; delete j.verdict; delete j.verdict_meta;
  return j;
}

// ---------- Notion ----------
function notionLine(html) { $('#notion').innerHTML = html; }

async function logToNotion(auto) {
  const job = read();
  if (!job.link) { toast('No job link to log'); return; }
  notionLine(`<span class="muted">${auto ? 'Score above your threshold, logging to Notion…' : 'Logging to Notion…'}</span>`);
  $('#logNotion').disabled = true;
  try {
    const res = await send({ type: 'notion.create', job: stripForApi(job), verdict: lastVerdict });
    if (!res || !res.ok) throw new Error((res && res.error) || 'No response from background');
    notionPage = res.page;
    const link = res.page.url ? `<a href="${esc(res.page.url)}" target="_blank" rel="noopener">Open in Notion</a>` : '';
    if (res.exists) {
      notionLine(`Already logged. ${link}`);
      await upsertSaved(Object.assign({}, job, { verdict: lastVerdict }), { stage: 'Applied', applied: true, notion_page_id: res.page.id, notion_url: res.page.url });
    } else {
      notionLine(`Logged to Notion. ${link} <button id="undoNotion" class="quiet danger">Undo</button>`);
      $('#undoNotion').addEventListener('click', undoNotion);
      await markApplied(job, res.page);
      toast('Logged to Notion');
    }
  } catch (e) {
    notionLine(`<span class="err">Notion: ${esc(e.message)}</span> <button id="retryNotion" class="quiet">Retry</button>`);
    $('#retryNotion').addEventListener('click', () => logToNotion(false));
  } finally {
    $('#logNotion').disabled = false;
  }
}

async function undoNotion() {
  if (!notionPage) return;
  notionLine(`<span class="muted">Removing from Notion…</span>`);
  try {
    const res = await send({ type: 'notion.trash', pageId: notionPage.id });
    if (!res || !res.ok) throw new Error((res && res.error) || 'No response');
    await unmarkApplied(read());
    notionPage = null;
    notionLine('Removed from Notion (moved to trash).');
  } catch (e) {
    notionLine(`<span class="err">Undo failed: ${esc(e.message)}</span> <button id="retryUndo" class="quiet">Retry</button>`);
    $('#retryUndo').addEventListener('click', undoNotion);
  }
}

async function checkAlreadyLogged(link) {
  const s = await store.getSettings();
  if (!s.notionToken || !link) return;
  try {
    const res = await send({ type: 'notion.find', link });
    if (res && res.ok && res.page) { notionPage = res.page; notionLine(`Already in Notion. <a href="${esc(res.page.url)}" target="_blank" rel="noopener">Open</a>`); }
  } catch (e) { /* quiet */ }
}

// ---------- tracker ----------
const jobKey = (j) => (j.link || '') + '|' + (j.role || '') + '|' + (j.company || '');

async function upsertSaved(job, patch) {
  const jobs = await store.getJobs();
  const idx = jobs.findIndex((j) => jobKey(j) === jobKey(job));
  const now = new Date().toISOString();
  const prev = idx >= 0 ? jobs[idx] : {};
  const rec = Object.assign({}, prev, stripForApi(job), { verdict: job.verdict || prev.verdict, verdict_meta: job.verdict_meta || prev.verdict_meta, stage: prev.stage || 'Saved', saved_at: prev.saved_at || now, updated_at: now }, patch || {});
  if (rec.stage !== 'Saved' && !rec.applied_on) rec.applied_on = todayStr();
  rec.applied = rec.stage !== 'Saved';
  if (idx >= 0) jobs[idx] = rec; else jobs.unshift(rec);
  await store.setJobs(jobs);
  await renderSaved();
  return idx >= 0;
}
async function markApplied(job, page) {
  await upsertSaved(Object.assign({}, job, { verdict: lastVerdict }), { stage: 'Applied', applied_on: todayStr(), notion_page_id: page.id, notion_url: page.url });
}
async function unmarkApplied(job) {
  await upsertSaved(job, { stage: 'Saved', applied_on: '', notion_page_id: '', notion_url: '' });
}
async function saveCurrent() {
  const job = read();
  if (!job.link && !job.role) { toast('Nothing to save'); return; }
  const existed = await upsertSaved(Object.assign({}, job, { verdict: lastVerdict || job.verdict }));
  toast(existed ? 'Updated in tracker' : 'Saved to tracker');
}

function weekCount(jobs) {
  const start = weekStart();
  return jobs.filter((j) => j.applied_on && new Date(j.applied_on + 'T00:00:00') >= start).length;
}

async function renderSaved() {
  const jobs = await store.getJobs();
  const s = await store.getSettings();
  $('#savedCount').textContent = jobs.length;
  $('#weekStat').textContent = `${weekCount(jobs)} of ${s.weeklyGoal} applied this week`;
  const counts = {};
  for (const j of jobs) counts[j.stage || 'Saved'] = (counts[j.stage || 'Saved'] || 0) + 1;
  $('#stageFilters').innerHTML = ['All', ...STAGES].filter((st) => st === 'All' || counts[st]).map((st) => `<button data-stage="${st}" class="${stageFilter === st ? 'on' : ''}">${st}${st === 'All' ? '' : ' ' + counts[st]}</button>`).join('');
  const list = $('#savedList');
  const shown = jobs.map((j, i) => ({ j, i })).filter(({ j }) => stageFilter === 'All' || (j.stage || 'Saved') === stageFilter);
  if (!jobs.length) { list.innerHTML = '<div class="empty">Nothing tracked yet. Open a job and press Save, or log it to Notion.</div>'; return; }
  if (!shown.length) { list.innerHTML = `<div class="empty">No jobs in ${esc(stageFilter)}.</div>`; return; }
  list.innerHTML = shown.map(({ j, i }) => `
    <div class="item" data-i="${i}">
      <div class="head"><span class="name">${esc(j.role || '(no title)')} ${j.verdict ? `<span class="badge ${esc(j.verdict.verdict || bandFor(j.verdict.score || 0))}">${esc(scoreLabel(j.verdict))}</span>` : ''}</span><span class="muted small">${esc((j.applied_on || j.saved_at || '').slice(0, 10))}</span></div>
      <div class="sub">${esc([j.company, j.location, j.work_mode, j.source].filter(Boolean).join(' · '))}${j.notion_url ? ` · <a href="${esc(j.notion_url)}" target="_blank" rel="noopener">Notion</a>` : ''}</div>
      <div class="controls">
        <select data-act="stage" title="Stage">${STAGES.map((st) => `<option ${((j.stage || 'Saved') === st) ? 'selected' : ''}>${st}</option>`).join('')}</select>
        <button data-act="load" class="quiet">Load</button>
        <button data-act="copy" class="quiet">Copy</button>
        <button data-act="open" class="quiet">Open</button>
        <span class="grow"></span>
        <button data-act="delete" class="quiet danger">Delete</button>
      </div>
    </div>`).join('');
}

function csvCell(v) { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
async function exportCsv() {
  const jobs = await store.getJobs();
  if (!jobs.length) { toast('Nothing to export'); return; }
  const cols = [
    ['Role', 'role'], ['Company', 'company'], ['Job Link', 'link'], ['Location', 'location'], ['Work Mode', 'work_mode'], ['Source', 'source'],
    ['Sponsorship', 'sponsorship'], ['Job Type', 'job_type'], ['Salary', 'salary'], ['Experience', 'experience'], ['Seniority', 'seniority'],
    ['Score', (j) => (j.verdict && typeof j.verdict.score === 'number' ? j.verdict.score : '')], ['Band', (j) => (j.verdict ? j.verdict.verdict : '')],
    ['Stage', (j) => j.stage || 'Saved'], ['Applied On', 'applied_on'], ['Saved On', (j) => (j.saved_at || '').slice(0, 10)], ['Notion', 'notion_url'],
    ['Keywords', (j) => (j.verdict && j.verdict.keywords ? j.verdict.keywords.join('; ') : '')],
    ['Notes', (j) => [j.verdict && j.verdict.reason, j.sponsorship_note, ...(j.auth_lines || [])].filter(Boolean).join(' | ')]
  ];
  const rows = [cols.map((c) => c[0]).join(',')];
  for (const j of jobs) rows.push(cols.map((c) => csvCell(typeof c[1] === 'function' ? c[1](j) : j[c[1]])).join(','));
  downloadText(rows.join('\n'), `jd-filler-${todayStr()}.csv`, 'text/csv');
}
function downloadText(text, filename, type) {
  const blob = new Blob([text], { type: type || 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- fixture capture (debug) ----------
async function saveFixture() {
  const tab = await getTab();
  if (!tab || !/^https?:/.test(tab.url || '')) { toast('Open a job page first'); return; }
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const d = document.cloneNode(true);
      d.querySelectorAll('script:not([type="application/ld+json"]), style, link:not([rel="canonical"]), svg, noscript, iframe, video, audio, source, template, img').forEach((e) => e.remove());
      d.querySelectorAll('code').forEach((e) => { if (/^\s*[\[{]/.test(e.textContent)) e.remove(); });
      const keep = new Set(['class', 'id', 'href', 'alt', 'rel', 'type', 'property', 'name', 'content', 'itemprop', 'data-automation-id', 'data-test', 'data-testid', 'data-hook', 'data-job-id', 'data-qa', 'role', 'aria-label', 'lang', 'value']);
      d.querySelectorAll('*').forEach((el) => { for (const a of [...el.attributes]) if (!keep.has(a.name)) el.removeAttribute(a.name); });
      const w = d.createTreeWalker(d, NodeFilter.SHOW_COMMENT); const cs = []; while (w.nextNode()) cs.push(w.currentNode); cs.forEach((c) => c.remove());
      return { url: location.href, html: '<!doctype html>\n<!-- source: ' + location.href + ' -->\n' + d.documentElement.outerHTML.replace(/\n\s*\n+/g, '\n') };
    }
  });
  const data = res && res.result;
  if (!data) { toast('Could not read page'); return; }
  const name = (new URL(data.url).hostname.replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '-') + '-' + todayStr()).toLowerCase();
  const js = `// Fixture for test-extract.html. Captured from ${data.url}\nwindow.JD_FIXTURES = window.JD_FIXTURES || [];\nwindow.JD_FIXTURES.push(${JSON.stringify({ name, url: data.url, expect: {}, expectNot: {}, html: data.html })});\n`;
  downloadText(js, `${name}.fixture.js`, 'text/javascript');
  toast('Fixture downloaded');
}

// ---------- settings ----------
async function loadSettings() {
  const s = await store.getSettings();
  $('#s_anthropicKey').value = s.anthropicKey;
  $('#s_notionToken').value = s.notionToken;
  $('#s_notionDataSourceId').value = s.notionDataSourceId;
  $('#s_notionDatabaseId').value = s.notionDatabaseId;
  $('#s_autoLog').checked = !!s.autoLog;
  $('#s_autoLogMin').value = s.autoLogMin;
  $('#s_autoCheck').checked = !!s.autoCheck;
  $('#s_weeklyGoal').value = s.weeklyGoal;
  $('#deep').checked = !!s.deep;
  return s;
}
async function saveSettings() {
  await store.setSettings({
    anthropicKey: $('#s_anthropicKey').value.trim(),
    notionToken: $('#s_notionToken').value.trim(),
    notionDataSourceId: $('#s_notionDataSourceId').value.trim(),
    notionDatabaseId: $('#s_notionDatabaseId').value.trim(),
    autoLog: $('#s_autoLog').checked,
    autoLogMin: Math.max(0, Math.min(100, parseInt($('#s_autoLogMin').value, 10) || 70)),
    autoCheck: $('#s_autoCheck').checked,
    weeklyGoal: Math.max(1, parseInt($('#s_weeklyGoal').value, 10) || 20)
  });
  await renderSaved();
}
async function testKey(type, btn) {
  await saveSettings();
  btn.disabled = true; btn.textContent = '…';
  try {
    const res = await send({ type });
    $('#settingsMsg').textContent = res && res.ok ? res.message : `Failed: ${(res && res.error) || 'no response'}`;
  } catch (e) { $('#settingsMsg').textContent = `Failed: ${e.message}`; }
  finally { btn.disabled = false; btn.textContent = 'Test'; }
}

// ---------- wiring ----------
async function doExtract() {
  setStatus('Reading page…');
  $('#verdict').innerHTML = ''; $('#notion').innerHTML = ''; lastVerdict = null; notionPage = null; setRing('empty');
  try {
    const job = await extractFromTab();
    fill(job);
    setStatus(`Read from ${job.source}`);
    runRules();
    checkAlreadyLogged(job.link);
    const s = await store.getSettings();
    if (s.autoCheck && s.anthropicKey) doCheck();
  } catch (e) {
    setStatus(e.message || String(e));
    if (!current) fill({ link: (await getTab())?.url || '', source: 'Other', work_mode: 'Unknown', job_type: 'Unknown', sponsorship: 'Unknown', auth_lines: [] });
  }
}

function switchTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + name));
  $('#bar').style.display = name === 'job' ? '' : 'none';
}

document.addEventListener('DOMContentLoaded', async () => {
  $('#optDay').textContent = `OPT day ${optDay()} of ${OPT_LIMIT}`;
  $$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

  $('#check').addEventListener('click', doCheck);
  $('#ringBtn').addEventListener('click', doCheck);
  $('#deep').addEventListener('change', () => store.setSettings({ deep: $('#deep').checked }));
  $('#logNotion').addEventListener('click', () => logToNotion(false));
  $('#copyResume').addEventListener('click', () => copy(resumePrompt(read()), 'Resume prompt copied'));
  $('#copyGrok').addEventListener('click', async () => copy(render(await store.getTemplate(), read()), 'Copied for Grok'));
  $('#copyFacts').addEventListener('click', async () => copy(render(factsTemplate(await store.getTemplate()), read()), 'Facts copied'));
  $('#copyJson').addEventListener('click', () => { const j = read(); delete j._debug; if (lastVerdict) j.verdict = lastVerdict; copy(JSON.stringify(j, null, 2), 'JSON copied'); });
  $('#save').addEventListener('click', saveCurrent);
  $('#reextract').addEventListener('click', doExtract);
  ['#f_jd', '#f_role', '#f_salary'].forEach((sel) => $(sel).addEventListener('change', () => { runRules(); renderHero(read()); }));
  ['#f_company', '#f_location', '#f_work_mode', '#f_job_type', '#f_sponsorship', '#f_posted', '#f_applicants', '#f_experience', '#f_source'].forEach((sel) => $(sel).addEventListener('change', () => renderHero(read())));

  $('#exportCsv').addEventListener('click', exportCsv);
  $('#clearSaved').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    if (b.dataset.armed) { delete b.dataset.armed; b.textContent = 'Clear all'; await store.setJobs([]); await renderSaved(); toast('Tracker cleared'); return; }
    b.dataset.armed = '1'; b.textContent = 'Click again to confirm';
    setTimeout(() => { delete b.dataset.armed; b.textContent = 'Clear all'; }, 3000);
  });
  $('#stageFilters').addEventListener('click', (e) => { const b = e.target.closest('[data-stage]'); if (!b) return; stageFilter = b.dataset.stage; renderSaved(); });
  $('#savedList').addEventListener('change', async (e) => {
    const sel = e.target.closest('select[data-act="stage"]'); if (!sel) return;
    const i = Number(e.target.closest('.item').dataset.i);
    const jobs = await store.getJobs(); const j = jobs[i]; if (!j) return;
    j.stage = sel.value; j.applied = j.stage !== 'Saved';
    if (j.applied && !j.applied_on) j.applied_on = todayStr();
    if (!j.applied) j.applied_on = '';
    j.updated_at = new Date().toISOString();
    await store.setJobs(jobs); await renderSaved();
  });
  $('#savedList').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const i = Number(e.target.closest('.item').dataset.i);
    const jobs = await store.getJobs();
    const j = jobs[i];
    if (!j) return;
    const act = btn.dataset.act;
    if (act === 'load') {
      fill(j); lastVerdict = j.verdict || null;
      $('#verdict').innerHTML = j.verdict ? verdictHtml(j.verdict, j.verdict_meta || { model: 'saved', ms: 0, input: 0, output: 0 }) : '';
      setRing(j.verdict ? 'done' : 'empty', j.verdict && j.verdict.score);
      notionLine(j.notion_url ? `Logged. <a href="${esc(j.notion_url)}" target="_blank" rel="noopener">Open in Notion</a>` : '');
      switchTab('job'); setStatus('Loaded from tracker'); runRules();
    }
    else if (act === 'copy') copy(render(await store.getTemplate(), j), 'Copied');
    else if (act === 'open' && j.link) chrome.tabs.create({ url: j.link });
    else if (act === 'delete') { jobs.splice(i, 1); await store.setJobs(jobs); await renderSaved(); }
  });

  $('#template').value = await store.getTemplate();
  $('#saveTemplate').addEventListener('click', async () => { await store.setTemplate($('#template').value); toast('Template saved'); });
  $('#resetTemplate').addEventListener('click', async () => { $('#template').value = DEFAULT_TEMPLATE; await store.setTemplate(DEFAULT_TEMPLATE); toast('Template reset'); });
  $('#saveSettings').addEventListener('click', async () => { await saveSettings(); toast('Settings saved'); });
  $('#testClaude').addEventListener('click', (e) => testKey('claude.test', e.currentTarget));
  $('#testNotion').addEventListener('click', (e) => testKey('notion.test', e.currentTarget));
  $('#saveFixture').addEventListener('click', saveFixture);
  $('#f_jd').addEventListener('input', () => { $('#jdLen').textContent = `${$('#f_jd').value.length} chars`; });

  $('#openProfile').addEventListener('click', () => chrome.runtime.openOptionsPage());
  try { const { profile } = await chrome.storage.local.get('profile'); const sch = profile && profile.education && profile.education[0] && profile.education[0].school; if (sch) SCHOOL = sch; } catch (e) { /* ignore */ }
  await loadSettings();
  await renderSaved();
  await doExtract();
});
