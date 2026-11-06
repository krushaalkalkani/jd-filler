// autofill-values.js - profile → flat map for autofill.js. Loaded by the side panel.
(function (root) {
  function splitName(full) {
    const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return { first: '', last: '' };
    if (parts.length === 1) return { first: parts[0], last: '' };
    return { first: parts[0], last: parts.slice(1).join(' ') };
  }
  function ym(s) {
    const m = String(s || '').trim().match(/^(\d{4})-(\d{2})/);
    if (m) return `${m[2]}/${m[1]}`;
    return String(s || '').trim();
  }
  function yesNo(v) {
    const t = String(v || '').trim().toLowerCase();
    if (/^y|yes|true|1/.test(t)) return 'Yes';
    if (/^n|no|false|0/.test(t)) return 'No';
    return String(v || '').trim();
  }

  function buildAutofillValues(profile) {
    const p = profile || {};
    const a = p.address || {};
    const links = p.links || {};
    const eeo = p.eeo || {};
    const targets = p.targets || {};
    const skills = p.skills || {};
    const edu = (p.education && p.education[0]) || {};
    const exp = (p.experience && p.experience[0]) || {};
    const name = splitName(p.name);

    return {
      full_name: p.name || '',
      first_name: name.first,
      last_name: name.last,
      email: p.email || '',
      phone: p.phone || '',
      street: a.street || '',
      apt: a.apt || '',
      city: a.city || '',
      state: a.state || '',
      zip: a.zip || '',
      country: a.country || 'United States',
      linkedin: links.linkedin || '',
      github: links.github || '',
      portfolio: links.portfolio || links.other || '',
      twitter: links.x || '',
      school: edu.school || '',
      degree: edu.degree || '',
      field: edu.field || '',
      gpa: edu.gpa || '',
      edu_start: ym(edu.start),
      edu_end: ym(edu.end),
      company: exp.company || '',
      title: exp.title || '',
      exp_start: ym(exp.start),
      exp_end: exp.end ? ym(exp.end) : 'Present',
      summary: p.summary || '',
      authorized: yesNo(eeo.authorized),
      sponsorship: yesNo(eeo.sponsorship),
      visa: eeo.visa || '',
      start_date: eeo.startDate || 'Immediately',
      relocate: yesNo(eeo.relocate),
      pronouns: eeo.pronouns || '',
      gender: eeo.gender || 'Decline to self-identify',
      hispanic: eeo.hispanic || 'Decline to self-identify',
      race: eeo.race || 'Decline to self-identify',
      veteran: eeo.veteran || 'Decline to self-identify',
      disability: eeo.disability || 'I do not want to answer',
      source: eeo.source || 'LinkedIn',
      min_pay: targets.minPay ? `$${Number(targets.minPay).toLocaleString('en-US')}` : '',
      locations: targets.locations || '',
      skills: [skills.proven, skills.listed].filter(Boolean).join(', ')
    };
  }

  root.buildAutofillValues = buildAutofillValues;
})(typeof window !== 'undefined' ? window : globalThis);
