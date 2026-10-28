// rules.js - fast hard-rule check on the job text. No network. Shared by popup.js and test-extract.html.
// JDRules.check(job) -> { skip: [{rule, quote}], maybe: [{rule, quote}] }
(function (root) {
  const clean = (s) => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  const WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const LANGS = 'mandarin|cantonese|chinese|spanish|french|german|japanese|korean|portuguese|arabic|russian|italian|vietnamese|tagalog|hebrew|dutch|polish|turkish|thai|bengali|tamil|telugu|punjabi|urdu|farsi|persian|swedish|norwegian|danish|finnish|greek|indonesian|malay';

  function sentences(text) {
    return (text || '').split(/(?<=[.!?])\s+(?=[A-Z"'(•-])|\n+/).map(clean).filter((s) => s.length > 8);
  }
  function quoteOf(s) {
    if (s.length <= 300) return s;
    return s.slice(0, 297) + '…';
  }
  function firstMatch(sents, re, exclude) {
    for (const s of sents) {
      if (re.test(s) && !(exclude && exclude.test(s))) return s;
    }
    return '';
  }
  function yearsIn(s) {
    // returns the lowest number of years asked in the sentence, or null
    const m = s.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*\+?\s*(?:(?:-|–|to)\s*(\d{1,2}))?\s*\+?\s*(?:years?|yrs?)\b/i);
    if (!m) return null;
    const n = WORDNUM[m[1].toLowerCase()] !== undefined ? WORDNUM[m[1].toLowerCase()] : parseInt(m[1], 10);
    return { n, plus: /\d\s*\+/.test(m[0]) || /\+\s*(?:years?|yrs?)/i.test(m[0]) };
  }
  function salaryToYearly(str) {
    // Returns the top of the stated range in USD per year, or null if unknown.
    if (!str) return null;
    const s = str.toLowerCase();
    const nums = [...s.matchAll(/\$?\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k)?/g)]
      .map((m) => parseFloat(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1))
      .filter((n) => n > 5);
    if (!nums.length) return null;
    let v = Math.max(...nums);
    if (/\/\s?hr|\/\s?hour|per hour|an hour|hourly/.test(s) || v < 500) v = v * 2080;
    else if (/\/\s?mo|per month|monthly/.test(s)) v = v * 12;
    else if (/\/\s?wk|per week|weekly/.test(s)) v = v * 52;
    else if (v < 10000) return null; // ambiguous
    return Math.round(v);
  }

  function check(job) {
    const jd = job.jd || '';
    const sents = sentences(jd);
    const role = clean(job.role);
    const skip = [];
    const maybe = [];
    const add = (list, rule, quote) => { if (quote) list.push({ rule, quote: quoteOf(quote) }); };
    const pref = /preferred|nice to have|a plus|bonus|desirable|ideally|would be great|not required|optional/i;

    // ---- AUTO-SKIP ----
    add(skip, 'US citizen only', firstMatch(sents, /(?:u\.?s\.?|united states) citizens? only|must be (?:a |an )?(?:u\.?s\.?|united states) citizen|(?:u\.?s\.?|united states) citizenship (?:is )?(?:required|mandatory|needed)|citizenship (?:is )?required|only (?:u\.?s\.?|united states) citizens|require[sd]? (?:u\.?s\.?|united states) citizenship|open (?:only )?to (?:u\.?s\.?|united states) citizens/i));
    add(skip, 'Green card / permanent resident only', firstMatch(sents, /(?:green card|permanent resident)s?(?: holders?)?\s*(?:only|required)|must be (?:a |an )?(?:[^.]{0,30}\bor\b\s*)?(?:green card holder|permanent resident|lawful permanent resident)|\bonly\b[^.]{0,40}(?:green card|permanent resident)|(?:green card|permanent resident)s?(?: holders?)?[^.]{0,30}\bonly\b/i, /sponsor/i));
    add(skip, 'Security clearance', firstMatch(sents, /security clearance|(?:active|secret|top secret|ts\/sci|public trust|dod)\s+(?:security )?clearance|clearance (?:is )?required|(?:obtain|maintain|hold)[^.]{0,25}clearance/i));
    add(skip, 'ITAR / EAR / U.S. person', firstMatch(sents, /\bitar\b|export[\s-]control|u\.?s\.? persons?\b|united states persons?\b/i) || firstMatch(sents, /\bEAR\b/));
    add(skip, 'C2C only', firstMatch(sents, /\bc2c\b|corp[\s-]to[\s-]corp/i) && (() => { const s = firstMatch(sents, /\bc2c\b|corp[\s-]to[\s-]corp/i); return /\bonly\b|no w-?2|w-?2 (?:is )?not/i.test(s) ? s : ''; })());
    add(skip, 'PhD required', firstMatch(sents, /ph\.?\s?d/i, /preferred|or equivalent|master|\bm\.?s\.?\b|\bms\b|\bm\.?sc|bachelor|\bb\.?s\.?\b|\bbs\b|nice to have|a plus|bonus|or (?:a )?ph|ph\.?\s?d\.?\s*(?:or|\/)|\bor\b/i) && (() => { const s = firstMatch(sents, /ph\.?\s?d/i, /preferred|or equivalent|master|\bm\.?s\.?\b|\bms\b|\bm\.?sc|bachelor|\bb\.?s\.?\b|\bbs\b|nice to have|a plus|bonus|or (?:a )?ph|ph\.?\s?d\.?\s*(?:or|\/)|\bor\b/i); return /required|must|requires?\b|mandatory/i.test(s) ? s : ''; })());
    if (/\b(senior|sr\.?|staff|principal|lead|iii)\b/i.test(role)) add(skip, 'Senior-level title', role);
    // Firm 3+ years. "N+ years" counts as firm; plain "N years" needs required/must/minimum. "in lieu of a degree" never counts.
    for (const s of sents) {
      const y = yearsIn(s);
      if (!y || y.n < 3) continue;
      if (/in lieu|lieu of|equivalent (?:experience|combination)|or equivalent|instead of (?:a )?degree/i.test(s)) continue;
      if (pref.test(s)) continue;
      if (y.plus || /required|must|minimum|at least|need|require/i.test(s)) { add(skip, `Firm ${y.n}${y.plus ? '+' : ''} years required`, s); break; }
    }
    add(skip, 'Unpaid', firstMatch(sents, /\bunpaid\b|non-?paid|no compensation|without pay|volunteer (?:position|role|basis|opportunity)|this is a volunteer|not a paid/i));
    for (const s of sents) {
      const m = s.match(/(\d{1,2})\s*(?:(?:-|–|to)\s*(\d{1,2}))?\s*(?:hours|hrs)\s*(?:per|a|\/|each)\s*(?:week|wk)/i);
      if (m) { const hi = Math.max(parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : 0); if (hi < 20) { add(skip, `Under 20 hours a week (${hi})`, s); } break; }
    }
    add(skip, 'Requires a language other than English / Hindi / Gujarati', firstMatch(sents, new RegExp(`(?:fluen\\w*|proficien\\w*|native|bilingual|speak\\w*|written and (?:spoken|verbal)|command of)[^.]{0,30}\\b(?:${LANGS})\\b|\\b(?:${LANGS})\\b[^.]{0,30}(?:required|fluen\\w*|proficien\\w*|must|is a must|mandatory)`, 'i'), pref));

    // ---- MAYBE ----
    add(maybe, 'No visa sponsorship', firstMatch(sents, /no (?:visa |work |employment |immigration )?sponsorship|not (?:able|willing) to sponsor|unable to sponsor|will not (?:be able to )?sponsor|cannot sponsor|can't sponsor|does not (?:offer |provide )?sponsor|do not (?:offer |provide )?sponsor|without (?:the need for |need of |requiring |any )?(?:visa |employer |company |immigration )?sponsorship|sponsorship (?:is |will be )?(?:not|un)available|not (?:eligible|open|available) for (?:visa |work )?sponsorship/i));
    add(maybe, '1099 contract', firstMatch(sents, /\b1099\b/));
    for (const s of sents) {
      const m = s.match(/(\d{1,2})\s*(?:(?:-|–|to)\s*(\d{1,2}))?\s*[- ]?months?\b[^.]{0,40}(?:contract|assignment|engagement|duration|term|project|position)|(?:contract|assignment|engagement|duration|term)[^.]{0,40}?(\d{1,2})\s*(?:(?:-|–|to)\s*(\d{1,2}))?\s*[- ]?months?\b/i);
      if (m) { const nums = [m[1], m[2], m[3], m[4]].filter(Boolean).map((n) => parseInt(n, 10)); const hi = Math.max(...nums); if (hi < 6) add(maybe, `Contract under 6 months (${hi})`, s); break; }
    }
    add(maybe, 'Seasonal', firstMatch(sents, /\bseasonal\b/i));
    const yearly = salaryToYearly(job.salary && job.salary !== 'Not stated' ? job.salary : '');
    if (yearly !== null && yearly < 60000) add(maybe, `Pay under $60K a year (about $${yearly.toLocaleString('en-US')})`, job.salary);

    return { skip, maybe };
  }

  const api = { check, sentences, salaryToYearly };
  root.JDRules = api;
})(typeof self !== 'undefined' ? self : this);
