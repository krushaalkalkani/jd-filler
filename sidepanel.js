// sidepanel.js - the JD Filler side panel. Follows the active tab, reads the job, runs the rule check,
// asks Claude for a score, logs to Notion, and pushes the score to the edge tab on the page.
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const FIELDS = ['company', 'role', 'link', 'source', 'location', 'work_mode', 'job_type', 'salary', 'experience', 'sponsorship', 'seniority', 'sponsorship_note', 'posted', 'applicants', 'auth_lines', 'jd'];
const OPT_START = '2026-09-12'; // unemployment day 1
const OPT_LIMIT = 90;
const RING_C = 2 * Math.PI * 34; // ring circumference (r = 34)
let SCHOOL = 'Florida Atlantic University';
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
const DEFAULT_SETTINGS = { anthropicKey: '', notionToken: '', notionDataSourceId: '42d52ecb-1841-82ad-939d-87b508593635', notionDatabaseId: '54352ecb18418259b0fc817076dabcbc', autoLog: true, autoLogMin: 70, autoCheck: false, deep: false, edgeTab: 'jobs' };
const bandFor = (score) => (score >= 70 ? 'APPLY' : score >= 40 ? 'MAYBE' : 'SKIP');
const bandWord = { APPLY: 'Apply', MAYBE: 'Maybe', SKIP: 'Skip' };
// A verdict saved by an older build has a band but no score; map it so the ring and badges still render.
function normalizeVerdict(v) {
  if (!v) return v;
  if (typeof v.score !== 'number' || Number.isNaN(v.score)) {
    const n = Number(v.score);
    v.score = Number.isFinite(n) && String(v.score).trim() !== '' ? Math.max(0, Math.min(100, Math.round(n))) : ({ APPLY: 80, MAYBE: 55, SKIP: 15 }[v.verdict] ?? 0);
  }
  v.verdict = bandFor(v.score);
  return v;
}
// The background service worker keeps running the old code after a `git pull` until the extension is reloaded.
function warnIfStale(res) {
  const mine = chrome.runtime.getManifest().version;
  if (res && res.version && res.version !== mine) toast('Extension files changed: reload it at chrome://extensions', 6000);
  else if (res && res.ok && !res.version) toast('Extension files changed: reload it at chrome://extensions', 6000);
}

// ---------- state ----------
let current = null;    // last extracted/edited job
let lastRules = null;
let lastVerdict = null;
let lastMeta = null;
let notionPage = null; // {id,url} for the current job
let notionState = null; // {cls, html} so it survives tab switches
let windowId = null;
let activeTab = null;  // {id, url} the panel is showing
const cache = new Map(); // `${tabId}|${url}` -> snapshot of the job view

// ---------- icons (20x20 stroke paths) ----------
const ICON = {
  pin: '<path d="M10 17s-5.5-4.6-5.5-8.8a5.5 5.5 0 0 1 11 0C15.5 12.4 10 17 10 17z"/><circle cx="10" cy="8.3" r="1.9"/>',
  home: '<path d="M3.5 9 10 3.5 16.5 9v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"/><path d="M8 17v-5h4v5"/>',
  building: '<rect x="4" y="3" width="12" height="14" rx="1.5"/><path d="M7.5 6.5h1M11.5 6.5h1M7.5 9.5h1M11.5 9.5h1M8.5 17v-3h3v3"/>',
  globe: '<circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3a10.5 10.5 0 0 1 0 14M10 3a10.5 10.5 0 0 0 0 14"/>',
  bag: '<rect x="3" y="6" width="14" height="10.5" rx="2"/><path d="M7.5 6V4.5A1.5 1.5 0 0 1 9 3h2a1.5 1.5 0 0 1 1.5 1.5V6"/>',
  money: '<rect x="2.5" y="5" width="15" height="10" rx="2"/><circle cx="10" cy="10" r="2.2"/>',
  ladder: '<path d="M4 16h4v-4h4V8h4V4"/>',
  clock: '<circle cx="10" cy="10" r="7"/><path d="M10 6v4l2.5 1.5"/>',
  users: '<circle cx="7.5" cy="7" r="2.6"/><path d="M2.8 16a4.7 4.7 0 0 1 9.4 0"/><path d="M13 4.6a2.6 2.6 0 0 1 0 4.9M14.5 11.6a4.7 4.7 0 0 1 2.7 4.4"/>',
  shield: '<path d="M10 2.8 4 5v4.6c0 3.6 2.5 6.4 6 7.6 3.5-1.2 6-4 6-7.6V5z"/>',
  up: '<path d="M10 15V5M5.5 9.5 10 5l4.5 4.5"/>',
  ban: '<circle cx="10" cy="10" r="6.5"/><path d="m5.4 14.6 9.2-9.2"/>',
  check: '<path d="m5 10.5 3.2 3L15 6.5"/>',
  alert: '<path d="M10 3.2 2.6 16h14.8z"/><path d="M10 8.5v3.3M10 14v.01"/>',
  info: '<circle cx="10" cy="10" r="7"/><path d="M10 9v4.5M10 6.5v.01"/>',
  ext: '<path d="M11 4h5v5M16 4l-7 7M14 11.5V15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3.5"/>',
  search: '<circle cx="9" cy="9" r="5"/><path d="m13 13 3.5 3.5"/>',
  grad: '<path d="M2.5 8 10 4.5 17.5 8 10 11.5z"/><path d="M5.5 9.5V13c1.3 1.3 2.8 2 4.5 2s3.2-.7 4.5-2V9.5"/>',
  star: '<path d="M10 3.2 11.9 7.6 16.6 8 13 11.1 14.1 15.8 10 13.3 5.9 15.8 7 11.1 3.4 8 8.1 7.6z"/>'
};
const ico = (name) => `<svg viewBox="0 0 20 20" aria-hidden="true">${ICON[name] || ''}</svg>`;

