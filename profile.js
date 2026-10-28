// profile.js - the profile page. Stored in chrome.storage.local under "profile". Autosaves.
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const DEFAULT_PROFILE = {
  name: 'Krushal Kalkani', email: '', phone: '',
  address: { street: '5541 Pacific Blvd', apt: 'Apt 4107', city: 'Boca Raton', state: 'FL', zip: '33433', country: 'United States' },
  summary: 'Early-career Software / AI Engineer with real industry and research experience (MS CS, FAU, May 2026).',
  links: { linkedin: '', github: '', x: '', portfolio: '', other: '' },
  education: [
    { school: 'Florida Atlantic University', degree: 'Master of Science', field: 'Computer Science (AI/ML focus)', gpa: '3.5', start: '', end: '2026-05', location: 'Boca Raton, FL' }
  ],
  experience: [
    { company: 'Brainvire Infotech', title: 'Software Developer', location: '', start: '', end: '', type: 'Full-time', bullets: 'Python backend development and Odoo ERP customisation.' },
    { company: 'Brainvire Infotech', title: 'Software Engineering Intern', location: '', start: '', end: '', type: 'Internship', bullets: '' },
    { company: 'Florida Atlantic University', title: 'Research Assistant', location: 'Boca Raton, FL', start: '', end: '', type: 'Part-time', bullets: 'Depth-camera pipeline (Intel RealSense, MediaPipe); co-author of an MDPI Sensors paper.' }
  ],
  skills: {
    proven: 'Python, scikit-learn, XGBoost, TF-IDF/NLP, Pandas, NumPy, Streamlit, Docker, Hugging Face Spaces, Odoo, JavaScript, Bootstrap, HTML/CSS, Intel RealSense, MediaPipe, data pipelines, model evaluation',
    listed: 'PyTorch, TensorFlow, Keras, FastAPI, REST, SQL, RAG, LLM APIs, agents, GitHub Actions, Cursor, Claude API',
    never: 'Java, C++, Go, Scala, Rust, AWS, GCP, Azure, Kubernetes, Spark, LangChain, LlamaIndex, vector DBs, fine-tuning, Claude Code',
    norecord: 'Airflow, CUDA, vLLM, React, TypeScript'
  },
  certifications: 'ML in Production, Agentic AI, RAG, GenAI with LLMs, ML Specialization',
  languages: 'English, Hindi, Gujarati',
  targets: { roles: 'ML Engineer, AI Engineer, Applied Scientist, Data Scientist, GenAI/LLM Engineer, MLOps Engineer; close software roles (Software Engineer, Data Engineer, Backend/Python)', levels: 'Entry level, new grad, I, junior, associate, early career. Not Senior/Lead/Staff/Principal/III, not 4+ years', minPay: '60000', locations: 'Anywhere in the US and remote. Priority: SF Bay Area, LA, San Diego, NYC, Seattle, Boston, Austin, Chicago, DC, Florida' },
  eeo: { authorized: 'Yes', sponsorship: 'Yes', visa: 'F-1 OPT (STEM OPT eligible), then H-1B', startDate: 'Immediately', relocate: 'Yes', pronouns: '', gender: 'Male', hispanic: 'No', race: 'Asian', veteran: 'I am not a protected veteran', disability: 'No, I do not have a disability and have not had one in the past', source: 'LinkedIn' }
};

let profile = null;
let saveTimer = null;

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const set = (obj, path, v) => { const ks = path.split('.'); let o = obj; for (const k of ks.slice(0, -1)) { if (typeof o[k] !== 'object' || o[k] == null) o[k] = {}; o = o[k]; } o[ks[ks.length - 1]] = v; };
function fullAddress(a) { return [a.street, a.apt, [a.city, a.state].filter(Boolean).join(', ') + (a.zip ? ' ' + a.zip : ''), a.country].filter(Boolean).join(', '); }
function msg(t) { $('#msg').textContent = t; clearTimeout(msg._t); msg._t = setTimeout(() => { $('#msg').textContent = ''; }, 1800); }
async function copy(text) { try { await navigator.clipboard.writeText(text); msg('Copied'); } catch (e) { msg('Copy failed'); } }

