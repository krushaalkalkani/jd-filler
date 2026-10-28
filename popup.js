// popup.js - reads the job from the active tab, runs the rule check, asks Claude, logs to Notion.
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const FIELDS = ['company', 'role', 'link', 'source', 'location', 'work_mode', 'job_type', 'salary', 'experience', 'sponsorship', 'seniority', 'sponsorship_note', 'posted', 'applicants', 'auth_lines', 'jd'];
const OPT_START = '2026-09-12'; // unemployment day 1
const OPT_LIMIT = 90;
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
const DEFAULT_SETTINGS = { anthropicKey: '', notionToken: '', notionDataSourceId: '42d52ecb-1841-82ad-939d-87b508593635', notionDatabaseId: '54352ecb18418259b0fc817076dabcbc', autoLog: true, autoCheck: false, deep: false };

let current = null;   // last extracted/edited job
let lastRules = null; // last rule result
let lastVerdict = null;
let notionPage = null; // {id,url} for the current job

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
function optDay() {
  const start = new Date(OPT_START + 'T00:00:00');
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.floor((now - start) / 86400000) + 1;
}
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

// ---------- rules banner ----------
function runRules() {
  const job = read();
  lastRules = window.JDRules ? window.JDRules.check(job) : { skip: [], maybe: [] };
  const box = $('#rules');
  const item = (h) => `<b>${esc(h.rule)}</b><span class="q">"${esc(h.quote)}"</span>`;
  let html = '';
  if (lastRules.skip.length) html += `<div class="banner skip"><b>AUTO-SKIP (${lastRules.skip.length})</b>${lastRules.skip.map(item).join('')}</div>`;
  if (lastRules.maybe.length) html += `<div class="banner maybe"><b>MAYBE (${lastRules.maybe.length})</b>${lastRules.maybe.map(item).join('')}</div>`;
  box.innerHTML = html;
  return lastRules;
}

// ---------- Claude verdict ----------
function verdictCard(v, meta) {
  const line = (k, html) => `<div class="line"><span class="k">${k}</span> ${html}</div>`;
  const quotes = (v.auth && v.auth.quotes || []).filter(Boolean);
  const fit = (v.fit || []).slice(0, 3).map((f) => `${esc(f.point)}<span class="tag ${esc(f.level)}">${esc(f.level)}</span>`).join('; ');
  const flags = (v.red_flags || []).filter(Boolean);
  return `<div class="card ${esc(v.verdict)}">
    <div class="line"><span class="v">${esc(v.verdict)}</span> - ${esc(v.company)}, ${esc(v.role)} | ${esc(v.location)}, ${esc(v.work_mode)} | ${esc(v.pay)} | ${esc(v.level)}</div>
    ${line('Auth:', `${esc(v.auth && v.auth.sponsorship)}${quotes.length ? ' - ' + quotes.map((q) => `"${esc(q)}"`).join(' ') : ''} | OPT day ${optDay()}/${OPT_LIMIT}`)}
    ${line('Fit:', fit || '(none)')}
    ${line('Lead with:', esc(v.lead_with))}
    ${line("Don't claim:", esc(v.dont_claim))}
    ${line('Do now:', esc(v.do_now))}
    ${flags.length ? line('Red flags:', esc(flags.join('; '))) : ''}
    ${v.reason ? `<div class="line muted">${esc(v.reason)}</div>` : ''}
    <div class="meta">${esc(meta.model)} · ${(meta.ms / 1000).toFixed(1)}s · in ${meta.input} / out ${meta.output}${meta.cache_read ? ` · cache hit ${meta.cache_read}` : meta.cache_write ? ' · cache written' : ''} · years asked: ${esc(v.years_asked)} · type: ${esc(v.job_type)}</div>
  </div>`;
}

function errorBox(prefix, err, retryId) {
  return `<div class="card SKIP"><div class="line err">${esc(prefix)} ${esc(err)}</div><div class="actions" style="margin:6px 0 0"><button id="${retryId}">Retry</button></div></div>`;
}