// ---------- small utils ----------
function toast(msg, ms) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms || 1600);
}
function setStatus(msg, state) {
  $('#status').textContent = msg;
  $('#liveDot').className = 'live' + (state ? ' ' + state : '');
}
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
function send(msg) { return chrome.runtime.sendMessage(msg); }
const said = (x) => { const t = (x == null ? '' : String(x)).trim(); return t && !/^(not stated|unknown|none|n\/a|-)$/i.test(t) ? t : ''; };

// ---------- storage ----------
const store = {
  async getTemplate() { const r = await chrome.storage.sync.get('template'); return r.template || DEFAULT_TEMPLATE; },
  async setTemplate(t) { await chrome.storage.sync.set({ template: t }); },
  async getSettings() { const r = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS)); return Object.assign({}, DEFAULT_SETTINGS, r); },
  async setSettings(patch) { await chrome.storage.local.set(patch); }
};

// ---------- tabs ----------
async function getTab() {
  const q = windowId != null ? { active: true, windowId } : { active: true, currentWindow: true };
  const [tab] = await chrome.tabs.query(q);
  return tab;
}
const keyFor = (tab) => (tab ? `${tab.id}|${tab.url}` : '');
// Tell the edge tab on the page what the score is (null clears it). Pages without the content script just ignore it.
function pushScore(tabId, verdict) {
  if (tabId == null || !chrome.tabs.sendMessage) return;
  const score = verdict && typeof verdict.score === 'number' ? verdict.score : null;
  try { chrome.tabs.sendMessage(tabId, { type: 'jdf.score', score, band: score == null ? null : bandFor(score) }).catch(() => {}); } catch (e) { /* no receiver */ }
}

// ---------- extraction ----------
function scoreResult(r) {
  let s = (r.jd || '').length;
  if (r.role) s += 1000;
  if (r.company) s += 500;
  if (r._debug && r._debug.jsonld) s += 5000;
  if (r._debug && r._debug.extractor !== 'generic') s += 5000;
  if (r._debug && r._debug.from_body) s -= 4000;
  // reCAPTCHA / challenge iframes must never beat the real Ashby (or other ATS) frame.
  if (/recaptcha|captcha|cloudflare|attention required|just a moment|enable javascript/i.test(r.role || '')) s -= 20000;
  if (/recaptcha|captcha/i.test((r.jd || '').slice(0, 400)) && (r.jd || '').length < 800) s -= 10000;
  return s;
}

