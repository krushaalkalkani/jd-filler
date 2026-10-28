// background.js - MV3 service worker. The only place that talks to api.anthropic.com and api.notion.com.
// Keys live in chrome.storage.local and never leave this worker except in the Authorization headers.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1';
const NOTION_URL = 'https://api.notion.com/v1';
const ANTHROPIC_VERSION = '2026-10-21';
const NOTION_VERSION = '2026-03-11';
const MODELS = { fast: 'claude-opus-5-5', deep: 'claude-opus-5-5' }; // Deep = same Opus at higher effort
const EFFORT = { fast: 'medium', deep: 'xhigh' };
const TIMEOUT_MS = 20000;
const JD_MAX_CHARS = 12000;

// ---------- profile + rules (cached system prompt) ----------
const DEFAULT_PROFILE_BLOCK = `CANDIDATE PROFILE
- MS in Computer Science, Florida Atlantic University, May 2026. On F-1 OPT, then STEM OPT, then H-1B. Does not need sponsorship to start. The answer to "will you require sponsorship in the future" is always Yes.
- Target roles: ML Engineer, AI Engineer, Applied Scientist, Data Scientist, GenAI/LLM Engineer, MLOps Engineer. Also close software roles (Software Engineer, Data Engineer, Backend/Python). Level: entry level, new grad, I, junior, associate, early career. Not Senior, Lead, Staff, Principal or III, and not 4+ years.
- Minimum pay $60K/year. Open to anywhere in the US and remote. Priority cities: SF Bay Area, LA, San Diego, NYC, Seattle, Boston, Austin, Chicago, DC, Florida.
- Evidence levels (never exceed):
  PROVEN (can lead with, mark Strong): Python, scikit-learn, XGBoost, TF-IDF/NLP, Pandas, NumPy, Streamlit, Docker, Hugging Face Spaces, Odoo, JavaScript, Bootstrap, HTML/CSS, Intel RealSense, MediaPipe, data pipelines, model evaluation.
  SKILLS LIST ONLY (mention, never lead with, mark Partial): PyTorch, TensorFlow, Keras, FastAPI, REST, SQL, RAG, LLM APIs, agents, GitHub Actions, Cursor, Claude API.
  NONE (never claim, mark Gap): Java, C++, Go, Scala, Rust, AWS, GCP, Azure, Kubernetes, Spark, LangChain, LlamaIndex, vector DBs, fine-tuning, Claude Code.
  No record (mark Gap): Airflow, CUDA, vLLM, React, TypeScript.
- Certifications: ML in Production, Agentic AI, RAG, GenAI with LLMs, ML Specialization.
- Languages: English, Hindi, Gujarati.`;

const SYSTEM_PROMPT_TEMPLATE = `You are a job-fit screener for one specific candidate. You read ONE job posting and return a strict JSON verdict.

HARD RULES
- Use only facts stated in the job description or the page facts given. If a field is not stated, return exactly "Not stated". Never invent pay, location, company, years, or work mode.
- Quote work-authorization sentences exactly as written in the JD (sponsorship, visa, H-1B, OPT, citizenship, clearance, ITAR, E-Verify, C2C).
- Never claim the candidate has more than the evidence levels below.

{{PROFILE}}

SCORING (0-100, how strongly he should apply)
- 85-100: target role, entry level, proven skills cover the core requirements, pay at or above $60K or not stated, no auth problem.
- 70-84: target or close software role, entry level, mostly proven or partial skills, nothing blocking. Still worth applying.
- 40-69: a real but weak fit: 3-4 years asked but not firm, several Gap skills, pay under $60K, 1099, contract under 6 months, seasonal, or "no visa sponsorship" (fine to start on OPT, but weaker).
- 0-39: do not apply. Any of these forces a score of at most 20: US citizen only; green card / permanent resident only; security clearance; ITAR/EAR or "U.S. person"; C2C only; PhD required (not preferred); Senior/Staff/Principal/Lead/III in the title; a firm 3+ years required ("4 years in lieu of a degree" is NOT a years requirement); unpaid; under 20 hours a week; a required language the candidate does not speak (see Languages); a role unrelated to software/data/AI.
- Rule hits listed in the page facts were found by regex and can be wrong (for example "Lead" in "Lead Generation"). Check each against the JD before letting it drive the score.

OUTPUT
- score: an integer 0-100 per the rubric. reason: one line that says what moved the score.
- auth.sponsorship: one of "Sponsors visa", "OPT/CPT OK", "Not mentioned", "No sponsorship", "US citizens only". auth.quotes: the exact sentences, or an empty list.
- fit: the top 3 requirements of the job, each mapped to the candidate's evidence with level Strong, Partial or Gap.
- lead_with: the 1-2 proven items to put first. dont_claim: what from the job he must not claim. do_now: one short action line.
- keywords: 5-8 ATS keywords taken from the JD that he can truthfully put on his resume (PROVEN or SKILLS LIST items only, never NONE items). Short, exact wording from the JD.
- red_flags: short strings, only real ones. Also flag scam signals: training fees, pay-to-work, profile marketing, personal email contact, no company name.
- Keep every string short and plain. No markdown.`;


