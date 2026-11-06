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

  function isLinkedInHost(h) {
    return /(^|\.)linkedin\.com$/i.test(String(h || '').replace(/^www\./, ''));
  }

  // Unwrap LinkedIn redirect wrappers (safety/go, externalApply) and strip tracking params.
  function normalizeExternalUrl(href) {
    if (!href || !/^https?:/i.test(href)) return '';
    try {
      let u = new URL(href, location.origin);
      for (let i = 0; i < 3; i++) {
        const nested = u.searchParams.get('url') || u.searchParams.get('dest') || u.searchParams.get('redirectUrl');
        if (isLinkedInHost(u.hostname) && nested && /^https?:/i.test(nested)) {
          u = new URL(nested);
          continue;
        }
        break;
      }
      if (isLinkedInHost(u.hostname)) return '';
      const strip = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gh_src', 'gh_jid', 'lever-source', 'ref', 'refId', 'trackingId', 'trk', 'original_referer', 'fbclid', 'gclid', '_gl', 'mc_cid', 'mc_eid', 'eBP', 'refId', 'trackingId'];
      for (const k of [...u.searchParams.keys()]) if (strip.includes(k) || /^utm_/i.test(k)) u.searchParams.delete(k);
      u.hash = '';
      return u.href;
    } catch (e) { return ''; }
  }

  // Company career / ATS Apply URL from the LinkedIn offsite Apply control. Easy Apply has no URL -> ''.
  function linkedinOfficialLink(root) {
    const scope = root || document;
    const sels = [
      'a[data-tracking-control-name*="apply-link-offsite"]',
      'a[data-control-name*="apply_link_offsite"]',
      'a[data-control-name*="apply-link-offsite"]',
      'a[href*="externalApply"]',
      'a[href*="safety/go"]',
      'a.jobs-apply-button[href]',
      'a[class*="jobs-apply-button"][href]',
      '.jobs-apply-button--top-card a[href]',
      '.jobs-s-apply a[href]',
      'a[aria-label*="Apply"][href]',
      'a[aria-label*="apply"][href]',
      'a[aria-label*="company website"][href]'
    ];
    const seen = new Set();
    const cands = [];
    for (const sel of sels) {
      for (const a of qa(sel, scope)) {
        const href = a.href || a.getAttribute('href') || '';
        if (!href || seen.has(href)) continue;
        seen.add(href);
        cands.push(a);
      }
    }
    for (const a of qa('a[href]', scope)) {
      const label = clean(a.getAttribute('aria-label') || a.innerText || a.textContent);
      if (!/^(?:apply|apply on .+|apply for this job)/i.test(label) && !/\bapply\b/i.test(label)) continue;
      if (/easy apply/i.test(label)) continue;
      const href = a.href || a.getAttribute('href') || '';
      if (!href || seen.has(href)) continue;
      seen.add(href);
      cands.push(a);
    }
    for (const a of cands) {
      const out = normalizeExternalUrl(a.href || a.getAttribute('href') || '');
      if (out) return out;
    }
    return '';
  }

  function cleanCompany(s) {
    return clean(s).replace(/^\d{2,}\s+/, '').replace(/^at\s+/i, '').replace(/\s*(?:logo|·\s*follow|follow)$/i, '').replace(/\s*\(.*?hiring.*?\)$/i, '').trim();
  }

  function imgUrl(el) {
    if (!el) return '';
    const raw = el.currentSrc || el.src || el.getAttribute('data-delayed-url') || el.getAttribute('data-src') || el.getAttribute('data-ghost-url') || '';
    if (raw && /^https?:/i.test(raw) && !/spacer|blank|pixel|data:image\/gif/i.test(raw)) return raw;
    const srcset = el.getAttribute('srcset') || '';
    if (srcset) {
      const first = srcset.split(',')[0].trim().split(/\s+/)[0];
      if (first && /^https?:/i.test(first)) return first;
    }
    return '';
  }

  function absUrl(href) {
    if (!href || href === '#') return '';
    try {
      const u = new URL(href, location.href);
      if (!/^https?:$/i.test(u.protocol)) return '';
      u.hash = '';
      return u.href;
    } catch (e) { return ''; }
  }

  // LinkedIn embeds logo + /company/ link in the DOM. After Apply, Greenhouse / Lever / Ashby
  // pages often only expose the brand in meta tags and an outbound careers link.
  function metaLogo() {
    for (const sel of [
      'meta[property="og:image"]',
      'meta[name="twitter:image"]',
      'meta[name="twitter:image:src"]',
      'link[rel="apple-touch-icon"]',
      'link[rel="icon"][sizes="192x192"]',
      'link[rel="icon"][sizes="180x180"]'
    ]) {
      const el = q(sel);
      if (!el) continue;
      const raw = (el.getAttribute('content') || el.getAttribute('href') || '').trim();
      const u = absUrl(raw) || (/^https?:/i.test(raw) ? raw : '');
      if (u && !/spacer|blank|pixel|1x1/i.test(u)) return u;
    }
    return '';
  }

  function externalCompanyUrl(root) {
    // Skip ATS / social / legal hosts. Prefer a short careers / jobs / homepage path.
    const skipHost = /(^|\.)(greenhouse\.(io|com)|lever\.co|ashbyhq\.com|myworkdayjobs\.com|myworkdaysite\.com|smartrecruiters\.com|icims\.com|jobvite\.com|workable\.com|bamboohr\.com|rippling\.com|linkedin\.com|twitter\.com|x\.com|facebook\.com|instagram\.com|youtube\.com|google\.com|gstatic\.com|apple\.com|microsoft\.com|jamsadr\.com|cloudflare\.com|recaptcha\.net)$/i;
    const skipPath = /\/(privacy|terms|login|sign[_-]?in|cookie|legal|arbitration|users\/|auth)/i;
    let best = '';
    let bestScore = -1;
    for (const a of qa('a[href^="http"]', root)) {
      let u;
      try { u = new URL(a.getAttribute('href') || a.href, location.href); } catch (e) { continue; }
      if (!/^https?:$/i.test(u.protocol)) continue;
      const h = u.hostname.replace(/^www\./, '');
      if (skipHost.test(h) || h === host) continue;
      if (skipPath.test(u.pathname)) continue;
      const path = u.pathname.replace(/\/+$/, '') || '/';
      let score = 1;
      if (path === '/' || path === '') score = 5;
      else if (/^\/(jobs|careers|about|company|team)(\/|$)/i.test(path)) score = 4;
      else if (/jobs|careers/i.test(path)) score = 3;
      if (score > bestScore) {
        bestScore = score;
        u.hash = '';
        u.search = '';
        best = u.href;
        if (score >= 5) break;
      }
    }
    return best;
  }

  function companyFromTitle() {
    const t = clean(document.title);
    const m = t.match(/\bat\s+(.+?)\s*$/i) || t.match(/\bat\s+(.+?)\s*[|\u2013\u2014-]/i);
    return m ? cleanCompany(m[1]) : '';
  }

  // Company logo + profile/website link from the job header.
  function companyBrand(root) {
    const out = {};
    if (!root) return out;
    const nameA = qa('a[href*="/company/"]', root).find((a) => {
      const t = clean(a.innerText || a.textContent);
      return t && t.length < 80 && !/follow|see all|jobs/i.test(t);
    });
    if (nameA) out.company_url = absUrl(nameA.getAttribute('href') || nameA.href);
    const img = firstEl([
      '.job-details-jobs-unified-top-card__company-logo img',
      '.jobs-unified-top-card__company-logo img',
      '.artdeco-entity-image',
      '[class*="company-logo"] img',
      '[class*="EntityPhoto"]',
      'a[href*="/company/"] img',
      'img[alt*="logo" i]',
      'img[alt*="Logo"]'
    ], root);
    const u = imgUrl(img);
    if (u) out.logo = u;
    return out;
  }
  function cleanRole(s) {
    const t = clean(s).replace(/\s*-\s*job post$/i, '').replace(/\s*\|\s*linkedin$/i, '').replace(/\s+at\s+[^|]+$/i, (m) => (m.length > 40 ? '' : m)).trim();
    if (/^(?:re)?captcha$|cloudflare|attention required|just a moment|enable javascript|privacy error|access denied/i.test(t)) return '';
    return t;
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
      if (org && typeof org === 'object') {
        const logo = org.logo;
        out.logo = typeof logo === 'string' ? logo : (logo && (logo.url || logo.contentUrl)) || '';
        const same = org.sameAs ? [].concat(org.sameAs).find((x) => /^https?:/i.test(x)) : '';
        out.company_url = same || org.url || '';
      }
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
  // Text from LinkedIn chrome or from widgets other extensions inject into the page
  // (Jobright "Partial Match, Let's Make it Perfect", Tsenta, Simplify, Premium cards).
  // Never accept it as a role or company.
  const LI_JUNK = /low match|partial match|strong match|good match|fair match|weak match|top applicant|premium|match details|make it perfect|make it unmissable|keywords are present|keywords match|assess how you fit|how you compare|your job match|people you can reach|company insights|job search|jobs you may|similar jobs|skip to|set alert|about the job/i;
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

  // "Sunnyvale, CA · 4 days ago · Over 100 people clicked apply" -> location / posted / applicants.
  function parseLinkedinPrim(prim, r) {
    if (!prim) return;
    const pm = prim.match(/(?:(?:re)?posted\s+)?\d+\s*(?:minutes?|hours?|days?|weeks?|months?)\s+ago/i);
    if (pm && !r.posted) r.posted = clean(pm[0]);
    const am = prim.match(/(?:over\s+|fewer than\s+)?\d+\+?\s*(?:applicants?|people clicked apply)|be an early applicant|be among the first \d+ applicants/i);
    if (am && !r.applicants) r.applicants = clean(am[0]);
    if (!r.location) {
      const parts = prim.split(/\s*[·•|]\s*/).map(clean).filter(Boolean)
        .filter((p) => p.toLowerCase() !== (r.company || '').toLowerCase())
        .filter((p) => !/\bago\b|^(?:re)?posted|applicant|people clicked apply|easy apply|promoted|viewed|actively|matches your|see who|responses managed/i.test(p) && !/^\d+$/.test(p));
      if (parts.length) r.location = parts[0];
    }
  }

  const LI_PILL = /^(?:on-?site|remote|hybrid|full-?time|part-?time|internship|contract|temporary|volunteer|entry level|associate|mid-senior level|director|executive|(?:\$|USD)\s?[\d,.]+[kK]?(?:\s*\/\s*(?:yr|hr|year|hour|month))?(?:\s*(?:-|–|to)\s*(?:\$|USD)?\s?[\d,.]+[kK]?(?:\s*\/\s*(?:yr|hr|year|hour|month))?)?)$/i;

  // LinkedIn's 2025 job page (and the new AI job search) ships only hashed class names, so the
  // class-based reader finds nothing. Read it by structure instead: the tab title, the biggest
  // short text in the pane, the line with "N days ago", chip-sized text, and the "About the job" heading.
  function linkedinNew(pane) {
    const r = {};
    const isJunk = (t) => !t || LI_JUNK.test(t);
    const leafish = (el) => el.children.length <= 2;
    const pageText = pane.innerText || '';
    const fb = linkedinTitleFallback();
    const textEls = qa('h1, h2, h3, p, span, div, a', pane);

    let titleEl = null;
    if (fb.role && !isJunk(fb.role) && pageText.includes(fb.role)) {
      r.role = fb.role;
      // The job list repeats the title in small type; the detail pane sets it big.
      const fs = (el) => parseFloat(getComputedStyle(el).fontSize) || 0;
      titleEl = textEls.filter((el) => leafish(el) && clean(el.innerText) === fb.role).sort((a, b) => fs(b) - fs(a))[0] || null;
    }
    if (!r.role) {
      let best = null; let bestFs = 0;
      for (const el of textEls) {
        if (!leafish(el)) continue;
        const t = clean(el.innerText);
        if (!t || t.length < 4 || t.length > 120 || /^\d/.test(t) || isJunk(t)) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize) || 0;
        if (fs >= 18 && fs > bestFs) { bestFs = fs; best = el; }
      }
      if (best) { r.role = clean(best.innerText); titleEl = best; }
    }
    const follows = (el) => !titleEl || !!(titleEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    const precedes = (el) => !titleEl || !!(titleEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING);

    if (fb.company && !isJunk(fb.company) && pageText.includes(fb.company)) r.company = fb.company;
    if (!r.company) {
      const links = qa('a[href*="/company/"]', pane).filter((a) => { const t = clean(a.innerText); return t && t.length < 80 && !isJunk(t); });
      const near = links.filter(precedes).pop() || links.find(follows) || links[0];
      if (near) r.company = clean(near.innerText);
    }
    Object.assign(r, companyBrand(pane));

    // "N days ago" sits in its own span; climb to the line that also holds the location and applicant count.
    let primEl = qa('p, div, span', pane).find((el) => el.children.length <= 6 && follows(el)
      && /\d+\s*(?:minutes?|hours?|days?|weeks?|months?)\s+ago/i.test(el.innerText || '') && (el.innerText || '').length < 220);
    while (primEl && primEl.parentElement && primEl.parentElement !== pane
      && !(titleEl && primEl.parentElement.contains(titleEl)) && (primEl.parentElement.innerText || '').length < 220) primEl = primEl.parentElement;
    if (primEl) {
      const line = (primEl.innerText || '').split('\n').map(clean).find((l) => /\bago\b/i.test(l)) || clean(primEl.innerText);
      parseLinkedinPrim(line, r);
    }

    const aboutH = qa('h1, h2, h3, h4', pane).find((h) => /^about the job$/i.test(clean(h.innerText)) && follows(h));
    const beforeAbout = (el) => !aboutH || !!(aboutH.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING);
    const pills = [];
    for (const el of qa('a, button, span, li, div', pane)) {
      if (!leafish(el) || !follows(el) || !beforeAbout(el)) continue;
      const t = clean(el.innerText);
      if (t && LI_PILL.test(t) && !pills.includes(t)) pills.push(t);
    }
    r._pills = pills;

    if (aboutH) {
      let c = aboutH; let i = 0;
      while (c.parentElement && c.parentElement !== pane && (c.innerText || '').length < 800 && i < 8) { c = c.parentElement; i++; }
      r.jd = block(c);
    }
    return r;
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
    ], pane);
    const notJunk = (el) => !el.closest('[class*="premium"], [class*="how-you-match"], [class*="insight-card"], [class*="people-you"], footer, nav');
    const official = linkedinOfficialLink(top || pane);
    if (official) r.link = official;

    if (top) {
      // Classic layout with named classes. No bare h1 fallback: injected widgets own h1s too.
      r.role = liOk(firstTxt([
        '.job-details-jobs-unified-top-card__job-title h1', '.job-details-jobs-unified-top-card__job-title',
        '.jobs-unified-top-card__job-title h1', '.jobs-unified-top-card__job-title',
        'h1.top-card-layout__title', '.topcard__title', '.jobs-details-top-card__job-title', '[class*="job-title"] h1', '[class*="job-title"]', 'h1.t-24'
      ], top));
      r.company = liOk(firstTxt([
        '.job-details-jobs-unified-top-card__company-name a', '.job-details-jobs-unified-top-card__company-name',
        '.jobs-unified-top-card__company-name a', '.jobs-unified-top-card__company-name',
        '[class*="company-name"]', 'a.topcard__org-name-link', '.topcard__org-name-link',
        '.top-card-layout__second-subline a[href*="/company/"]', 'a[href*="/company/"]'
      ], top));
      Object.assign(r, companyBrand(top));

      const prim = firstTxt([
        '.job-details-jobs-unified-top-card__tertiary-description-container', '.job-details-jobs-unified-top-card__primary-description-container',
        '.jobs-unified-top-card__primary-description', '.jobs-unified-top-card__subtitle-primary-grouping',
        '[class*="tertiary-description"]', '[class*="primary-description"]',
        '.top-card-layout__second-subline', '.topcard__flavor-row'
      ], top);
      r.location = firstTxt(['.topcard__flavor--bullet', '.job-details-jobs-unified-top-card__bullet', '.jobs-unified-top-card__bullet', '[class*="__bullet"]'], top);
      parseLinkedinPrim(prim, r);
      r.posted = r.posted || firstTxt(['.posted-time-ago__text', '[class*="posted-date"]'], top);
      r.applicants = r.applicants || firstTxt(['.num-applicants__caption', '[class*="applicant-count"]'], top);

      // Pills under the top card: "Remote", "Hybrid", "Full-time", "$120K/yr - $150K/yr", "Mid-Senior level".
      r._pills = qa([
        '.job-details-preferences-and-skills__pill', '.job-details-fit-level-preferences button',
        '.jobs-unified-top-card__job-insight span', '.job-details-jobs-unified-top-card__job-insight span',
        '.job-details-jobs-unified-top-card__job-insight-view-model-secondary', 'li.job-details-jobs-unified-top-card__job-insight',
        '[class*="job-insight"]', '[class*="workplace-type"]', '[class*="__pill"]'
      ].join(', '), pane).filter(notJunk).map((e) => clean(e.innerText || e.textContent)).filter((t) => t && t.length < 160);
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
    }

    if (!r.role || !r.jd) {
      // New hashed-class layout (or the classic one failed): fill whatever is still missing.
      let fresh = {};
      try { fresh = linkedinNew(q('main') || pane); } catch (e) { r._err = String(e); }
      for (const k of Object.keys(fresh)) if (!r[k] || (Array.isArray(r[k]) && !r[k].length)) r[k] = fresh[k];
    }

    for (const p of r._pills || []) {
      const wm = detectWorkMode(p, true); if (wm && !r.work_mode) r.work_mode = wm;
      const jt = mapJobType(p); if (jt && !r.job_type) r.job_type = jt;
      const sal = findSalary(p); if (sal && !r.salary) r.salary = sal;
      const sen = p.match(/\b(internship|entry level|associate|mid-senior level|director|executive)\b/i); if (sen && !r.seniority) r.seniority = sen[1];
    }
    r.role = liOk(r.role);
    r.company = liOk(r.company);
    if (!r.logo || !r.company_url) Object.assign(r, Object.fromEntries(Object.entries(companyBrand(pane)).filter(([k, v]) => v && !r[k])));
    if (r.jd) {
      r.jd = r.jd
        .replace(/^About the job\s*/i, '')
        .replace(/\s*(?:Show more|Show less|…\s*more|\.\.\.\s*more|see more|see less)\s*$/i, '')
        .replace(/\n\s*(?:Show more|Show less|…\s*more|\.\.\.\s*more)\s*(?=\n|$)/gi, '')
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
    const coA = firstEl(['[data-testid="inlineHeader-companyName"] a', '[data-company-name="true"] a', '[data-testid="jobsearch-CompanyInfoContainer"] a']);
    if (coA) r.company_url = absUrl(coA.href);
    const coImg = firstEl(['[data-testid="jobsearch-CompanyHeader"] img', '[data-testid="inlineHeader-companyAvatar"] img', 'img[alt*="logo" i]']);
    if (coImg) r.logo = imgUrl(coImg);
    r.location = firstTxt(['[data-testid="inlineHeader-companyLocation"]', '[data-testid="jobsearch-JobInfoHeader-companyLocation"]', '[data-testid="job-location"]']);
    const meta = firstTxt(['#salaryInfoAndJobType', '[data-testid="jobsearch-OtherJobDetailsContainer"]', '#jobDetailsSection']);
    if (meta) { r.salary = findSalary(meta); r.job_type = mapJobType(meta); r.work_mode = detectWorkMode(meta, true); }
    r.jd = block(firstEl(['#jobDescriptionText', '.jobsearch-JobComponent-description', '[data-testid="jobsearch-JobComponent-description"]']));
    return r;
  }

  function greenhouse() {
    const r = {};
    r.role = firstTxt(['h1.section-header', '.app-title', '.job__title h1', 'h1.job__title', 'h1']);
    r.company = firstTxt(['.company-name', '.job__company', '#header .company-name']) || companyFromTitle();
    r.location = firstTxt(['.job__location', '.location', '.body--metadata']);
    const logo = firstEl(['.logo img', 'a.logo img', '.company-logo img', 'header img', 'img[alt*="logo" i]']);
    if (logo) r.logo = imgUrl(logo);
    if (!r.logo) r.logo = metaLogo();
    r.company_url = externalCompanyUrl() || '';
    // Last resort: the Greenhouse board home for this employer (still clickable).
    if (!r.company_url) {
      const slug = url.pathname.split('/').filter(Boolean)[0];
      if (slug && slug !== 'embed' && slug !== 'jobs') r.company_url = `https://${url.hostname}/${slug}`;
    }
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
    if (logo) {
      r.logo = imgUrl(logo);
      if (logo.alt) r.company = clean(logo.alt).replace(/\s*logo$/i, '');
    }
    if (!r.logo) r.logo = metaLogo();
    if (!r.company) r.company = companyFromTitle();
    const home = firstEl(['.main-header-logo a', 'a.main-header-logo']);
    if (home) r.company_url = absUrl(home.href);
    if (!r.company_url) r.company_url = externalCompanyUrl();
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

  // Ashby SSR embeds the posting in window.__appData. Content scripts run in an isolated
  // world, so page `window.__appData` is invisible here. Read a MAIN-world bridge
  // (`__jdFillerAppData`) or parse the inline <script> text from the DOM instead.
  function parseAshbyAppDataText(t) {
    if (!t || t.indexOf('__appData') < 0) return null;
    const marker = t.indexOf('window.__appData');
    if (marker < 0) return null;
    const start = t.indexOf('{', marker);
    if (start < 0) return null;
    let depth = 0;
    for (let i = start; i < t.length; i++) {
      const c = t[i];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(t.slice(start, i + 1)); } catch (e) { return null; }
        }
      }
    }
    return null;
  }

  function ashbyAppData() {
    try {
      if (window.__jdFillerAppData && typeof window.__jdFillerAppData === 'object') return window.__jdFillerAppData;
    } catch (e) { /* ignore */ }
    for (const s of qa('script')) {
      const data = parseAshbyAppDataText(s.textContent || '');
      if (data && (data.posting || data.jobBoard)) return data;
    }
    return null;
  }

  function isAshbyPage() {
    if (/ashbyhq\.com$/.test(host)) return true;
    try { if (window.__jdFillerAppData && window.__jdFillerAppData.posting) return true; } catch (e) { /* ignore */ }
    return qa('script').some((s) => /window\.__appData\s*=/.test(s.textContent || ''));
  }

  function mapAshbyEmployment(t) {
    const key = String(t || '').replace(/\s+/g, '');
    const table = {
      FullTime: 'Full-time', PartTime: 'Part-time', Intern: 'Internship', Internship: 'Internship',
      Contract: 'Contract', Temporary: 'Contract', Volunteer: 'Volunteer', Seasonal: 'Contract'
    };
    return table[key] || mapJobType(String(t || '').replace(/([a-z])([A-Z])/g, '$1 $2'));
  }

  function mapAshbyWorkplace(t) {
    const s = String(t || '');
    if (/remote/i.test(s)) return 'Remote';
    if (/hybrid/i.test(s)) return 'Hybrid';
    if (/on\s*-?\s*site|onsite/i.test(s)) return 'On-site';
    return detectWorkMode(s, true);
  }

  function ashby() {
    const r = {};
    const data = ashbyAppData();
    const posting = data && data.posting;
    const org = data && data.organization;
    if (posting && posting.title) {
      r.role = clean(posting.title);
      if (org && org.name) r.company = clean(org.name);
      if (org && org.publicWebsite) r.company_url = absUrl(org.publicWebsite);
      else if (org && org.customJobsPageUrl) r.company_url = absUrl(org.customJobsPageUrl);
      const theme = org && org.theme;
      if (theme) r.logo = theme.logoWordmarkUrl || theme.logoSquareUrl || theme.logoUrl || '';
      r.location = clean([posting.locationName].concat(posting.secondaryLocationNames || []).filter(Boolean).join(' | '));
      r.work_mode = mapAshbyWorkplace(posting.workplaceType) || (posting.isRemote ? 'Remote' : '');
      r.job_type = mapAshbyEmployment(posting.employmentType);
      r.salary = clean(posting.compensationTierSummary || posting.scrapeableCompensationSalarySummary || '');
      if (posting.publishedDate) r.posted = String(posting.publishedDate).slice(0, 10);
      if (posting.descriptionPlainText) r.jd = String(posting.descriptionPlainText).trim();
      else if (posting.descriptionHtml) r.jd = htmlToText(posting.descriptionHtml);
      r._ashby = true;
      return r;
    }
    // Hydrated DOM fallback (same idea as before the __appData change).
    r.role = firstTxt([
      '[class*="ashby-job-posting-heading"]', '[class*="JobPosting"] h1', '[class*="jobPosting"] h1', 'h1'
    ]);
    if (/recaptcha|captcha/i.test(r.role || '')) r.role = '';
    r.jd = block(firstEl([
      '[class*="descriptionText"]', '[class*="_description_"]', '.ashby-job-posting-right-pane',
      '[class*="JobDescription"]', 'article', 'main'
    ]));
    if (r.jd && /recaptcha|enable javascript to run this app/i.test(r.jd) && r.jd.length < 800) r.jd = '';
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
      else if (isAshbyPage()) { site = ashby(); extractor = 'ashby'; }
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
      logo: pick('logo'),
      company_url: pick('company_url'),
      jd
    };
    // After LinkedIn Apply → ATS board, logo/URL often only exist as og:image / outbound careers links.
    if (!r.logo) r.logo = metaLogo();
    if (!r.company_url) r.company_url = externalCompanyUrl();
    if (r.company_url) r.company_url = absUrl(r.company_url) || r.company_url;
    if (r.logo && !/^https?:/i.test(r.logo)) r.logo = '';
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
