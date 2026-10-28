// popup.js - reads the job from the active tab, lets you edit, copy, and save it.
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const FIELDS = ['company', 'role', 'link', 'source', 'location', 'work_mode', 'job_type', 'salary', 'experience', 'sponsorship', 'seniority', 'sponsorship_note', 'posted', 'applicants', 'auth_lines', 'jd'];
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
  '',
  '--- Job description ---',
  '{{jd}}'
].join('\n');

let current = null; // last extracted/edited job

// ---------- small utils ----------
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 1400);
}
function setStatus(msg) { $('#status').textContent = msg; }
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove(); toast('Copied');
  }
}
function setSelect(sel, value) {
  if (!value) return;
  if (![...sel.options].some((o) => o.value === value)) { const o = document.createElement('option'); o.textContent = value; sel.appendChild(o); }
  sel.value = value;
}

// ---------- storage ----------
const store = {
  async getTemplate() { const r = await chrome.storage.sync.get('template'); return r.template || DEFAULT_TEMPLATE; },
  async setTemplate(t) { await chrome.storage.sync.set({ template: t }); },
  async getJobs() { const r = await chrome.storage.local.get('jobs'); return r.jobs || []; },
  async setJobs(jobs) { await chrome.storage.local.set({ jobs }); }
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
  $('#jdLen').textContent = job.jd ? `(${job.jd.length} chars)` : '(empty)';
  const d = job._debug || {};
  $('#debug').textContent = `Read via: ${d.extractor || 'generic'}${d.jsonld ? ' + JSON-LD' : ''}${d.from_body ? ' (fallback: whole page text, trim the JD)' : ''}${d.err ? ' | error: ' + d.err : ''}`;
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

// ---------- template rendering ----------
function render(tpl, job) {
  const val = (k) => {
    let v = job[k];
    if (k === 'auth_lines') return Array.isArray(v) && v.length ? v.map((l) => '- "' + l + '"').join('\n') : '- (none found)';
    if (k === 'date') return new Date().toISOString().slice(0, 10);
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

// ---------- saved jobs ----------
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

async function renderSaved() {
  const jobs = await store.getJobs();
  $('#savedCount').textContent = jobs.length;
  const list = $('#savedList');
  if (!jobs.length) { list.innerHTML = '<div class="empty">Nothing saved yet. Open a job and press Save.</div>'; return; }
  list.innerHTML = jobs.map((j, i) => `
    <div class="item" data-i="${i}">
      <div class="head"><span class="name">${esc(j.role || '(no title)')}</span><span class="muted">${esc((j.saved_at || '').slice(0, 10))}</span></div>
      <div class="meta">${esc(j.company || '')} · ${esc(j.location || '')} · ${esc(j.work_mode || '')} · ${esc(j.source || '')} · ${esc(j.sponsorship || '')}</div>
      <div class="row">
        <button data-act="load">Load</button>
        <button data-act="copy">Copy</button>
        <button data-act="open">Open</button>
        <label class="inline"><input type="checkbox" data-act="applied" ${j.applied ? 'checked' : ''}> Applied${j.applied_on ? ' ' + esc(j.applied_on) : ''}</label>
        <button data-act="delete" class="danger">Delete</button>
      </div>
    </div>`).join('');
}

async function saveCurrent() {
  const job = read();
  if (!job.link && !job.role) { toast('Nothing to save'); return; }
  const jobs = await store.getJobs();
  const key = (j) => (j.link || '') + '|' + (j.role || '') + '|' + (j.company || '');
  const idx = jobs.findIndex((j) => key(j) === key(job));
  const now = new Date().toISOString();
  const rec = Object.assign({}, idx >= 0 ? jobs[idx] : {}, job, { saved_at: idx >= 0 ? jobs[idx].saved_at : now, updated_at: now });
  delete rec._debug;
  if (idx >= 0) jobs[idx] = rec; else jobs.unshift(rec);
  await store.setJobs(jobs);
  await renderSaved();
  toast(idx >= 0 ? 'Updated saved job' : 'Saved');
}

function csvCell(v) { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
async function exportCsv() {
  const jobs = await store.getJobs();
  if (!jobs.length) { toast('Nothing to export'); return; }
  const cols = [
    ['Role', 'role'], ['Company', 'company'], ['Job Link', 'link'], ['Location', 'location'], ['Work Mode', 'work_mode'], ['Source', 'source'],
    ['Sponsorship', 'sponsorship'], ['Job Type', 'job_type'], ['Salary', 'salary'], ['Experience', 'experience'], ['Seniority', 'seniority'],
    ['Stage', (j) => (j.applied ? 'Applied' : 'Saved')], ['Applied On', 'applied_on'], ['Saved On', (j) => (j.saved_at || '').slice(0, 10)],
    ['Notes', (j) => [j.sponsorship_note, ...(j.auth_lines || [])].filter(Boolean).join(' | ')]
  ];
  const rows = [cols.map((c) => c[0]).join(',')];
  for (const j of jobs) rows.push(cols.map((c) => csvCell(typeof c[1] === 'function' ? c[1](j) : j[c[1]])).join(','));
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `jd-filler-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- wiring ----------
async function doExtract() {
  setStatus('Reading page…');
  try {
    const job = await extractFromTab();
    fill(job);
    setStatus(`Read from ${job.source}${job.company ? ' · ' + job.company : ''}`);
  } catch (e) {
    setStatus(e.message || String(e));
    if (!current) fill({ link: (await getTab())?.url || '', source: 'Other', work_mode: 'Unknown', job_type: 'Unknown', sponsorship: 'Unknown', auth_lines: [] });
  }
}

function switchTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + name));
}

document.addEventListener('DOMContentLoaded', async () => {
  $$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

  $('#copyGrok').addEventListener('click', async () => copy(render(await store.getTemplate(), read())));
  $('#copyFacts').addEventListener('click', async () => copy(render(factsTemplate(await store.getTemplate()), read())));
  $('#copyJson').addEventListener('click', () => { const j = read(); delete j._debug; copy(JSON.stringify(j, null, 2)); });
  $('#save').addEventListener('click', saveCurrent);
  $('#reextract').addEventListener('click', doExtract);

  $('#exportCsv').addEventListener('click', exportCsv);
  $('#clearSaved').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    if (b.dataset.armed) { delete b.dataset.armed; b.textContent = 'Clear all'; await store.setJobs([]); await renderSaved(); toast('Cleared'); return; }
    b.dataset.armed = '1'; b.textContent = 'Click again to confirm';
    setTimeout(() => { delete b.dataset.armed; b.textContent = 'Clear all'; }, 3000);
  });
  $('#savedList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const item = e.target.closest('.item');
    const i = Number(item.dataset.i);
    const jobs = await store.getJobs();
    const j = jobs[i];
    if (!j) return;
    const act = btn.dataset.act;
    if (act === 'load') { fill(j); switchTab('job'); setStatus('Loaded from Saved'); }
    else if (act === 'copy') copy(render(await store.getTemplate(), j));
    else if (act === 'open' && j.link) chrome.tabs.create({ url: j.link });
    else if (act === 'applied') { j.applied = btn.checked; j.applied_on = btn.checked ? new Date().toISOString().slice(0, 10) : ''; await store.setJobs(jobs); await renderSaved(); }
    else if (act === 'delete') { jobs.splice(i, 1); await store.setJobs(jobs); await renderSaved(); }
  });

  $('#template').value = await store.getTemplate();
  $('#saveTemplate').addEventListener('click', async () => { await store.setTemplate($('#template').value); toast('Template saved'); });
  $('#resetTemplate').addEventListener('click', async () => { $('#template').value = DEFAULT_TEMPLATE; await store.setTemplate(DEFAULT_TEMPLATE); toast('Template reset'); });

  $('#f_jd').addEventListener('input', () => { $('#jdLen').textContent = `(${$('#f_jd').value.length} chars)`; });

  await renderSaved();
  await doExtract();
});