async function doCheck() {
  const job = read();
  if (!job.jd && !job.role) { toast('Nothing to check yet'); return; }
  const rules = runRules();
  const settings = await store.getSettings();
  const deep = $('#deep').checked;
  const box = $('#verdict');
  box.innerHTML = `<div class="card"><span class="spin"></span>Checking with Opus 5.5${deep ? ' (deep, xhigh effort)' : ''}…</div>`;
  $('#check').disabled = true;
  try {
    const res = await send({ type: 'claude.verdict', job: stripForApi(job), rules, deep });
    if (!res || !res.ok) throw Object.assign(new Error((res && res.error) || 'No response from background'), { retryable: res && res.retryable });
    lastVerdict = res.verdict;
    current = Object.assign(current || {}, { verdict: res.verdict, verdict_meta: res.meta });
    box.innerHTML = verdictCard(res.verdict, res.meta);
    if (res.verdict.verdict === 'APPLY' && settings.autoLog) await logToNotion(true);
  } catch (e) {
    box.innerHTML = errorBox('Claude:', e.message, 'retryCheck');
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
  notionLine(`<span class="spin"></span>${auto ? 'APPLY - logging to Notion…' : 'Logging to Notion…'}`);
  $('#logNotion').disabled = true;
  try {
    const res = await send({ type: 'notion.create', job: stripForApi(job), verdict: lastVerdict });
    if (!res || !res.ok) throw new Error((res && res.error) || 'No response from background');
    notionPage = res.page;
    const link = res.page.url ? `<a href="${esc(res.page.url)}" target="_blank">Open in Notion</a>` : '';
    if (res.exists) {
      notionLine(`Already logged. ${link}`);
    } else {
      notionLine(`Logged to Notion. ${link} <button id="undoNotion" class="danger">Undo</button>`);
      $('#undoNotion').addEventListener('click', undoNotion);
      await markApplied(job, res.page);
      toast('Logged to Notion');
    }
  } catch (e) {
    notionLine(`<span class="err" style="color:var(--danger)">Notion: ${esc(e.message)}</span> <button id="retryNotion">Retry</button>`);
    $('#retryNotion').addEventListener('click', () => logToNotion(false));
  } finally {
    $('#logNotion').disabled = false;
  }
}

async function undoNotion() {
  if (!notionPage) return;
  notionLine(`<span class="spin"></span>Removing from Notion…`);
  try {
    const res = await send({ type: 'notion.trash', pageId: notionPage.id });
    if (!res || !res.ok) throw new Error((res && res.error) || 'No response');
    await unmarkApplied(read());
    notionPage = null;
    notionLine('Removed from Notion (moved to trash).');
  } catch (e) {
    notionLine(`<span style="color:var(--danger)">Undo failed: ${esc(e.message)}</span> <button id="retryUndo">Retry</button>`);
    $('#retryUndo').addEventListener('click', undoNotion);
  }
}

async function checkAlreadyLogged(link) {
  const s = await store.getSettings();
  if (!s.notionToken || !link) return;
  try {
    const res = await send({ type: 'notion.find', link });
    if (res && res.ok && res.page) { notionPage = res.page; notionLine(`Already in Notion. <a href="${esc(res.page.url)}" target="_blank">Open</a>`); }
  } catch (e) { /* quiet */ }
}

// ---------- saved jobs ----------
const jobKey = (j) => (j.link || '') + '|' + (j.role || '') + '|' + (j.company || '');

async function upsertSaved(job, patch) {
  const jobs = await store.getJobs();
  const idx = jobs.findIndex((j) => jobKey(j) === jobKey(job));
  const now = new Date().toISOString();
  const rec = Object.assign({}, idx >= 0 ? jobs[idx] : {}, stripForApi(job), { verdict: job.verdict || (idx >= 0 ? jobs[idx].verdict : undefined), saved_at: idx >= 0 ? jobs[idx].saved_at : now, updated_at: now }, patch || {});
  if (idx >= 0) jobs[idx] = rec; else jobs.unshift(rec);
  await store.setJobs(jobs);
  await renderSaved();
  return idx >= 0;
}
async function markApplied(job, page) {
  await upsertSaved(Object.assign({}, job, { verdict: lastVerdict }), { applied: true, applied_on: new Date().toISOString().slice(0, 10), notion_page_id: page.id, notion_url: page.url });
}
async function unmarkApplied(job) {
  await upsertSaved(job, { applied: false, applied_on: '', notion_page_id: '', notion_url: '' });
}
async function saveCurrent() {
  const job = read();
  if (!job.link && !job.role) { toast('Nothing to save'); return; }
  const existed = await upsertSaved(Object.assign({}, job, { verdict: lastVerdict || job.verdict }));
  toast(existed ? 'Updated saved job' : 'Saved');
}

async function renderSaved() {
  const jobs = await store.getJobs();
  $('#savedCount').textContent = jobs.length;
  const list = $('#savedList');
  if (!jobs.length) { list.innerHTML = '<div class="empty">Nothing saved yet. Open a job and press Save.</div>'; return; }
  list.innerHTML = jobs.map((j, i) => `
    <div class="item" data-i="${i}">
      <div class="head"><span class="name">${esc(j.role || '(no title)')} ${j.verdict ? `<span class="badge ${esc(j.verdict.verdict)}">${esc(j.verdict.verdict)}</span>` : ''}</span><span class="muted">${esc((j.saved_at || '').slice(0, 10))}</span></div>
      <div class="meta">${esc(j.company || '')} · ${esc(j.location || '')} · ${esc(j.work_mode || '')} · ${esc(j.source || '')} · ${esc(j.sponsorship || '')}${j.notion_url ? ` · <a href="${esc(j.notion_url)}" target="_blank">Notion</a>` : ''}</div>
      <div class="row">
        <button data-act="load">Load</button>
        <button data-act="copy">Copy</button>
        <button data-act="open">Open</button>
        <label class="inline"><input type="checkbox" data-act="applied" ${j.applied ? 'checked' : ''}> Applied${j.applied_on ? ' ' + esc(j.applied_on) : ''}</label>
        <button data-act="delete" class="danger">Delete</button>
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
    ['Verdict', (j) => (j.verdict ? j.verdict.verdict : '')],
    ['Stage', (j) => (j.applied ? 'Applied' : 'Saved')], ['Applied On', 'applied_on'], ['Saved On', (j) => (j.saved_at || '').slice(0, 10)], ['Notion', 'notion_url'],
    ['Notes', (j) => [j.verdict && j.verdict.reason, j.sponsorship_note, ...(j.auth_lines || [])].filter(Boolean).join(' | ')]
  ];
  const rows = [cols.map((c) => c[0]).join(',')];
  for (const j of jobs) rows.push(cols.map((c) => csvCell(typeof c[1] === 'function' ? c[1](j) : j[c[1]])).join(','));
  downloadText(rows.join('\n'), `jd-filler-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
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
  const name = (new URL(data.url).hostname.replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '-') + '-' + new Date().toISOString().slice(0, 10)).toLowerCase();
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
  $('#s_autoCheck').checked = !!s.autoCheck;
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
    autoCheck: $('#s_autoCheck').checked
  });
  $('#settingsMsg').textContent = 'Saved.';
  setTimeout(() => { $('#settingsMsg').textContent = ''; }, 1500);
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
  $('#verdict').innerHTML = ''; $('#notion').innerHTML = ''; lastVerdict = null; notionPage = null;
  try {
    const job = await extractFromTab();
    fill(job);
    setStatus(`Read from ${job.source}${job.company ? ' · ' + job.company : ''}`);
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
}