function profileBlock(p) {
  if (!p || !p.name) return DEFAULT_PROFILE_BLOCK;
  const a = p.address || {};
  const edu = (p.education || []).map((e) => `${[e.degree, e.field].filter(Boolean).join(' in ')}, ${e.school}${e.end ? ', ' + e.end : ''}${e.gpa ? ', GPA ' + e.gpa : ''}`).join('; ');
  const exp = (p.experience || []).map((x) => `${x.title} at ${x.company}${x.start || x.end ? ` (${x.start || '?'} to ${x.end || '?'})` : ''}${x.bullets ? ': ' + String(x.bullets).replace(/\s*\n\s*/g, ' ') : ''}`).join('\n  - ');
  const sk = p.skills || {};
  const t = p.targets || {};
  const eeo = p.eeo || {};
  return `CANDIDATE PROFILE
- ${String(p.summary || p.name).replace(/\.$/, '')}. Based in ${[a.city, a.state].filter(Boolean).join(', ') || 'the US'}.
- Education: ${edu || 'Not stated'}.
- Work status: ${eeo.visa || 'Not stated'}. Authorized to work in the US now: ${eeo.authorized || 'Yes'}. Will need sponsorship later: ${eeo.sponsorship || 'Yes'}.
- Experience:
  - ${exp || 'Not stated'}
- Target roles: ${t.roles || 'Not stated'}. Level: ${t.levels || 'Entry level'}.
- Minimum pay $${Number(t.minPay || 60000).toLocaleString('en-US')}/year. Locations: ${t.locations || 'Anywhere in the US'}.
- Evidence levels (never exceed):
  PROVEN (can lead with, mark Strong): ${sk.proven || 'none listed'}.
  SKILLS LIST ONLY (mention, never lead with, mark Partial): ${sk.listed || 'none listed'}.
  NONE (never claim, mark Gap): ${sk.never || 'none listed'}.
  No record (mark Gap): ${sk.norecord || 'none listed'}.
- Certifications: ${p.certifications || 'none listed'}.
- Languages: ${p.languages || 'English'}.`;
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'reason', 'company', 'role', 'location', 'work_mode', 'pay', 'level', 'years_asked', 'job_type', 'auth', 'fit', 'lead_with', 'dont_claim', 'do_now', 'keywords', 'red_flags'],
  properties: {
    score: { type: 'integer', description: 'Apply score from 0 to 100 per the scoring rubric' },
    reason: { type: 'string' },
    company: { type: 'string' },
    role: { type: 'string' },
    location: { type: 'string' },
    work_mode: { type: 'string', enum: ['Remote', 'Hybrid', 'On-site', 'Unknown'] },
    pay: { type: 'string' },
    level: { type: 'string' },
    years_asked: { type: 'string' },
    job_type: { type: 'string' },
    auth: {
      type: 'object',
      additionalProperties: false,
      required: ['sponsorship', 'quotes'],
      properties: {
        sponsorship: { type: 'string', enum: ['Sponsors visa', 'OPT/CPT OK', 'Not mentioned', 'No sponsorship', 'US citizens only'] },
        quotes: { type: 'array', items: { type: 'string' } }
      }
    },
    fit: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['point', 'level'],
        properties: { point: { type: 'string' }, level: { type: 'string', enum: ['Strong', 'Partial', 'Gap'] } }
      }
    },
    lead_with: { type: 'string' },
    dont_claim: { type: 'string' },
    do_now: { type: 'string' },
    keywords: { type: 'array', items: { type: 'string' } },
    red_flags: { type: 'array', items: { type: 'string' } }
  }
};

