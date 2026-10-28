// extractor.js - injected into the job page when you open the popup.
// Defines window.__jdFillerExtract() which returns a plain object with the job facts.
// Nothing runs until the popup asks for it.
(function () {
  if (window.__jdFillerExtract) return;

  // ---------- helpers ----------
  const clean = (s) => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  const q = (sel, root) => (root || document).querySelector(sel);
  const qa = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const txt = (sel, root) => { const el = q(sel, root); return el ? clean(el.innerText || el.textContent) : ''; };
  const firstTxt = (sels, root) => { for (const s of sels) { const v = txt(s, root); if (v) return v; } return ''; };
  const firstEl = (sels, root) => { for (const s of sels) { const el = q(s, root); if (el) return el; } return null; };
  const block = (el) => {
    if (!el) return '';
    let t = el.innerText || '';
    if (t.trim().length < 200) t = el.textContent || '';
    return t.replace(/\r/g, '').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  };
  const titleCase = (slug) => (slug || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
  const htmlToText = (html) => {
    if (!html) return '';
    const withBreaks = String(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr|ul|ol|section|article)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ');
    const doc = new DOMParser().parseFromString(withBreaks, 'text/html');
    const out = (doc.body.textContent || '').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    // Some sites (LinkedIn guest JSON-LD) double-encode the HTML; strip one more layer if tags survived.
    if (/<\/?(?:br|p|strong|b|li|ul|ol|div|em|h[1-6])\b[^>]*>/i.test(out)) return htmlToText(out);
    return out;
  };

  // Fixture/test pages can set window.__jdFillerTestUrl so site detection works outside the real site.
  const url = new URL(window.__jdFillerTestUrl || location.href);
  const host = url.hostname.replace(/^www\./, '');

  // ---------- source / company from URL ----------
  function detectSource(h) {
    if (/(^|\.)linkedin\.com$/.test(h)) return 'LinkedIn';
    if (/(^|\.)indeed\./.test(h)) return 'Indeed';
    if (/(^|\.)joinhandshake\.com$/.test(h)) return 'Handshake';
    if (/(^|\.)glassdoor\./.test(h)) return 'Glassdoor';
    if (/(^|\.)sonicjobs\.com$/.test(h)) return 'Sonic Jobs';
    if (/(ziprecruiter|wellfound\.com|angel\.co|dice\.com|monster\.com|simplyhired|builtin\.com|otta\.com|welcometothejungle|jobright\.ai|hiring\.cafe|levels\.fyi|google\.com|careerbuilder|jobs\.google)/.test(h)) return 'Other';
    return 'Company Site';
  }

  function atsCompanyFromUrl() {
    const p = url.pathname.split('/').filter(Boolean);
    let m;
    if (/lever\.co$/.test(host) && p[0]) return titleCase(p[0]);
    if (/greenhouse\.io$/.test(host)) {
      if (p[0] === 'embed') return titleCase(url.searchParams.get('for') || '');
      if (p[0]) return titleCase(p[0]);
    }
    if (/ashbyhq\.com$/.test(host) && p[0]) return titleCase(p[0]);
    if ((m = host.match(/^([^.]+)\.wd\d+\.myworkdayjobs\.com$/))) return titleCase(m[1]);
    if (/smartrecruiters\.com$/.test(host) && p[0]) return titleCase(p[0]);
    if ((m = host.match(/^(?:careers-|jobs-)?([^.]+)\.icims\.com$/))) return titleCase(m[1]);
    if (/workable\.com$/.test(host) && p[0]) return titleCase(p[0]);
    if ((m = host.match(/^([^.]+)\.bamboohr\.com$/))) return titleCase(m[1]);
    if (/jobvite\.com$/.test(host) && p[0]) return titleCase(p[0]);
    if (/rippling\.com$/.test(host) && p[0]) return titleCase(p[0]);
    if (/dover\.com$/.test(host) && p[1]) return titleCase(p[1]);
    if ((m = host.match(/^([^.]+)\.applytojob\.com$/))) return titleCase(m[1]);
    if ((m = host.match(/^([^.]+)\.breezy\.hr$/))) return titleCase(m[1]);
    return '';
  }

  // ---------- normalizers ----------
  function mapJobType(s) {
    const t = (s || '').toLowerCase();
    if (!t) return '';
    if (/\binternship\b|\binterns?\b/.test(t)) return 'Internship';
    if (/\bco-?op\b/.test(t)) return 'Co-op';
    if (/full[_\s-]?time\b/.test(t)) return 'Full-time';
    if (/part[_\s-]?time\b/.test(t)) return 'Part-time';
    if (/\bcontract(?:or|ual)?\b|\btemporary\b|\btemp\b|\bfreelance\b|\bc2c\b/.test(t)) return 'Contract';
    return '';
  }

  function detectWorkMode(s, strict) {
    const t = (s || '').toLowerCase();
    if (!t) return '';
    if (/\bhybrid\b/.test(t)) return 'Hybrid';
    if (/\bremote\b/.test(t)) {
      if (!strict && /\b(?:not|no|non|isn't|is not)[\s-]+(?:a\s+)?(?:fully\s+)?remote\b|remote (?:work )?is not (?:available|an option|offered)|no remote (?:work|option)|100% (?:on-?site|in-?office)/.test(t)) return 'On-site';
      return 'Remote';
    }
    if (/\bon[\s-]?site\b|\bin[\s-]office\b|\bin[\s-]person\b|\boffice[\s-]based\b/.test(t)) return 'On-site';
    return '';
  }

  function findSalary(s) {
    if (!s) return '';
    const money = String.raw`(?:\$|USD\s?|US\$)\s?\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?:\$|USD\s?|US\$)\s?\d+(?:\.\d+)?\s?[kK]\b|(?:\$|USD\s?|US\$)\s?\d{2,3}(?:\.\d{1,2})?\b`;
    const per = String.raw`(?:\s*(?:/|per|an?)\s*(?:yr|year|annum|hour|hr|month|mo|week|wk)\b\.?)?`;
    let m = s.match(new RegExp(`(${money})${per}\\s*(?:-|–|—|to|and)\\s*(${money})${per}`, 'i'));
    if (m) return clean(m[0]);
    m = s.match(/\b\d{2,3},\d{3}\s*(?:-|–|—|to)\s*\d{2,3},\d{3}\s*(?:USD|dollars|per year|annually|\/\s?yr|a year)?/i);
    if (m) return clean(m[0]);
    m = s.match(new RegExp(`(${money})${per}`, 'i'));
    if (m && /yr|year|annum|hour|hr|month|week|\d\s?k\b/i.test(m[0])) return clean(m[0]);
    return '';
  }

  function findExperience(jd) {
    const m = jd.match(/\b(\d{1,2}(?:\s*(?:\+|-|–|to)\s*\d{1,2})?\s*\+?\s*(?:years?|yrs?)(?:\s+of)?(?:\s+(?:\w+\s+){0,5}?)?experience)/i)
      || jd.match(/\b(\d{1,2}\s*\+?\s*(?:years?|yrs?))\b/i);
    return m ? clean(m[1]) : '';
  }

  function seniorityFromTitle(t) {
    t = (t || '').toLowerCase();
    if (!t) return '';
    if (/\bintern(?:ship)?s?\b/.test(t)) return 'Intern';
    if (/\bco-?op\b/.test(t)) return 'Co-op';
    if (/new grad|entry[\s-]level|\bgraduate\b|early[\s-]career|\bassociate\b|\bjunior\b|\bjr\.?\b|\bi\b\s*$|\b1\b\s*$/.test(t)) return 'Entry / Junior';
    if (/\bprincipal\b/.test(t)) return 'Principal';
    if (/\bstaff\b/.test(t)) return 'Staff';
    if (/\bdirector\b|\bvp\b|\bhead of\b|\bchief\b/.test(t)) return 'Director+';
    if (/\bsenior\b|\bsr\.?\b|\biii\b/.test(t)) return 'Senior';
    if (/\blead\b/.test(t)) return 'Lead';
    if (/\bmanager\b/.test(t)) return 'Manager';
    if (/\bii\b|mid[\s-]level/.test(t)) return 'Mid';
    return '';
  }

  const AUTH_RE = /sponsor|\bvisa\b|h-?1\s?b|\bopt\b|\bcpt\b|\bstem\b|work authori[sz]|authori[sz]ed to work|eligib(?:le|ility) to work|right to work|legally (?:able|permitted|eligible)|citizen|green card|permanent resident|clearance|\bitar\b|export[\s-]control|e-?verify|\bc2c\b|corp[\s-]to[\s-]corp|\bw-?2\b|\b1099\b|u\.?s\.? person|united states person|immigration/i;

  function authLines(jd) {
    const sents = jd.split(/(?<=[.!?])\s+(?=[A-Z"'(•-])|\n+/).map(clean).filter((s) => s.length > 12 && AUTH_RE.test(s));
    const seen = new Set();
    const out = [];
    for (let s of sents) {
      if (s.length > 320) {
        const i = s.search(AUTH_RE);
        const start = Math.max(0, i - 120);
        s = (start > 0 ? '…' : '') + s.slice(start, i + 200) + (s.length > i + 200 ? '…' : '');
      }
      const k = s.toLowerCase();
      if (!seen.has(k)) { seen.add(k); out.push(s); }
      if (out.length >= 6) break;
    }
    return out;
  }

  function classifySponsorship(jd, lines) {
    const t = (lines.length ? lines.join(' ') : jd).toLowerCase();
    const noSp = /(?:not|unable|cannot|can't|won't|will not|does not|do not|doesn't|don't|no|without|never|unavailable)\W+(?:\w+\W+){0,6}sponsor/i.test(t)
      || /sponsorship (?:is |will be )?(?:not|un)available|no (?:visa |work |employment |immigration )?sponsorship|without (?:the need for |need of |requiring |any )?(?:visa |employer |company |immigration )?sponsorship|not (?:eligible|open|available) for (?:visa |work )?sponsorship|not (?:able|willing) to sponsor|sponsorship (?:is )?not (?:offered|provided|possible)/i.test(t);
    const yesSp = /(?:will|can|able to|offers?|provides?|open to|happy to|does|may|willing to)\W+(?:(?!not\b|no\b|never\b|unable\b)\w+\W+){0,4}sponsor|sponsorship (?:is |may be )?(?:available|offered|provided|possible|considered)|visa sponsorship available|we sponsor/i.test(t);
    const citizen = /(?:u\.?s\.?|united states) citizen(?:ship)?\s*(?:is )?(?:required|only|needed|mandatory)|must be (?:a |an )?(?:u\.?s\.?|united states) citizen|citizenship (?:is )?required|citizens only|security clearance|\bitar\b|export[\s-]control|u\.?s\.? person|united states person/i.test(t);
    const note = [];
    if (citizen) note.push('Citizen / clearance / ITAR restriction mentioned');
    let value;
    if (noSp && !yesSp) { value = 'No sponsorship'; }
    else if (yesSp && !noSp) { value = 'Sponsors'; }
    else if (yesSp && noSp) { value = 'Unknown'; note.push('Conflicting sponsorship wording - read the auth lines'); }
    else if (/sponsor|visa|h-?1\s?b/i.test(t)) { value = 'Unknown'; note.push('Sponsorship mentioned but unclear - read the auth lines'); }
    else if (lines.length) { value = 'Unknown'; note.push('Not stated - only generic work authorization lines'); }
    else { value = 'Unknown'; note.push('Not stated in the posting'); }
    return { value, note: note.join('; ') };
  }

  function canonicalLink() {
    const u = new URL(url.href);
    const strip = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gh_src', 'gh_jid', 'lever-source', 'ref', 'refId', 'trackingId', 'trk', 'original_referer', 'fbclid', 'gclid', 'position', 'pageNum', '_gl', 'mc_cid', 'mc_eid'];
    for (const k of [...u.searchParams.keys()]) if (strip.includes(k) || /^utm_/i.test(k)) u.searchParams.delete(k);
    u.hash = '';
    const can = q('link[rel="canonical"]');
    if (can && can.href && /^https?:/.test(can.href)) {
      try { const c = new URL(can.href); c.protocol = u.protocol; c.hash = ''; if (c.hostname === u.hostname && c.pathname.length > 1) return c.href; } catch (e) { /* ignore */ }
    }
    return u.href;
  }

  function cleanCompany(s) {
    return clean(s).replace(/^\d{2,}\s+/, '').replace(/^at\s+/i, '').replace(/\s*(?:logo|·\s*follow|follow)$/i, '').replace(/\s*\(.*?hiring.*?\)$/i, '').trim();
  }
  function cleanRole(s) {
    return clean(s).replace(/\s*-\s*job post$/i, '').replace(/\s*\|\s*linkedin$/i, '').replace(/\s+at\s+[^|]+$/i, (m) => (m.length > 40 ? '' : m)).trim();
  }

  // ---------- JSON-LD JobPosting (most company sites, Greenhouse, Lever, Ashby, Workday, SmartRecruiters) ----------
  function jsonLd() {
    const out = {};
    for (const s of qa('script[type="application/ld+json"]')) {
      let data;
      try { data = JSON.parse(s.textContent); } catch (e) { continue; }
      const nodes = [];
      const walk = (n) => { if (!n) return; if (Array.isArray(n)) return n.forEach(walk); if (typeof n === 'object') { nodes.push(n); if (n['@graph']) walk(n['@graph']); } };
      walk(data);
      const jp = nodes.find((n) => { const t = n['@type']; return t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting')); });
      if (!jp) continue;
      out.role = clean(jp.title);
      const org = jp.hiringOrganization;
      out.company = clean(typeof org === 'string' ? org : org && org.name);
      const locs = [].concat(jp.jobLocation || []);
      out.location = locs.map((l) => {
        if (!l) return '';
        if (typeof l === 'string') return l;
        const a = l.address;
        if (!a) return clean(l.name);
        if (typeof a === 'string') return a;
        const country = a.addressCountry && (typeof a.addressCountry === 'string' ? a.addressCountry : a.addressCountry.name);
        return [a.addressLocality, a.addressRegion, country].filter(Boolean).map(clean).join(', ');
      }).filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 5).join(' | ');
      if (jp.jobLocationType === 'TELECOMMUTE') out.work_mode = 'Remote';
      out.job_type = mapJobType([].concat(jp.employmentType || []).join(' '));
      const bs = jp.baseSalary;
      if (bs) {
        const v = bs.value || bs;
        const cur = bs.currency || v.currency || '';
        const unit = v.unitText || '';
        const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : n);
        let s = '';
        if (v.minValue && v.maxValue) s = `${fmt(v.minValue)} - ${fmt(v.maxValue)}`;
        else if (v.value) s = `${fmt(v.value)}`;
        else if (v.minValue) s = `${fmt(v.minValue)}+`;
        if (s) out.salary = `${cur ? cur + ' ' : ''}${s}${unit ? ' / ' + String(unit).toLowerCase() : ''}`.trim();
      }
      if (jp.datePosted) out.posted = String(jp.datePosted).slice(0, 10);
      if (jp.validThrough) out.deadline = String(jp.validThrough).slice(0, 10);
      if (jp.description) out.jd = htmlToText(jp.description);
      out._jsonld = true;
      break;
    }
    return out;
  }

  // ---------- site extractors ----------
  // Text that comes from LinkedIn chrome, not the job. Never accept it as a role or company.
  const LI_JUNK = /low match|top applicant|premium|match details|see how you compare|people you can reach|company insights|job search|jobs you may|similar jobs|skip to/i;
  const liOk = (v) => (v && !LI_JUNK.test(v) ? v : '');

  // Parse "(3) Role | Company | LinkedIn" or "Role at Company — Loc | LinkedIn Jobs".
  function linkedinTitleFallback() {
    const t = clean(document.title).replace(/^\(\d+\)\s*/, '');
    const parts = t.split(/\s*\|\s*/).filter((p) => p && !/^linkedin/i.test(p));
    const out = {};
    if (parts.length >= 2) { out.role = parts[0]; out.company = parts[1]; return out; }
    const m = t.match(/^(.+?)\s+at\s+(.+?)(?:\s+[—–-]\s+(.+?))?\s*(?:\|\s*LinkedIn.*)?$/i);
    if (m) { out.role = m[1]; out.company = m[2]; if (m[3]) out.location = m[3]; }
    return out;
  }

  function linkedin() {
    const r = {};
    const id = url.searchParams.get('currentJobId') || (url.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d+)/) || [])[1] || '';
    if (id) r.link = `https://www.linkedin.com/jobs/view/${id}/`;

    // Only the selected job's detail pane. Never the left list, Premium widgets,
    // "People you can reach out to", company insights, or the footer.
    const pane = firstEl([
      '.jobs-search__job-details--container', '.scaffold-layout__detail', '.jobs-details', '.job-view-layout',
      '.jobs-details__main-content', '.details', 'main'
    ]) || document.body;
    const top = firstEl([
      '.job-details-jobs-unified-top-card__container--two-pane', '.jobs-unified-top-card',
      '[class*="job-details-jobs-unified-top-card"]', '[class*="jobs-unified-top-card"]',
      '.top-card-layout__card', '.topcard', '[class*="top-card"]'
    ], pane) || pane;
    const notJunk = (el) => !el.closest('[class*="premium"], [class*="how-you-match"], [class*="insight-card"], [class*="people-you"], footer, nav');

    r.role = liOk(firstTxt([
      '.job-details-jobs-unified-top-card__job-title h1', '.job-details-jobs-unified-top-card__job-title',
      '.jobs-unified-top-card__job-title h1', '.jobs-unified-top-card__job-title',
      'h1.top-card-layout__title', '.topcard__title', '.jobs-details-top-card__job-title', '[class*="job-title"] h1', '[class*="job-title"]', 'h1'
    ], top)) || liOk(firstTxt(['[class*="top-card"] h1', 'h1'], pane));
    r.company = liOk(firstTxt([
      '.job-details-jobs-unified-top-card__company-name a', '.job-details-jobs-unified-top-card__company-name',
      '.jobs-unified-top-card__company-name a', '.jobs-unified-top-card__company-name',
      '[class*="company-name"]', 'a.topcard__org-name-link', '.topcard__org-name-link',
      '.top-card-layout__second-subline a[href*="/company/"]', 'a[href*="/company/"]'
    ], top));

    const prim = firstTxt([
      '.job-details-jobs-unified-top-card__tertiary-description-container', '.job-details-jobs-unified-top-card__primary-description-container',
      '.jobs-unified-top-card__primary-description', '.jobs-unified-top-card__subtitle-primary-grouping',
      '[class*="tertiary-description"]', '[class*="primary-description"]',
      '.top-card-layout__second-subline', '.topcard__flavor-row'
    ], top);
    if (prim) {
      const pm = prim.match(/(?:(?:re)?posted\s+)?\d+\s*(?:minutes?|hours?|days?|weeks?|months?)\s+ago/i);
      if (pm) r.posted = clean(pm[0]);
      const am = prim.match(/(?:over\s+|fewer than\s+)?\d+\+?\s*(?:applicants?|people clicked apply)|be an early applicant|be among the first \d+ applicants/i);
      if (am) r.applicants = clean(am[0]);
    }
    r.posted = r.posted || firstTxt(['.posted-time-ago__text', '[class*="posted-date"]'], top);
    r.applicants = r.applicants || firstTxt(['.num-applicants__caption', '[class*="applicant-count"]'], top);
    r.location = firstTxt(['.topcard__flavor--bullet', '.job-details-jobs-unified-top-card__bullet', '.jobs-unified-top-card__bullet', '[class*="__bullet"]'], top);
    if (!r.location && prim) {
      const parts = prim.split(/\s*[·•|]\s*/).map(clean).filter(Boolean)
        .filter((p) => p.toLowerCase() !== (r.company || '').toLowerCase())
        .filter((p) => !/\bago\b|^(?:re)?posted|applicant|people clicked apply|easy apply|promoted|viewed|actively|matches your|see who/i.test(p) && !/^\d+$/.test(p));
      if (parts.length) r.location = parts[0];
    }

    // Pills under the top card: "Remote", "Hybrid", "Full-time", "$120K/yr - $150K/yr", "Mid-Senior level".
    const pills = qa([
      '.job-details-preferences-and-skills__pill', '.job-details-fit-level-preferences button',
      '.jobs-unified-top-card__job-insight span', '.job-details-jobs-unified-top-card__job-insight span',
      '.job-details-jobs-unified-top-card__job-insight-view-model-secondary', 'li.job-details-jobs-unified-top-card__job-insight',
      '[class*="job-insight"]', '[class*="workplace-type"]', '[class*="__pill"]'
    ].join(', '), pane).filter(notJunk).map((e) => clean(e.innerText || e.textContent)).filter((t) => t && t.length < 160);
    r._pills = pills;
    for (const p of pills) {
      const wm = detectWorkMode(p, true); if (wm && !r.work_mode) r.work_mode = wm;
      const jt = mapJobType(p); if (jt && !r.job_type) r.job_type = jt;
      const sal = findSalary(p); if (sal && !r.salary) r.salary = sal;
      const sen = p.match(/\b(internship|entry level|associate|mid-senior level|director|executive)\b/i); if (sen && !r.seniority) r.seniority = sen[1];
    }
    for (const li of qa('.description__job-criteria-item', pane)) {
      const h = txt('.description__job-criteria-subheader', li).toLowerCase();
      const v = txt('.description__job-criteria-text', li);
      if (/seniority/.test(h) && !/not applicable/i.test(v)) r.seniority = r.seniority || v;
      if (/employment/.test(h)) r.job_type = r.job_type || mapJobType(v);
    }

    // The "About the job" block only.
    const descEl = firstEl([
      '#job-details', '.jobs-description__content', '.jobs-description-content__text', '.jobs-box__html-content',
      '.jobs-description', '.show-more-less-html__markup', '.description__text', '[class*="description__text"]'
    ], pane);
    r.jd = block(descEl);
    if (r.jd) {
      r.jd = r.jd
        .replace(/^About the job\s*/i, '')
        .replace(/\s*(?:Show more|Show less|…\s*more|\.\.\.\s*more|see more|see less)\s*$/i, '')
        .replace(/\n\s*(?:Show more|Show less|…\s*more)\s*(?=\n|$)/gi, '')
        .trim();
    }
    return r;
  }

  function indeed() {
    const r = {};
    const jk = url.searchParams.get('jk') || url.searchParams.get('vjk');
    if (jk) r.link = `https://${location.hostname}/viewjob?jk=${jk}`;
    r.role = firstTxt(['h1[data-testid="jobsearch-JobInfoHeader-title"]', '.jobsearch-JobInfoHeader-title', 'h2.jobTitle', 'h1']);
    r.company = firstTxt(['[data-testid="inlineHeader-companyName"]', '[data-company-name="true"]', '[data-testid="jobsearch-CompanyInfoContainer"] a', '.jobsearch-InlineCompanyRating > div:first-child']);
    r.location = firstTxt(['[data-testid="inlineHeader-companyLocation"]', '[data-testid="jobsearch-JobInfoHeader-companyLocation"]', '[data-testid="job-location"]']);
    const meta = firstTxt(['#salaryInfoAndJobType', '[data-testid="jobsearch-OtherJobDetailsContainer"]', '#jobDetailsSection']);
    if (meta) { r.salary = findSalary(meta); r.job_type = mapJobType(meta); r.work_mode = detectWorkMode(meta, true); }
    r.jd = block(firstEl(['#jobDescriptionText', '.jobsearch-JobComponent-description', '[data-testid="jobsearch-JobComponent-description"]']));
    return r;
  }

  function greenhouse() {
    const r = {};
    r.role = firstTxt(['h1.section-header', '.app-title', '.job__title h1', 'h1.job__title', 'h1']);
    r.company = firstTxt(['.company-name', '.job__company', '#header .company-name']);
    r.location = firstTxt(['.job__location', '.location', '.body--metadata']);
    r.jd = block(firstEl(['.job__description', '#content', '#job_description', 'main']));
    return r;
  }

  function lever() {
    const r = {};
    r.role = firstTxt(['.posting-headline h2', '.posting-header h2', 'h2']);
    r.location = firstTxt(['.posting-categories .location', '.posting-category.location']);
    r.job_type = mapJobType(firstTxt(['.posting-categories .commitment', '.posting-category.commitment']));
    r.work_mode = detectWorkMode(firstTxt(['.posting-categories .workplaceTypes', '.posting-category.workplaceTypes']), true);
    const logo = q('.main-header-logo img, .posting-header img');
    if (logo && logo.alt) r.company = clean(logo.alt).replace(/\s*logo$/i, '');
    r.jd = block(firstEl(['[data-qa="job-description"]', '.posting-page .section-wrapper.page-centered', '.posting-page .content']));
    if (r.jd) r.jd = r.jd.replace(/\n(?:Apply for this job|Apply now)\s*$/i, '').trim();
    return r;
  }

  function workday() {
    const r = {};
    const dd = (id) => qa(`[data-automation-id="${id}"] dd`).map((e) => clean(e.textContent)).filter(Boolean).join(' | ');
    r.role = txt('[data-automation-id="jobPostingHeader"]') || txt('h1');
    r.location = dd('locations');
    r.job_type = mapJobType(dd('time'));
    r.work_mode = detectWorkMode(dd('remoteType'), true);
    r.posted = dd('postedOn');
    r.jd = block(q('[data-automation-id="jobPostingDescription"]'));
    return r;
  }

  function ashby() {
    const r = {};
    r.role = txt('h1');
    r.jd = block(firstEl(['[class*="descriptionText"]', '[class*="_description_"]', '.ashby-job-posting-right-pane', 'main']));
    return r;
  }

  function smartrecruiters() {
    const r = {};
    r.role = firstTxt(['h1.job-title', 'h1']);
    r.location = firstTxt(['[itemprop="jobLocation"]', '.job-details li:first-child', 'spl-job-location']);
    r.jd = block(firstEl(['#st-jobDescription', '.job-sections', 'main']));
    return r;
  }

  function handshake() {
    const r = {};
    r.role = firstTxt(['h1', '[data-hook="job-title"]']);
    r.company = firstTxt(['[data-hook="employer-name"]', 'a[href*="/employers/"]']);
    r.jd = block(firstEl(['[data-hook="job-description"]', '[class*="description"]', 'main']));
    return r;
  }

  function glassdoor() {
    const r = {};
    r.role = firstTxt(['h1[data-test="job-title"]', '[class*="JobDetails_jobTitle"]', 'h1']);
    r.company = firstTxt(['[data-test="employer-name"]', '[class*="EmployerProfile_employerNameHeading"]', '[class*="employerName"]']);
    r.location = firstTxt(['[data-test="location"]', '[class*="JobDetails_location"]']);
    r.salary = findSalary(firstTxt(['[data-test="detailSalary"]', '[class*="SalaryEstimate"]']));
    r.jd = block(firstEl(['[class*="JobDetails_jobDescription"]', '#JobDescriptionContainer', '[data-test="jobDescriptionContent"]']));
    return r;
  }

  function generic() {
    const r = {};
    const meta = (p) => { const m = q(`meta[property="${p}"], meta[name="${p}"]`); return m ? clean(m.content) : ''; };
    const title = clean(document.title);
    const tm = title.match(/^(.+?)\s*(?:\||-|–|—|@|\bat\b)\s*(.+)$/);
    r.role = txt('h1') || meta('og:title') || (tm ? tm[1] : title);
    r.company = atsCompanyFromUrl() || meta('og:site_name') || (tm ? tm[2].replace(/\s*(?:careers|jobs|job board|job opportunities|job details).*$/i, '') : '');
    const cands = qa('[class*="description"], [id*="description"], [class*="job-detail"], [id*="job-detail"], [class*="jobDetail"], [class*="posting"], [class*="job-content"], article, main, [role="main"]');
    let best = null; let bestLen = 0;
    for (const el of cands) { const l = (el.innerText || '').length; if (l > bestLen) { best = el; bestLen = l; } }
    if (best && bestLen > 300) r.jd = block(best);
    else { r.jd = block(document.body); r._fromBody = true; }
    return r;
  }

  // ---------- main ----------
  function extract() {
    const source = detectSource(host);
    let site = {};
    let extractor = 'generic';
    try {
      if (source === 'LinkedIn') { site = linkedin(); extractor = 'linkedin'; }
      else if (source === 'Indeed') { site = indeed(); extractor = 'indeed'; }
      else if (source === 'Handshake') { site = handshake(); extractor = 'handshake'; }
      else if (source === 'Glassdoor') { site = glassdoor(); extractor = 'glassdoor'; }
      else if (/greenhouse\.io$/.test(host)) { site = greenhouse(); extractor = 'greenhouse'; }
      else if (/lever\.co$/.test(host)) { site = lever(); extractor = 'lever'; }
      else if (/myworkdayjobs\.com$/.test(host)) { site = workday(); extractor = 'workday'; }
      else if (/ashbyhq\.com$/.test(host)) { site = ashby(); extractor = 'ashby'; }
      else if (/smartrecruiters\.com$/.test(host)) { site = smartrecruiters(); extractor = 'smartrecruiters'; }
    } catch (e) { site = { _err: String(e) }; }
    let ld = {}; try { ld = jsonLd(); } catch (e) { /* ignore */ }
    let gen = {}; try { gen = generic(); } catch (e) { /* ignore */ }
    if (extractor === 'linkedin') {
      // The generic scrape would read the job list and footer on search pages. Use the tab title instead.
      const fb = linkedinTitleFallback();
      gen = { role: liOk(fb.role || ''), company: liOk(fb.company || ''), location: fb.location || '', jd: '' };
    }
    const pick = (k) => site[k] || ld[k] || gen[k] || '';

    const jds = [site.jd, ld.jd, gen.jd].filter(Boolean);
    let jd = site.jd && site.jd.length > 200 ? site.jd : (ld.jd && ld.jd.length > 200 ? ld.jd : jds.sort((a, b) => b.length - a.length)[0] || '');
    jd = jd.slice(0, 30000);

    const r = {
      company: cleanCompany(pick('company') || atsCompanyFromUrl()),
      role: cleanRole(liOk(pick('role'))),
      link: site.link || canonicalLink(),
      source,
      location: pick('location'),
      work_mode: pick('work_mode'),
      job_type: pick('job_type'),
      salary: pick('salary'),
      posted: pick('posted'),
      applicants: pick('applicants'),
      deadline: pick('deadline'),
      seniority: pick('seniority'),
      jd
    };
    if (!r.work_mode) r.work_mode = detectWorkMode(r.location, true) || detectWorkMode(r.jd, false) || 'Unknown';
    if (!r.job_type) r.job_type = (/\bintern(?:ship)?s?\b/i.test(r.role) ? 'Internship' : '') || mapJobType(r.jd) || 'Unknown';
    if (!r.salary) r.salary = findSalary(r.jd) || 'Not stated';
    r.experience = findExperience(r.jd) || 'Not stated';
    if (!r.seniority) r.seniority = seniorityFromTitle(r.role) || '';
    r.auth_lines = authLines(r.jd);
    const sp = classifySponsorship(r.jd, r.auth_lines);
    r.sponsorship = sp.value;
    r.sponsorship_note = sp.note;
    r.page_title = clean(document.title);
    r.page_url = location.href;
    r.extracted_at = new Date().toISOString();
    r._debug = { extractor, site_keys: Object.keys(site).filter((k) => site[k] && !k.startsWith('_')), jsonld: !!ld._jsonld, from_body: !!gen._fromBody, pills: site._pills || [], err: site._err || '' };
    return r;
  }

  window.__jdFillerExtract = extract;
})();