async function extractFromTab(tab) {
  if (!tab || !/^https?:/.test(tab.url || '')) throw Object.assign(new Error('This tab is not a web page. Open a job posting and the panel will read it.'), { empty: true });
  const run = async (allFrames) => {
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames }, files: ['extractor.js'] });
    return chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames }, func: () => (window.__jdFillerExtract ? window.__jdFillerExtract() : null) });
  };
  let results;
  try { results = await run(true); } catch (e) { results = await run(false); }
  const items = (results || []).map((r) => r && r.result).filter(Boolean);
  if (!items.length) throw Object.assign(new Error('Chrome does not let extensions read this page (Web Store, chrome:// and some PDFs).'), { empty: true });
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
  $('#jdLen').textContent = job.jd ? `${job.jd.length.toLocaleString()} chars` : 'empty';
  const d = job._debug || {};
  $('#debug').textContent = `Read via ${d.extractor || 'generic'}${d.jsonld ? ' + JSON-LD' : ''}${d.from_body ? ' · fallback: whole page text, trim the JD' : ''}${d.err ? ' · error: ' + d.err : ''}`;
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
  return s.replace(/,000\b/g, 'K').replace(/\s*\/\s*year/i, '/yr').replace(/\s*per year\.?/i, '/yr').replace(/\s*(?:-|–|—|to)\s*/, '–').replace(/USD\s?/i, '$').replace(/\$\$/g, '$');
}
function avatarColor(name) {
  let h = 0;
  for (const c of name || '') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 52% 46%)`;
}
function renderHero(job) {
  const co = (job.company || '').trim();
  $('#h_role').textContent = job.role || 'No title found';
  $('#h_company').textContent = co;
  $('#h_location').textContent = job.location || '';
  $('#h_sep').hidden = !(co && job.location);
  const av = $('#h_avatar');
  av.textContent = (co.match(/[A-Za-z0-9]/) || ['?'])[0].toUpperCase();
  av.style.setProperty('--av', co ? avatarColor(co) : '');
  const chips = [];
  const modeIcon = { Remote: 'globe', Hybrid: 'home', 'On-site': 'building' };
  if (job.work_mode && job.work_mode !== 'Unknown') chips.push([modeIcon[job.work_mode] || 'pin', job.work_mode]);
  if (job.job_type && job.job_type !== 'Unknown') chips.push(['bag', job.job_type]);
  const sal = shortSalary(job.salary); if (sal) chips.push(['money', sal]);
  if (job.experience && job.experience !== 'Not stated') chips.push(['ladder', job.experience]);
  if (job.posted) chips.push(['clock', job.posted]);
  if (job.applicants) chips.push(['users', job.applicants]);
  const sp = job.sponsorship === 'Sponsors' ? ['Sponsors visa', 'apply'] : job.sponsorship === 'No sponsorship' ? ['No sponsorship', 'maybe'] : null;
  $('#h_chips').innerHTML = (sp ? `<span class="chip ${sp[1]}">${ico('shield')}${esc(sp[0])}</span>` : '') + chips.map(([i, c]) => `<span class="chip">${ico(i)}${esc(c)}</span>`).join('');
  const q = encodeURIComponent;
  $('#research').hidden = !co;
  $('#r_company').textContent = co;
  $('#h_links').innerHTML = co ? [
    [`https://www.google.com/search?q=${q(co + ' H-1B sponsorship history h1bgrader')}`, 'H-1B history', 'shield'],
    [`https://www.linkedin.com/search/results/people/?keywords=${q(co + ' ' + SCHOOL)}`, 'Alumni there', 'grad'],
    [`https://www.linkedin.com/search/results/people/?keywords=${q(co + ' recruiter')}`, 'Recruiters', 'users'],
    [`https://www.glassdoor.com/Search/results.htm?keyword=${q(co)}`, 'Glassdoor', 'star'],
    [`https://www.google.com/search?q=${q(co + ' e-verify employer')}`, 'E-Verify', 'check']
  ].map(([href, text, i]) => `<a href="${href}" target="_blank" rel="noopener" title="${esc(text)}">${ico(i)}<span>${esc(text)}</span></a>`).join('') : '';
}