// ---------- helpers ----------
async function getSettings() {
  const s = await chrome.storage.local.get(['anthropicKey', 'notionToken', 'notionDataSourceId', 'notionDatabaseId']);
  return {
    anthropicKey: (s.anthropicKey || '').trim(),
    notionToken: (s.notionToken || '').trim(),
    notionDataSourceId: (s.notionDataSourceId || '42d52ecb-1841-82ad-939d-87b508593635').trim(),
    notionDatabaseId: (s.notionDatabaseId || '54352ecb18418259b0fc817076dabcbc').trim()
  };
}

class ApiError extends Error {
  constructor(message, { code = 'error', retryable = false, status = 0 } = {}) { super(message); this.code = code; this.retryable = retryable; this.status = status; }
}

async function fetchJson(url, opts, label) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
  } catch (e) {
    clearTimeout(timer);
    if (e && e.name === 'AbortError') throw new ApiError(`${label}: timed out after 20s`, { code: 'timeout', retryable: true });
    throw new ApiError(`${label}: network error (${e && e.message ? e.message : e})`, { code: 'network', retryable: true });
  }
  clearTimeout(timer);
  let body = null;
  const text = await res.text();
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = { raw: text.slice(0, 300) }; }
  if (!res.ok) {
    const msg = (body && (body.error && (body.error.message || body.error.type))) || (body && body.message) || res.statusText || 'request failed';
    if (res.status === 401 || res.status === 403) throw new ApiError(`${label}: bad or missing key (${res.status}). ${msg}`, { code: 'auth', status: res.status });
    if (res.status === 404) throw new ApiError(`${label}: not found (404). ${msg}`, { code: 'not_found', status: 404 });
    if (res.status === 429) throw new ApiError(`${label}: rate limited (429). Wait a bit and retry. ${msg}`, { code: 'rate_limit', retryable: true, status: 429 });
    if (res.status >= 500) throw new ApiError(`${label}: server error (${res.status}). ${msg}`, { code: 'server', retryable: true, status: res.status });
    throw new ApiError(`${label}: ${msg} (${res.status})`, { code: 'bad_request', status: res.status });
  }
  return body;
}

// ---------- Anthropic ----------
// Score bands. The band drives auto-log and the Saved/CSV labels; the number is what the card shows.
const BANDS = { APPLY: 70, MAYBE: 40 };
function bandFor(score) { return score >= BANDS.APPLY ? 'APPLY' : score >= BANDS.MAYBE ? 'MAYBE' : 'SKIP'; }

function anthropicHeaders(key) {
  return {
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true'
  };
}

function buildUserMessage(job, rules) {
  const facts = [
    `Job link: ${job.link || 'Not stated'}`,
    `Source: ${job.source || 'Not stated'}`,
    `Company (from page): ${job.company || 'Not stated'}`,
    `Role (from page): ${job.role || 'Not stated'}`,
    `Location (from page): ${job.location || 'Not stated'}`,
    `Work mode (from page): ${job.work_mode || 'Unknown'}`,
    `Job type (from page): ${job.job_type || 'Unknown'}`,
    `Salary (from page): ${job.salary || 'Not stated'}`,
    `Posted: ${job.posted || 'Not stated'}`
  ].join('\n');
  const hits = rules && (rules.skip.length || rules.maybe.length)
    ? '\nRule hits found in code (verify against the JD):\n' + rules.skip.map((h) => `- SKIP ${h.rule}: "${h.quote}"`).concat(rules.maybe.map((h) => `- MAYBE ${h.rule}: "${h.quote}"`)).join('\n')
    : '';
  let jd = (job.jd || '').trim();
  if (jd.length > JD_MAX_CHARS) jd = jd.slice(0, JD_MAX_CHARS) + '\n[truncated]';
  return `PAGE FACTS\n${facts}${hits}\n\nJOB DESCRIPTION\n${jd || '(empty - the page gave no description text)'}`;
}