document.addEventListener('DOMContentLoaded', async () => {
  $('#optDay').textContent = `OPT day ${optDay()}/${OPT_LIMIT}`;
  $$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

  $('#check').addEventListener('click', doCheck);
  $('#deep').addEventListener('change', () => store.setSettings({ deep: $('#deep').checked }));
  $('#logNotion').addEventListener('click', () => logToNotion(false));
  $('#copyGrok').addEventListener('click', async () => copy(render(await store.getTemplate(), read())));
  $('#copyFacts').addEventListener('click', async () => copy(render(factsTemplate(await store.getTemplate()), read())));
  $('#copyJson').addEventListener('click', () => { const j = read(); delete j._debug; copy(JSON.stringify(j, null, 2)); });
  $('#save').addEventListener('click', saveCurrent);
  $('#reextract').addEventListener('click', doExtract);
  ['#f_jd', '#f_role', '#f_salary'].forEach((sel) => $(sel).addEventListener('change', runRules));

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
    if (act === 'load') { fill(j); lastVerdict = j.verdict || null; $('#verdict').innerHTML = j.verdict ? verdictCard(j.verdict, j.verdict_meta || { model: 'saved', ms: 0, input: 0, output: 0 }) : ''; notionLine(j.notion_url ? `Logged. <a href="${esc(j.notion_url)}" target="_blank">Open in Notion</a>` : ''); switchTab('job'); setStatus('Loaded from Saved'); runRules(); }
    else if (act === 'copy') copy(render(await store.getTemplate(), j));
    else if (act === 'open' && j.link) chrome.tabs.create({ url: j.link });
    else if (act === 'applied') { j.applied = btn.checked; j.applied_on = btn.checked ? new Date().toISOString().slice(0, 10) : ''; await store.setJobs(jobs); await renderSaved(); }
    else if (act === 'delete') { jobs.splice(i, 1); await store.setJobs(jobs); await renderSaved(); }
  });

  $('#template').value = await store.getTemplate();
  $('#saveTemplate').addEventListener('click', async () => { await store.setTemplate($('#template').value); toast('Template saved'); });
  $('#resetTemplate').addEventListener('click', async () => { $('#template').value = DEFAULT_TEMPLATE; await store.setTemplate(DEFAULT_TEMPLATE); toast('Template reset'); });
  $('#saveSettings').addEventListener('click', async () => { await saveSettings(); toast('Settings saved'); });
  $('#testClaude').addEventListener('click', (e) => testKey('claude.test', e.currentTarget));
  $('#testNotion').addEventListener('click', (e) => testKey('notion.test', e.currentTarget));
  $('#saveFixture').addEventListener('click', saveFixture);
  $('#f_jd').addEventListener('input', () => { $('#jdLen').textContent = `(${$('#f_jd').value.length} chars)`; });

  await loadSettings();
  await renderSaved();
  await doExtract();
});