// ---------- template rendering ----------
function render(tpl, job) {
  const val = (k) => {
    const v = job[k];
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
  const head = idx === -1 ? lines : lines.slice(0, idx);
  while (head.length && /^\s*$|^[-=_\s]*(?:job description)?[-=_\s]*$/i.test(head[head.length - 1])) head.pop();
  return head.join('\n');
}
function resumePrompt(job) {
  const v = lastVerdict || {};
  const lines = [
    'Tailor my resume for this job. Use only my real experience; do not add tools or results I have not listed.',
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
  const item = (h) => `<b>${esc(h.rule)}</b><span class="q">“${esc(h.quote)}”</span>`;
  let html = '';
  if (lastRules.skip.length) html += `<div class="banner skip"><svg class="b-ico" viewBox="0 0 20 20">${ICON.ban}</svg><div class="body"><span class="head">Auto-skip</span>${lastRules.skip.map(item).join('')}</div></div>`;
  if (lastRules.maybe.length) html += `<div class="banner maybe"><svg class="b-ico" viewBox="0 0 20 20">${ICON.alert}</svg><div class="body"><span class="head">Worth a second look</span>${lastRules.maybe.map(item).join('')}</div></div>`;
  $('#rules').innerHTML = html;
  return lastRules;
}

// ---------- score card ----------
const IDLE_REASON = 'Claude reads the description against your profile and returns a 0–100 apply score.';
function setScore(state, v) {
  const card = $('#scoreCard');
  const fill = $('#ringFill');
  const num = $('#ringText');
  const unit = $('#ringUnit');
  const facts = $('#scoreFacts');
  if (state === 'busy') {
    card.dataset.band = 'busy';
    num.textContent = ''; unit.textContent = '';
    $('#scoreBand').textContent = 'Scoring…';
    $('#scoreReason').textContent = `Opus 5.5 is reading the description${$('#deep').checked ? ' at xhigh effort' : ''}.`;
    facts.innerHTML = '';
    return;
  }
  if (state === 'empty' || !v || typeof v.score !== 'number') {
    card.dataset.band = 'empty';
    fill.style.strokeDashoffset = RING_C;
    num.textContent = '—'; unit.textContent = '';
    $('#scoreBand').textContent = 'Not scored';
    $('#scoreReason').textContent = IDLE_REASON;
    facts.innerHTML = '';
    $('#checkLabel').textContent = 'Check fit';
    return;
  }
  const band = bandFor(v.score);
  card.dataset.band = band;
  num.textContent = v.score; unit.textContent = '%';
  requestAnimationFrame(() => { fill.style.strokeDashoffset = RING_C * (1 - v.score / 100); });
  $('#scoreBand').textContent = `${bandWord[band]}`;
  $('#scoreReason').textContent = v.reason || '';
  facts.innerHTML = [said(v.level), said(v.job_type), said(v.years_asked) && `asks ${said(v.years_asked)}`, said(v.pay)].filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join('');
  $('#checkLabel').textContent = 'Check again';
}

function authClass(s) {
  if (/sponsors visa|opt\/cpt ok/i.test(s)) return 'apply';
  if (/citizens only/i.test(s)) return 'skip';
  if (/no sponsorship/i.test(s)) return 'maybe';
  return '';
}

function verdictHtml(v, meta) {
  const quotes = (v.auth && v.auth.quotes || []).filter(Boolean);
  const authS = said(v.auth && v.auth.sponsorship) || 'Not mentioned';
  const fit = (v.fit || []).slice(0, 5);
  const flags = (v.red_flags || []).filter(Boolean);
  const kws = (v.keywords || []).filter(Boolean);
  const strat = [
    ['lead', 'up', 'Lead with', said(v.lead_with)],
    ['avoid', 'ban', "Don't claim", said(v.dont_claim)],
    ['next', 'check', 'Do now', said(v.do_now)]
  ].filter((s) => s[3]);
  const blocks = [];
  blocks.push(`<section class="card block reveal">
      <div class="block-title">Work authorization</div>
      <div class="auth-status"><span class="pill ${authClass(authS)}">${esc(authS)}</span><span class="muted">OPT day ${optDay()} of ${OPT_LIMIT}</span></div>
      ${quotes.map((q) => `<blockquote class="quote">“${esc(q)}”</blockquote>`).join('')}
    </section>`);
  if (fit.length) {
    blocks.push(`<section class="card block reveal">
      <div class="block-title">Fit<span class="count">${fit.length} key requirements</span></div>
      <ul class="fit-list">${fit.map((f) => { const l = String(f.level || '').toLowerCase(); return `<li class="fit-item"><span class="fit-text">${esc(f.point)}</span><span class="meter ${esc(l)}"><i></i><i></i><i></i></span><span class="level ${esc(l)}">${esc(f.level)}</span></li>`; }).join('')}</ul>
    </section>`);
  }
  if (strat.length) {
    blocks.push(`<section class="card block reveal"><div class="block-title">Strategy</div><div class="strategy">${strat.map(([cls, i, k, val]) => `<div class="strat ${cls}"><span class="strat-ico">${ico(i)}</span><div><div class="strat-k">${k}</div><div class="strat-v">${esc(val)}</div></div></div>`).join('')}</div></section>`);
  }
  if (kws.length) {
    blocks.push(`<section class="card block reveal"><div class="block-title">ATS keywords<button id="copyKw" class="btn ghost">Copy all</button></div><div class="kw">${kws.map((k) => `<span class="chip">${esc(k)}</span>`).join('')}</div></section>`);
  }
  if (flags.length) {
    blocks.push(`<section class="card block flagged reveal"><div class="block-title">Red flags<span class="count">${flags.length}</span></div><ul class="flags">${flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></section>`);
  }
  if (meta) blocks.push(`<div class="meta">${esc(meta.model)} · ${esc(meta.effort || (meta.deep ? 'xhigh' : 'medium'))} · ${(meta.ms / 1000).toFixed(1)}s · ${Number(meta.input).toLocaleString()} in / ${Number(meta.output).toLocaleString()} out${meta.cache_read ? ' · cache hit' : meta.cache_write ? ' · cache written' : ''}</div>`);
  return blocks.join('');
}

function showVerdict(v, meta) {
  $('#verdict').innerHTML = verdictHtml(v, meta);
  setScore('done', v);
  const kwBtn = $('#copyKw');
  if (kwBtn) kwBtn.addEventListener('click', () => copy((v.keywords || []).join(', '), 'Keywords copied'));
}

function errorCard(prefix, err, retryId) {
  return `<section class="card error-row"><span class="err">${esc(prefix)} ${esc(err)}</span><button id="${retryId}" class="btn secondary sm">Retry</button></section>`;
}

async function doCheck() {
  const job = read();
  if (!job.jd && !job.role) { toast('Nothing to check yet'); return; }
  const tabAtStart = activeTab;
  const rules = runRules();
  const settings = await store.getSettings();
  const deep = $('#deep').checked;
  $('#verdict').innerHTML = `<section class="card skeleton"><div class="sk-title"><span class="dots"><b></b><b></b><b></b></span>Scoring with Opus 5.5${deep ? ' · Deep' : ''}</div><i></i><i></i><i></i><i></i><i></i></section>`;
  setScore('busy');
  setStatus('Scoring…', 'busy');
  $('#check').disabled = true;
  try {
    const res = await send({ type: 'claude.verdict', job: stripForApi(job), rules, deep });
    if (!res || !res.ok) throw Object.assign(new Error((res && res.error) || 'No response from background'), { retryable: res && res.retryable });
    warnIfStale(res);
    normalizeVerdict(res.verdict);
    // The user may have switched tabs while Claude was thinking: file the result under the tab it belongs to.
    if (tabAtStart && activeTab && keyFor(tabAtStart) !== keyFor(activeTab)) {
      const snap = cache.get(keyFor(tabAtStart));
      if (snap) { snap.verdict = res.verdict; snap.meta = res.meta; }
      pushScore(tabAtStart.id, res.verdict);
      return;
    }
    lastVerdict = res.verdict; lastMeta = Object.assign({ deep }, res.meta);
    current = Object.assign(current || {}, { verdict: res.verdict, verdict_meta: res.meta });
    showVerdict(lastVerdict, lastMeta);
    pushScore(activeTab && activeTab.id, lastVerdict);
    setStatus(`Read from ${job.source || 'page'}`, 'on');
    saveSnapshot();
    const score = typeof res.verdict.score === 'number' ? res.verdict.score : 0;
    if (settings.autoLog && score >= Number(settings.autoLogMin || 70)) await logToNotion(true);
  } catch (e) {
    $('#verdict').innerHTML = errorCard('Claude:', e.message, 'retryCheck');
    setScore('empty');
    setStatus('Scoring failed', 'err');
    $('#retryCheck').addEventListener('click', doCheck);
  } finally {
    $('#check').disabled = false;
    if (!lastVerdict) $('#checkLabel').textContent = 'Check fit';
  }
}

function stripForApi(job) {
  const j = Object.assign({}, job);
  delete j._debug; delete j.verdict; delete j.verdict_meta;
  return j;
}

// ---------- Notion ----------
function notionLine(html, cls) {
  notionState = html ? { html, cls: cls || '' } : null;
  const el = $('#notion');
  el.className = 'notion' + (cls ? ' ' + cls : '');
  el.innerHTML = html || '';
}

async function logToNotion(auto) {
  const job = read();
  if (!job.link) { toast('No job link to log'); return; }
  notionLine(auto ? 'Score clears your threshold, logging to Notion…' : 'Logging to Notion…', 'busy');
  $('#logNotion').disabled = true;
  try {
    const res = await send({ type: 'notion.create', job: stripForApi(job), verdict: lastVerdict });
    if (!res || !res.ok) throw new Error((res && res.error) || 'No response from background');
    notionPage = res.page;
    const link = res.page.url ? `<a href="${esc(res.page.url)}" target="_blank" rel="noopener">Open in Notion ↗</a>` : '';
    if (res.exists) {
      notionLine(`Already in your tracker. ${link}`, 'ok');
    } else {
      notionLine(`Logged to Notion. ${link} <button id="undoNotion" class="btn ghost danger">Undo</button>`, 'ok');
      toast('Logged to Notion');
    }
  } catch (e) {
    notionLine(`<span class="err">Notion: ${esc(e.message)}</span> <button id="retryNotion" class="btn ghost">Retry</button>`, 'err');
  } finally {
    $('#logNotion').disabled = false;
    saveSnapshot();
  }
}

async function undoNotion() {
  if (!notionPage) return;
  notionLine('Removing from Notion…', 'busy');
  try {
    const res = await send({ type: 'notion.trash', pageId: notionPage.id });
    if (!res || !res.ok) throw new Error((res && res.error) || 'No response');
    notionPage = null;
    notionLine('Removed from Notion (moved to trash).');
  } catch (e) {
    notionLine(`<span class="err">Undo failed: ${esc(e.message)}</span> <button id="retryUndo" class="btn ghost">Retry</button>`, 'err');
  }
  saveSnapshot();
}

async function checkAlreadyLogged(link, key) {
  const s = await store.getSettings();
  if (!s.notionToken || !link) return;
  try {
    const res = await send({ type: 'notion.find', link });
    if (res && res.ok && res.page && key === keyFor(activeTab)) {
      notionPage = res.page;
      notionLine(`Already in your tracker. <a href="${esc(res.page.url)}" target="_blank" rel="noopener">Open ↗</a>`, 'ok');
      saveSnapshot();
    }
  } catch (e) { /* quiet */ }
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
      d.querySelectorAll('#jdf-edge-tab').forEach((e) => e.remove());
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
function setSeg(root, attr, value) {
  root.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset[attr] === value)));
}
async function loadSettings() {
  const s = await store.getSettings();
  $('#s_anthropicKey').value = s.anthropicKey;
  $('#s_notionToken').value = s.notionToken;
  $('#s_notionDataSourceId').value = s.notionDataSourceId;
  $('#s_notionDatabaseId').value = s.notionDatabaseId;
  $('#s_autoLog').checked = !!s.autoLog;
  $('#s_autoLogMin').value = s.autoLogMin;
  $('#s_autoCheck').checked = !!s.autoCheck;
  $('#deep').checked = !!s.deep;
  setSeg($('#depth'), 'depth', s.deep ? 'deep' : 'std');
  setSeg($('#edgeTabSeg'), 'edge', s.edgeTab || 'jobs');
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
    autoCheck: $('#s_autoCheck').checked
  });
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

