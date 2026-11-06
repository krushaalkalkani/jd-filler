// autofill.js - injected into the active tab. Fills application forms from a flat values map.
// Does not submit. React/Vue/Workday-friendly (native value setter + input/change events).
(function () {
  // Always replace so reloads pick up new classifier rules.
  window.__jdFillerAutofill = null;

  const VISIBLE = (el) => {
    if (!el || el.disabled || el.readOnly) return false;
    if (el.type === 'hidden') return false;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  function labelText(el) {
    const bits = [];
    if (el.id) {
      try {
        const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lab) bits.push(lab.innerText || lab.textContent);
      } catch (e) { /* ignore */ }
    }
    const wrap = el.closest('label, .field, .form-group, .form-field, .application-field, [class*="FormField"], [class*="form-field"], [class*="formField"], [data-test*="field"], [class*="question"], [data-automation-id*="formField"]');
    if (wrap) bits.push((wrap.innerText || wrap.textContent || '').slice(0, 220));
    const fs = el.closest('fieldset');
    if (fs) {
      const legend = fs.querySelector('legend');
      if (legend) bits.push(legend.innerText || legend.textContent);
    }
    const prev = el.previousElementSibling;
    if (prev && /LABEL|SPAN|P|DIV|LEGEND|H[1-6]/i.test(prev.tagName)) bits.push(prev.innerText || prev.textContent);
    bits.push(
      el.getAttribute('aria-label'),
      el.getAttribute('placeholder'),
      el.getAttribute('name'),
      el.getAttribute('id'),
      el.getAttribute('autocomplete'),
      el.getAttribute('data-automation-id'),
      el.getAttribute('data-testid'),
      el.getAttribute('data-test'),
      el.getAttribute('data-qa')
    );
    return bits.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 500);
  }

  // Workday / Greenhouse / Lever / Ashby data-automation / name hints → key
  const ATTR_HINTS = [
    [/firstName|first_name|firstname|given-name/i, 'first_name'],
    [/lastName|last_name|lastname|family-name/i, 'last_name'],
    [/fullName|full_name|candidateName/i, 'full_name'],
    [/e-?mail/i, 'email'],
    [/phone|mobile|^tel$|tel-/i, 'phone'],
    [/addressLine1|address_?1|street/i, 'street'],
    // \bapt\b so "authorized" does not match.
    [/addressLine2|address_?2|\bapt\b|\bsuite\b|\bunit\b|apartment/i, 'apt'],
    [/postal|zip/i, 'zip'],
    [/\bcity\b/i, 'city'],
    [/countryRegion|region|\bstate\b/i, 'state'],
    [/country(?!Region)/i, 'country'],
    [/linkedin/i, 'linkedin'],
    [/github/i, 'github'],
    [/portfolio|website|homepage/i, 'portfolio'],
    [/school|university|college/i, 'school'],
    [/degree/i, 'degree'],
    [/jobTitle|job_title/i, 'title'],
    [/company|employer/i, 'company']
  ];

  function classifyFromAttrs(el) {
    const blob = [el.name, el.id, el.getAttribute('data-automation-id'), el.getAttribute('autocomplete'), el.getAttribute('data-testid')].filter(Boolean).join(' ');
    if (!blob) return '';
    for (const [re, key] of ATTR_HINTS) if (re.test(blob)) return key;
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    if (ac === 'email') return 'email';
    if (ac === 'tel' || ac === 'tel-national') return 'phone';
    if (ac === 'given-name') return 'first_name';
    if (ac === 'family-name') return 'last_name';
    if (ac === 'name') return 'full_name';
    if (ac === 'street-address') return 'street';
    if (ac === 'address-level2') return 'city';
    if (ac === 'address-level1') return 'state';
    if (ac === 'postal-code') return 'zip';
    if (ac === 'country' || ac === 'country-name') return 'country';
    if (ac === 'organization') return 'company';
    if (ac === 'url') return 'portfolio';
    return '';
  }

  // Ordered: first match wins. Specific before broad.
  const RULES = [
    [/first\s*name|given\s*name|fname|firstname|legal name.*first/i, 'first_name'],
    [/last\s*name|family\s*name|surname|lname|lastname|legal name.*last/i, 'last_name'],
    [/full\s*name|legal\s*name|applicant\s*name|your\s*name|preferred name/i, 'full_name'],
    [/\bname\b(?!.*company)(?!.*school)(?!.*file)/i, 'full_name'],
    [/e-?mail|email\s*address/i, 'email'],
    [/phone|mobile|cell|telephone|phone device type number/i, 'phone'],
    [/street\s*(address|1)|address\s*line\s*1|address\s*1|address line 1/i, 'street'],
    [/address\s*line\s*2|street\s*2|\bapt\b|\bsuite\b|\bunit\b|apartment/i, 'apt'],
    [/\bcity\b|town|location\s*\(\s*city/i, 'city'],
    [/\bstate\b|province|region|countryRegion/i, 'state'],
    [/zip|postal|post\s*code/i, 'zip'],
    [/country(?!\s*region)|nation/i, 'country'],
    [/linkedin/i, 'linkedin'],
    [/github/i, 'github'],
    [/portfolio|personal\s*site|personal\s*website|website|homepage|personal url/i, 'portfolio'],
    [/\bx\.com\b|twitter/i, 'twitter'],
    [/school|university|college|institution/i, 'school'],
    [/degree|diploma/i, 'degree'],
    [/field of study|major|discipline|area of study/i, 'field'],
    [/\bgpa\b|grade point/i, 'gpa'],
    [/graduation|grad\s*date|date.*(graduat|complet)|education.*end|end date.*edu/i, 'edu_end'],
    [/education.*start|start date.*edu|attended from/i, 'edu_start'],
    [/company|employer|organization(?!.*type)/i, 'company'],
    [/job\s*title|position\s*title|most recent title|current title|^title$/i, 'title'],
    [/earliest start|available to start|when can you (start|begin)|availability date|available\b/i, 'start_date'],
    [/employment.*start|employed from|start date.*(job|role|employ)|from date/i, 'exp_start'],
    [/employment.*end|end date.*(job|role|employ)|to date|employed until|currently work/i, 'exp_end'],
    [/summary|about\s*(yourself|you)|cover\s*letter|additional\s*info|why (do )?you|tell us about/i, 'summary'],
    [/authorized.*(work|us|united)|legally authorized|eligible to work|work authorization|right to work/i, 'authorized'],
    [/require.*sponsor|need.*sponsor|will you.*sponsor|sponsorship|visa\s*sponsor|future.*sponsor/i, 'sponsorship'],
    [/visa\s*status|immigration|work\s*status|citizenship status/i, 'visa'],
    [/relocat|willing to move|open to relocation/i, 'relocate'],
    [/pronoun/i, 'pronouns'],
    [/gender|sex\b/i, 'gender'],
    [/hispanic|latino|latina/i, 'hispanic'],
    [/race|ethnicity|ethnic/i, 'race'],
    [/veteran/i, 'veteran'],
    [/disabilit/i, 'disability'],
    [/how did you (hear|find)|hear about|source|referral source/i, 'source'],
    [/salary|compensation|pay\s*expect|desired\s*pay|expected\s*(salary|comp)/i, 'min_pay'],
    [/skills|technical skills/i, 'skills'],
    [/location preference|preferred location|where.*work|work location/i, 'locations']
  ];

  function classify(el) {
    if (el.type === 'file') return '';
    const fromAttr = classifyFromAttrs(el);
    const t = labelText(el);
    if (/password|ssn|social security|credit card/i.test(t) && !/sponsor/i.test(t)) return '';
    if (fromAttr) return fromAttr;
    if (!t) return '';
    for (const [re, key] of RULES) if (re.test(t)) return key;
    return '';
  }

  function setNative(el, value) {
    const str = String(value == null ? '' : value);
    if (el.tagName === 'SELECT') return fillSelect(el, str);
    if (el.type === 'checkbox' || el.type === 'radio') return fillCheckable(el, str);
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, str);
    else el.value = str;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    try { el.dispatchEvent(new InputEvent('input', { bubbles: true, data: str, inputType: 'insertText' })); } catch (e) { /* old browsers */ }
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  function norm(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function fillSelect(el, value) {
    const want = norm(value);
    if (!want) return false;
    let best = null;
    let bestScore = 0;
    for (const opt of el.options) {
      const t = norm(opt.text);
      const v = norm(opt.value);
      if (!t && !v) continue;
      let score = 0;
      if (t === want || v === want) score = 100;
      else if (t.startsWith(want) || want.startsWith(t)) score = 85;
      else if (t.includes(want) || want.includes(t) || v.includes(want) || want.includes(v)) score = 60 + Math.min(20, Math.min(t.length, want.length));
      if (/^(yes|y)$/.test(want) && /^(yes|y)$/.test(t)) score = 100;
      if (/^(no|n)$/.test(want) && /^(no|n)$/.test(t) && !/not|don/.test(t)) score = 100;
      // EEO decline variants
      if (/decline|prefer not|do not want to answer|don't want to answer|i do not want/i.test(want) && /decline|prefer not|do not want|don't want|self identify/i.test(t)) score = Math.max(score, 90);
      if (score > bestScore) { bestScore = score; best = opt; }
    }
    if (!best || bestScore < 50) return false;
    el.value = best.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  function fillCheckable(el, value) {
    const want = norm(value);
    const own = norm((el.labels && el.labels[0] && el.labels[0].innerText) || el.value || '');
    const lab = norm(labelText(el) + ' ' + (el.value || ''));
    let on = false;
    if (/^(yes|true|1)$/.test(want)) {
      on = /^(yes|y|true)$/i.test(el.value) || /^(yes|y)\b/.test(own) || (/yes/.test(own) && !/no/.test(own));
    } else if (/^(no|false|0)$/.test(want)) {
      on = /^(no|n|false)$/i.test(el.value) || /^(no|n)\b/.test(own);
    } else {
      on = lab.includes(want) || own.includes(want) || norm(el.value) === want;
    }
    if (el.type === 'radio') {
      if (!on) return false;
      el.checked = true;
    } else {
      el.checked = !!on;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  }

  function collectFields() {
    return Array.from(document.querySelectorAll('input, textarea, select')).filter((el) => {
      if (!VISIBLE(el)) return false;
      if (el.type === 'submit' || el.type === 'button' || el.type === 'image' || el.type === 'reset') return false;
      return true;
    });
  }

  window.__jdFillerAutofill = function (values) {
    const vals = values || {};
    const filled = [];
    const skipped = [];
    const unknown = [];

    for (const el of collectFields()) {
      const key = classify(el);
      const label = labelText(el).slice(0, 100);
      if (!key) {
        if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /text|search|tel|url|email/.test(el.type || 'text'))) {
          unknown.push({ label, tag: el.tagName.toLowerCase(), type: el.type || '' });
        }
        continue;
      }
      const value = vals[key];
      if (value == null || value === '') {
        skipped.push({ key, label, reason: 'empty profile value' });
        continue;
      }
      // Fill every matching control (Workday repeats first/last; radios need each option tried).
      try {
        const ok = setNative(el, value);
        if (ok) filled.push({ key, label, value: String(value).slice(0, 60) });
        else skipped.push({ key, label, reason: 'no matching option' });
      } catch (e) {
        skipped.push({ key, label, reason: String(e && e.message || e) });
      }
    }

    return {
      filled: filled.length,
      skipped: skipped.length,
      unknown: unknown.length,
      details: { filled, skipped: skipped.slice(0, 30), unknown: unknown.slice(0, 20) },
      href: location.href
    };
  };

  window.__jdFillerAutofillScan = function () {
    return collectFields().map((el) => ({
      key: classify(el),
      label: labelText(el).slice(0, 120),
      tag: el.tagName.toLowerCase(),
      type: el.type || '',
      name: el.name || '',
      id: el.id || '',
      automation: el.getAttribute('data-automation-id') || ''
    }));
  };
})();