function renderFields() {
  for (const el of $$('[data-k]')) {
    const v = get(profile, el.dataset.k);
    el.value = v == null ? '' : v;
  }
  $('[data-k="address.full"]').value = fullAddress(profile.address || {});
}
function renderEntries(kind) {
  const box = $('#' + kind);
  const tpl = $(kind === 'education' ? '#eduTpl' : '#expTpl');
  box.innerHTML = '';
  (profile[kind] || []).forEach((entry, i) => {
    const node = tpl.content.cloneNode(true);
    const root = node.querySelector('.entry');
    root.dataset.kind = kind; root.dataset.i = i;
    root.querySelector('.entry-head span').textContent = `${kind === 'education' ? 'Education' : 'Experience'} ${i + 1}`;
    for (const el of root.querySelectorAll('[data-e]')) el.value = entry[el.dataset.e] || '';
    box.appendChild(node);
  });
}
function readAll() {
  for (const el of $$('[data-k]')) { if (el.dataset.k === 'address.full') continue; set(profile, el.dataset.k, el.value.trim()); }
  for (const kind of ['education', 'experience']) {
    profile[kind] = $$(`#${kind} .entry`).map((root) => { const e = {}; for (const el of root.querySelectorAll('[data-e]')) e[el.dataset.e] = el.value.trim(); return e; });
  }
  $('[data-k="address.full"]').value = fullAddress(profile.address || {});
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => { readAll(); await chrome.storage.local.set({ profile }); msg('Saved'); }, 400);
}

function profileText(p) {
  const a = p.address || {};
  const lines = [
    p.name, p.email, p.phone, fullAddress(a),
    ...Object.entries(p.links || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`),
    '', p.summary, '',
    'Education', ...(p.education || []).map((e) => `- ${[e.degree, e.field].filter(Boolean).join(' in ')}, ${e.school}${e.end ? ', ' + e.end : ''}${e.gpa ? ', GPA ' + e.gpa : ''}`),
    '', 'Experience', ...(p.experience || []).flatMap((x) => [`- ${x.title}, ${x.company}${x.location ? ', ' + x.location : ''}${x.start || x.end ? ` (${x.start || '?'} to ${x.end || '?'})` : ''}`, ...String(x.bullets || '').split('\n').filter(Boolean).map((b) => '  • ' + b.replace(/^[-•]\s*/, ''))]),
    '', `Skills (proven): ${p.skills && p.skills.proven || ''}`, `Skills (listed): ${p.skills && p.skills.listed || ''}`,
    `Certifications: ${p.certifications || ''}`, `Languages: ${p.languages || ''}`,
    '', `Authorized to work in the US: ${p.eeo && p.eeo.authorized}`, `Will require sponsorship in the future: ${p.eeo && p.eeo.sponsorship}`, `Status: ${p.eeo && p.eeo.visa}`
  ];
  return lines.filter((l) => l !== undefined && l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

document.addEventListener('DOMContentLoaded', async () => {
  const r = await chrome.storage.local.get('profile');
  profile = r.profile && r.profile.name !== undefined ? r.profile : JSON.parse(JSON.stringify(DEFAULT_PROFILE));
  renderFields(); renderEntries('education'); renderEntries('experience');

  document.body.addEventListener('input', (e) => { if (e.target.matches('input, textarea, select')) scheduleSave(); });
  document.body.addEventListener('change', (e) => { if (e.target.matches('select')) scheduleSave(); });
  document.body.addEventListener('click', (e) => {
    const cp = e.target.closest('.cp');
    if (cp) { const field = cp.closest('.field').querySelector('input, textarea, select'); copy(field.value); return; }
    const rm = e.target.closest('[data-remove]');
    if (rm) { readAll(); const root = rm.closest('.entry'); profile[root.dataset.kind].splice(Number(root.dataset.i), 1); renderEntries(root.dataset.kind); scheduleSave(); }
  });
  $('#addEdu').addEventListener('click', () => { readAll(); profile.education.push({}); renderEntries('education'); });
  $('#addExp').addEventListener('click', () => { readAll(); profile.experience.push({}); renderEntries('experience'); });
  $('#copyAll').addEventListener('click', () => { readAll(); copy(profileText(profile)); });
  $('#exportJson').addEventListener('click', () => { readAll(); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' })); a.download = 'jd-filler-profile.json'; a.click(); });
  $('#importJson').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { profile = Object.assign(JSON.parse(JSON.stringify(DEFAULT_PROFILE)), JSON.parse(await f.text())); renderFields(); renderEntries('education'); renderEntries('experience'); scheduleSave(); } catch (err) { msg('Not a valid profile JSON'); }
  });
});