// ---------- per-tab snapshots ----------
function saveSnapshot() {
  if (!activeTab || !current) return;
  cache.set(keyFor(activeTab), { job: read(), verdict: lastVerdict, meta: lastMeta, notionPage, notionState, rules: lastRules });
  if (cache.size > 40) cache.delete(cache.keys().next().value);
}
function resetJobView() {
  $('#verdict').innerHTML = ''; notionLine(''); lastVerdict = null; lastMeta = null; notionPage = null; setScore('empty');
}
function showEmpty(msg) {
  document.body.classList.add('empty');
  $('#emptyState').hidden = false;
  $('#emptyMsg').textContent = msg;
}
function hideEmpty() {
  document.body.classList.remove('empty');
  $('#emptyState').hidden = true;
}
function restore(snap) {
  hideEmpty();
  resetJobView();
  fill(snap.job);
  runRules();
  lastVerdict = snap.verdict || null; lastMeta = snap.meta || null; notionPage = snap.notionPage || null;
  if (lastVerdict) showVerdict(lastVerdict, lastMeta);
  if (snap.notionState) notionLine(snap.notionState.html, snap.notionState.cls);
  setStatus(`Read from ${snap.job.source || 'page'}`, 'on');
  pushScore(activeTab && activeTab.id, lastVerdict);
}