async function claudeVerdict({ job, rules, deep }) {
  const { anthropicKey } = await getSettings();
  if (!anthropicKey) throw new ApiError('Add your Anthropic API key in Settings.', { code: 'no_key' });
  const { profile } = await chrome.storage.local.get('profile');
  const model = deep ? MODELS.deep : MODELS.fast;
  const t0 = Date.now();
  const body = {
    model,
    max_tokens: 2048,
    system: [{ type: 'text', text: SYSTEM_PROMPT_TEMPLATE.replace('{{PROFILE}}', profileBlock(profile)), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: buildUserMessage(job, rules) }],
    output_config: { format: { type: 'json_schema', schema: VERDICT_SCHEMA } }
  };
  body.output_config.effort = deep ? EFFORT.deep : EFFORT.fast;
  const res = await fetchJson(`${ANTHROPIC_URL}/messages`, { method: 'POST', headers: anthropicHeaders(anthropicKey), body: JSON.stringify(body) }, 'Claude');
  if (res.stop_reason === 'refusal') throw new ApiError('Claude declined this request (safety refusal).', { code: 'refusal' });
  const textBlock = (res.content || []).find((b) => b.type === 'text');
  if (!textBlock) throw new ApiError('Claude returned no text block.', { code: 'empty', retryable: true });
  let verdict;
  try { verdict = JSON.parse(textBlock.text); } catch (e) { throw new ApiError('Claude returned invalid JSON. Retry.', { code: 'parse', retryable: true }); }
  verdict.score = Math.max(0, Math.min(100, Math.round(Number(verdict.score) || 0)));
  verdict.verdict = bandFor(verdict.score);
  const u = res.usage || {};
  return { verdict, meta: { model: `${model} (${deep ? EFFORT.deep : EFFORT.fast})`, ms: Date.now() - t0, input: u.input_tokens || 0, output: u.output_tokens || 0, cache_read: u.cache_read_input_tokens || 0, cache_write: u.cache_creation_input_tokens || 0, stop_reason: res.stop_reason } };
}

async function claudeTest() {
  const { anthropicKey } = await getSettings();
  if (!anthropicKey) throw new ApiError('No Anthropic API key saved.', { code: 'no_key' });
  const res = await fetchJson(`${ANTHROPIC_URL}/models?limit=50`, { headers: anthropicHeaders(anthropicKey) }, 'Claude');
  const ids = (res.data || []).map((m) => m.id);
  const missing = Object.values(MODELS).filter((m) => ids.length && !ids.includes(m));
  return { ok: true, message: `Key works. ${ids.length} models visible.${missing.length ? ' Missing: ' + missing.join(', ') : ''}` };
}

// ---------- Notion ----------
function notionHeaders(token) {
  return { 'content-type': 'application/json', Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION };
}

const SOURCE_MAP = { LinkedIn: 'Linkedin', Indeed: 'Indeed', 'Company Site': "Company's career page", 'Sonic Jobs': 'Sonic Jobs', Glassdoor: 'Job Portal', Handshake: 'Job Portal', Other: 'Job Portal', Referral: 'Job Portal' };
const JOB_TYPE_MAP = { 'Full-time': 'Full Time', 'Part-time': 'Part Time', Internship: 'Internship', 'Co-op': 'Internship', Contract: 'Contract', Volunteer: 'Volunteer' };
const WORK_MODE_OK = ['Remote', 'Hybrid', 'On-site'];
const SPONSOR_OK = ['Sponsors visa', 'OPT/CPT OK', 'Not mentioned', 'No sponsorship', 'US citizens only'];

function sponsorshipValue(job, verdict) {
  if (verdict && verdict.auth && SPONSOR_OK.includes(verdict.auth.sponsorship)) return verdict.auth.sponsorship;
  const n = (job.sponsorship_note || '').toLowerCase();
  if (/citizen|clearance|itar/.test(n)) return 'US citizens only';
  if (job.sponsorship === 'Sponsors') return 'Sponsors visa';
  if (job.sponsorship === 'No sponsorship') return 'No sponsorship';
  return 'Not mentioned';
}