let loadSeq = 0;
async function loadActiveTab(force) {
  const seq = ++loadSeq;
  saveSnapshot();
  const tab = await getTab();
  if (seq !== loadSeq) return;
  activeTab = tab ? { id: tab.id, url: tab.url } : null;
  const snap = !force && cache.get(keyFor(activeTab));
  if (snap) { restore(snap); return; }
  setStatus('Reading page…', 'busy');
  $('#reextract').classList.add('spin');
  try {
    const job = await extractFromTab(tab);
    if (seq !== loadSeq) return;
    hideEmpty();
    resetJobView();
    fill(job);
    setStatus(`Read from ${job.source}`, 'on');
    runRules();
    pushScore(tab.id, null);
    saveSnapshot();
    checkAlreadyLogged(job.link, keyFor(activeTab));
    const s = await store.getSettings();
    if (s.autoCheck && s.anthropicKey && (job.jd || job.role)) doCheck();
  } catch (e) {
    if (seq !== loadSeq) return;
    if (e.empty) { showEmpty(e.message); setStatus('No job on this tab'); }
    else { setStatus(e.message || String(e), 'err'); }
    if (!current) fill({ link: (tab && tab.url) || '', source: 'Other', work_mode: 'Unknown', job_type: 'Unknown', sponsorship: 'Unknown', auth_lines: [] });
  } finally {
    if (seq === loadSeq) $('#reextract').classList.remove('spin');
  }
}

// ---------- views ----------
function showView(name) {
  const settings = name === 'settings';
  document.body.classList.toggle('settings', settings);
  $('#view-job').classList.toggle('active', !settings);
  $('#view-settings').classList.toggle('active', settings);
  $('#closeSettings').hidden = !settings;
  $('#jobActions').hidden = settings;
  $('#brand .mark').hidden = settings;
  $('#viewTitle').textContent = settings ? 'Settings' : 'JD Filler';
  window.scrollTo(0, 0);
}

function renderOpt() {
  const d = optDay();
  const pct = Math.max(0, Math.min(100, (d / OPT_LIMIT) * 100));
  $('#optFill').style.width = pct + '%';
  $('#opt').dataset.level = d > 75 ? 'high' : d > 45 ? 'mid' : 'low';
  $('#optDay').textContent = `Day ${d} / ${OPT_LIMIT} · ${Math.max(0, OPT_LIMIT - d)} left`;
}

// ---------- wiring ----------
document.addEventListener('DOMContentLoaded', async () => {
  renderOpt();

  // The panel lives in one window. Tell the background so the edge tab can show "open", and follow that window's tabs.
  try { if (chrome.windows) windowId = (await chrome.windows.getCurrent()).id; } catch (e) { /* harness */ }
  try { if (windowId != null && chrome.runtime.connect) chrome.runtime.connect({ name: `panel:${windowId}` }); } catch (e) { /* harness */ }
  if (chrome.tabs.onActivated) {
    chrome.tabs.onActivated.addListener((info) => { if (windowId == null || info.windowId === windowId) loadActiveTab(); });
    let t = null;
    chrome.tabs.onUpdated.addListener((tabId, change) => {
      if (!activeTab || tabId !== activeTab.id) return;
      // SPAs (LinkedIn) change the URL first and render the new job a moment later.
      if (change.url && change.url !== activeTab.url) { clearTimeout(t); t = setTimeout(() => loadActiveTab(), 900); }
      else if (change.status === 'complete' && document.body.classList.contains('empty')) { clearTimeout(t); t = setTimeout(() => loadActiveTab(true), 300); }
    });
    chrome.tabs.onRemoved.addListener((tabId) => { for (const k of cache.keys()) if (k.startsWith(tabId + '|')) cache.delete(k); });
  }

  $('#openSettings').addEventListener('click', () => showView('settings'));
  $('#closeSettings').addEventListener('click', () => showView('job'));
  $('#check').addEventListener('click', doCheck);
  $('#ringBtn').addEventListener('click', () => { if (!$('#check').disabled) doCheck(); });
  $('#depth').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const deep = b.dataset.depth === 'deep';
    $('#deep').checked = deep; setSeg($('#depth'), 'depth', b.dataset.depth);
    store.setSettings({ deep });
  });
  $('#edgeTabSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    setSeg($('#edgeTabSeg'), 'edge', b.dataset.edge);
    store.setSettings({ edgeTab: b.dataset.edge });
    toast(b.dataset.edge === 'off' ? 'Edge tab hidden' : b.dataset.edge === 'always' ? 'Edge tab on every page' : 'Edge tab on job pages');
  });

  const menu = $('#moreMenu'); const moreBtn = $('#moreBtn');
  const showMenu = (on) => { menu.hidden = !on; moreBtn.setAttribute('aria-expanded', String(on)); };
  moreBtn.addEventListener('click', (e) => { e.stopPropagation(); showMenu(menu.hidden); });
  menu.addEventListener('click', (e) => { if (e.target.closest('button, a')) showMenu(false); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu-wrap')) showMenu(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { showMenu(false); if (document.body.classList.contains('settings')) showView('job'); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !document.body.classList.contains('settings')) { e.preventDefault(); if (!$('#check').disabled) doCheck(); }
  });

  // Delegated so buttons re-created by notionLine() keep working.
  $('#notion').addEventListener('click', (e) => {
    const id = e.target.closest('button') && e.target.closest('button').id;
    if (id === 'undoNotion') undoNotion();
    if (id === 'retryNotion') logToNotion(false);
    if (id === 'retryUndo') undoNotion();
  });

  $('#logNotion').addEventListener('click', () => logToNotion(false));
  $('#copyResume').addEventListener('click', () => copy(resumePrompt(read()), 'Resume prompt copied'));
  $('#copy').addEventListener('click', async () => copy(render(await store.getTemplate(), read()), 'Copied: facts + JD'));
  $('#copyFacts').addEventListener('click', async () => copy(render(factsTemplate(await store.getTemplate()), read()), 'Facts copied'));
  $('#copyJson').addEventListener('click', () => { const j = read(); delete j._debug; if (lastVerdict) j.verdict = lastVerdict; copy(JSON.stringify(j, null, 2), 'JSON copied'); });
  $('#reextract').addEventListener('click', () => loadActiveTab(true));
  $('#emptyRetry').addEventListener('click', () => loadActiveTab(true));
  ['#f_jd', '#f_role', '#f_salary'].forEach((sel) => $(sel).addEventListener('change', () => { runRules(); renderHero(read()); saveSnapshot(); }));
  ['#f_company', '#f_location', '#f_work_mode', '#f_job_type', '#f_sponsorship', '#f_posted', '#f_applicants', '#f_experience', '#f_source'].forEach((sel) => $(sel).addEventListener('change', () => { renderHero(read()); saveSnapshot(); }));

  $('#template').value = await store.getTemplate();
  $('#saveTemplate').addEventListener('click', async () => { await store.setTemplate($('#template').value); toast('Template saved'); });
  $('#resetTemplate').addEventListener('click', async () => { $('#template').value = DEFAULT_TEMPLATE; await store.setTemplate(DEFAULT_TEMPLATE); toast('Template reset'); });
  $('#saveSettings').addEventListener('click', async () => { await saveSettings(); toast('Settings saved'); });
  $('#testClaude').addEventListener('click', (e) => testKey('claude.test', e.currentTarget));
  $('#testNotion').addEventListener('click', (e) => testKey('notion.test', e.currentTarget));
  $('#saveFixture').addEventListener('click', saveFixture);
  $('#f_jd').addEventListener('input', () => { $('#jdLen').textContent = `${$('#f_jd').value.length.toLocaleString()} chars`; });

  $('#openProfile').addEventListener('click', () => chrome.runtime.openOptionsPage());
  try { const { profile } = await chrome.storage.local.get('profile'); const sch = profile && profile.education && profile.education[0] && profile.education[0].school; if (sch) SCHOOL = sch; } catch (e) { /* ignore */ }
  await loadSettings();
  await loadActiveTab();
});