function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function notionProperties(job, verdict) {
  const text = (s) => [{ text: { content: String(s || '').slice(0, 1900) } }];
  const props = {
    'Company Name': { title: text(job.company || 'Unknown company') },
    'Job Title': { rich_text: text(job.role || '') },
    'Job Link': { url: job.link || null },
    'Location': { rich_text: text(job.location || '') },
    'Salary Range': { rich_text: text(job.salary && job.salary !== 'Not stated' ? job.salary : '') },
    'Sponsorship': { select: { name: sponsorshipValue(job, verdict) } },
    'Applied On': { date: { start: localDate() } }
  };
  if (WORK_MODE_OK.includes(job.work_mode)) props['Work Mode'] = { select: { name: job.work_mode } };
  const jt = JOB_TYPE_MAP[job.job_type];
  if (jt) props['Job Type'] = { select: { name: jt } };
  const src = SOURCE_MAP[job.source];
  if (src) props['Source'] = { select: { name: src } };
  return props;
}

async function notionFind(link) {
  const { notionToken, notionDataSourceId } = await getSettings();
  if (!notionToken) throw new ApiError('Add your Notion token in Settings.', { code: 'no_key' });
  if (!link) return null;
  const res = await fetchJson(`${NOTION_URL}/data_sources/${notionDataSourceId}/query`, {
    method: 'POST', headers: notionHeaders(notionToken),
    body: JSON.stringify({ filter: { property: 'Job Link', url: { equals: link } }, page_size: 1 })
  }, 'Notion');
  const page = (res.results || [])[0];
  return page ? { id: page.id, url: page.url || '' } : null;
}

async function notionCreate({ job, verdict }) {
  const { notionToken, notionDataSourceId } = await getSettings();
  if (!notionToken) throw new ApiError('Add your Notion token in Settings.', { code: 'no_key' });
  const existing = await notionFind(job.link);
  if (existing) return { ok: true, exists: true, page: existing };
  const res = await fetchJson(`${NOTION_URL}/pages`, {
    method: 'POST', headers: notionHeaders(notionToken),
    body: JSON.stringify({ parent: { type: 'data_source_id', data_source_id: notionDataSourceId }, properties: notionProperties(job, verdict) })
  }, 'Notion');
  return { ok: true, exists: false, page: { id: res.id, url: res.url || '' } };
}

async function notionTrash(pageId) {
  const { notionToken } = await getSettings();
  if (!notionToken) throw new ApiError('Add your Notion token in Settings.', { code: 'no_key' });
  await fetchJson(`${NOTION_URL}/pages/${pageId}`, { method: 'PATCH', headers: notionHeaders(notionToken), body: JSON.stringify({ in_trash: true }) }, 'Notion');
  return { ok: true };
}

async function notionTest() {
  const { notionToken, notionDataSourceId } = await getSettings();
  if (!notionToken) throw new ApiError('No Notion token saved.', { code: 'no_key' });
  const me = await fetchJson(`${NOTION_URL}/users/me`, { headers: notionHeaders(notionToken) }, 'Notion');
  const ds = await fetchJson(`${NOTION_URL}/data_sources/${notionDataSourceId}`, { headers: notionHeaders(notionToken) }, 'Notion');
  const props = Object.keys(ds.properties || {});
  const need = ['Company Name', 'Job Title', 'Job Link', 'Location', 'Salary Range', 'Work Mode', 'Job Type', 'Sponsorship', 'Source', 'Applied On'];
  const missing = need.filter((p) => !props.includes(p));
  const title = (ds.title || []).map((t) => t.plain_text).join('') || '(untitled)';
  return { ok: true, message: `Token works (${me.name || me.type}). Data source "${title}" reachable.${missing.length ? ' Missing properties: ' + missing.join(', ') : ' All 10 properties present.'}` };
}

// ---------- message router ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handlers = {
    'claude.verdict': () => claudeVerdict(msg),
    'claude.test': () => claudeTest(),
    'notion.find': () => notionFind(msg.link).then((page) => ({ ok: true, page })),
    'notion.create': () => notionCreate(msg),
    'notion.trash': () => notionTrash(msg.pageId),
    'notion.test': () => notionTest()
  };
  const h = handlers[msg && msg.type];
  if (!h) { sendResponse({ ok: false, error: 'Unknown message' }); return false; }
  h().then((r) => sendResponse(Object.assign({ ok: true }, r)))
    .catch((e) => sendResponse({ ok: false, error: e.message || String(e), code: e.code || 'error', retryable: !!e.retryable }));
  return true; // async
});
