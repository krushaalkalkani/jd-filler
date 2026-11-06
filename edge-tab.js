// edge-tab.js - content script. A small tab pinned to the right edge of job pages that opens the JD Filler
// side panel, shows the latest score, and can be dragged up or down. Lives in a closed shadow root so the
// page's CSS cannot touch it (and it cannot touch the page).
(() => {
  if (window.top !== window) return;
  // After a reload at chrome://extensions the previous copy is a zombie, but its chrome.*
  // handle is dead. Call its cleanup (DOM + timers) so reinjection can take over. The
  // extension id does not change on reload, so a boolean / id flag cannot gate this.
  try {
    if (typeof window.__jdfEdgeTabCleanup === 'function') window.__jdfEdgeTabCleanup();
  } catch (e) { /* ignore */ }
  try { clearInterval(window.__jdfEdgeTabNavTimer); } catch (e) { /* ignore */ }
  window.__jdfEdgeTabNavTimer = 0;
  document.querySelectorAll('#jdf-edge-tab').forEach((el) => el.remove());
  try { if (!chrome.runtime || !chrome.runtime.id) return; } catch (e) { return; }

  const JOB_HOSTS = /(^|\.)(indeed\.com|glassdoor\.[a-z.]+|joinhandshake\.com|greenhouse\.io|lever\.co|myworkdayjobs\.com|myworkdaysite\.com|ashbyhq\.com|smartrecruiters\.com|icims\.com|jobvite\.com|workable\.com|bamboohr\.com|rippling\.com|dice\.com|ziprecruiter\.com|wellfound\.com|builtin\.com|simplify\.jobs|jobright\.ai|breezy\.hr|recruitee\.com|teamtailor\.com|pinpointhq\.com|jazzhr\.com|applytojob\.com|taleo\.net|successfactors\.(com|eu)|ultipro\.com|paylocity\.com|dayforcehcm\.com|oraclecloud\.com|careers\.[^.]+\.[a-z]+|jobs\.[^.]+\.[a-z]+)$/i;
  const JOB_PATH = /(^|[\/_-])(jobs?|careers?|positions?|openings?|vacanc(y|ies)|requisitions?|job-?details?|viewjob|apply|application|candidate|talent|hiring|recruit(ing|ment)?)([\/_?=-]|$)/i;

  function looksLikeJob() {
    const host = location.hostname.replace(/^www\./, '');
    if (/(^|\.)linkedin\.com$/.test(host)) return /^\/jobs\//.test(location.pathname) || /currentJobId=/.test(location.search);
    if (JOB_HOSTS.test(host)) return true;
    if (JOB_PATH.test(location.pathname + location.search)) return true;
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) if (/"JobPosting"/.test(s.textContent || '')) return true;
    // An application form: a resume / CV upload field.
    for (const f of document.querySelectorAll('input[type="file"]')) {
      const near = [f.name, f.id, f.getAttribute('aria-label'), f.accept, f.closest('label, fieldset, div') && f.closest('label, fieldset, div').textContent.slice(0, 200)].join(' ');
      if (/resume|r\u00e9sum\u00e9|\bcv\b|cover letter/i.test(near)) return true;
    }
    return false;
  }

  // ---------- DOM ----------
  const host = document.createElement('div');
  host.id = 'jdf-edge-tab';
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483646; right: 0; top: 40%; display: none;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .wrap { position: relative; font: 500 12px/1.3 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", system-ui, sans-serif; }
      .docked .card { border-radius: 18px; transform: none !important; }
      .card {
        display: flex; align-items: stretch; background: #fff; border-radius: 18px 0 0 18px; overflow: hidden;
        box-shadow: 0 10px 30px -8px rgba(15, 23, 42, .28), 0 2px 6px rgba(15, 23, 42, .08), 0 0 0 1px rgba(15, 23, 42, .06);
        transform: translateX(4px); transition: transform .22s cubic-bezier(.2, .8, .2, 1), box-shadow .2s;
      }
      .wrap:hover .card, .wrap:focus-within .card, .dragging .card { transform: translateX(0); box-shadow: 0 16px 40px -10px rgba(15, 23, 42, .36), 0 2px 6px rgba(15, 23, 42, .1), 0 0 0 1px rgba(15, 23, 42, .08); }
      .body { display: flex; align-items: center; min-width: 0; }
      .tab { all: unset; box-sizing: border-box; cursor: pointer; user-select: none; display: flex; align-items: center; }
      .tab:focus-visible { outline: 2px solid #6366f1; outline-offset: -2px; border-radius: 18px 0 0 18px; }
      /* Details that slide out to the left on hover. The card is anchored to the right edge, so it grows leftward. */
      .info {
        max-width: 0; opacity: 0; overflow: hidden; white-space: nowrap; display: flex; flex-direction: column; gap: 2px;
        padding-left: 0; transition: max-width .26s cubic-bezier(.2, .8, .2, 1) .12s, opacity .16s .08s, padding .26s .12s;
      }
      .wrap:hover .info, .wrap:focus-within .info { max-width: 210px; opacity: 1; padding-left: 16px; transition-delay: 0s, .06s, 0s; }
      .dragging .info { max-width: 0 !important; opacity: 0 !important; padding-left: 0 !important; }
      .info-title { font-size: 13px; font-weight: 700; color: #0f172a; letter-spacing: -.01em; }
      .info-score { font-size: 12px; font-weight: 650; color: var(--band-ink, #4f46e5); }
      .info-hint { font-size: 11px; color: #64748b; }
      .info-hint kbd { font: 600 10px/1 inherit; color: #475569; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 4px; padding: 2px 4px; margin-left: 2px; }
      .af {
        all: unset; box-sizing: border-box; margin-top: 6px; align-self: flex-start; cursor: pointer;
        font: 650 11px/1 inherit; color: #4338ca; background: #eef0ff; border: 1px solid rgba(79, 70, 229, .18);
        border-radius: 6px; padding: 5px 8px; transition: background .15s, color .15s;
      }
      .af:hover { background: #4f46e5; color: #fff; }
      .af[aria-busy="true"] { opacity: .55; cursor: default; pointer-events: none; }
      .af.ok { background: #d1fae5; color: #047857; border-color: rgba(4, 120, 87, .2); }
      .af.err { background: #fee2e2; color: #b91c1c; border-color: rgba(185, 28, 28, .2); }
      .face { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; padding: 10px 14px 10px 11px; }
      .logo { width: 38px; height: 38px; display: block; filter: drop-shadow(0 3px 6px rgba(11, 11, 24, .35)); transition: transform .2s; }
      .wrap:hover .logo { transform: scale(1.05); }
      .label {
        display: none; min-width: 30px; height: 18px; padding: 0 6px; border-radius: 99px; text-align: center;
        font-size: 11px; line-height: 18px; font-weight: 700; letter-spacing: -.01em; font-variant-numeric: tabular-nums;
        color: var(--band-ink); background: var(--band-soft);
      }
      .scored .label { display: block; }
      /* Only the grip moves the card, so a click on the card never drags it by accident. */
      /* The grip stays hidden until the card is hovered (or being dragged), so at rest it is just the logo. */
      .grip {
        width: 0; opacity: 0; overflow: hidden; display: grid; place-content: center; gap: 3px; grid-template-columns: repeat(2, 3px);
        background: #eef0ff; border-left: 0 solid rgba(79, 70, 229, .08); cursor: ns-resize; touch-action: none;
        transition: background .2s, width .22s cubic-bezier(.2, .8, .2, 1) .1s, opacity .15s .1s;
      }
      .wrap:hover .grip, .wrap:focus-within .grip, .dragging .grip { width: 16px; opacity: 1; border-left-width: 1px; transition-delay: 0s; }
      .grip:hover { background: #e0e3ff; }
      .grip i { width: 3px; height: 3px; border-radius: 50%; background: #a5a9f3; transition: background .2s; }
      .open .grip { background: linear-gradient(180deg, #6366f1, #4338ca); }
      .open .grip i { background: rgba(255, 255, 255, .85); }
      .dragging, .dragging * { cursor: grabbing !important; }
      .x {
        all: unset; position: absolute; left: -8px; top: -8px; width: 20px; height: 20px; border-radius: 50%; cursor: pointer;
        display: grid; place-items: center; background: #fff; color: #111827;
        box-shadow: 0 1px 4px rgba(15, 23, 42, .25), 0 0 0 1px rgba(15, 23, 42, .06);
        opacity: 0; transform: scale(.8); transition: opacity .15s, transform .15s;
      }
      .x svg { width: 9px; height: 9px; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; }
      .wrap:hover .x, .x:focus-visible { opacity: 1; transform: scale(1); }
      .APPLY { --band-ink: #047857; --band-soft: #d1fae5; }
      .MAYBE { --band-ink: #b45309; --band-soft: #fef3c7; }
      .SKIP  { --band-ink: #b91c1c; --band-soft: #fee2e2; }
      @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
      @media print { .wrap { display: none; } }
    </style>
    <div class="wrap">
      <div class="card">
        <div class="body">
          <span class="info">
            <span class="info-title">JD Filler</span>
            <span class="info-score"></span>
            <span class="info-hint"></span>
            <span class="af" role="button" tabindex="0" title="Fill the form on this page from your profile">Autofill</span>
          </span>
          <button class="tab" aria-label="Open JD Filler side panel">
            <span class="face">
              <svg class="logo" viewBox="0 0 32 32" aria-hidden="true">
                <defs>
                  <linearGradient id="jdf-t" x1="4" y1="0" x2="28" y2="32" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2E2E66"/><stop offset="1" stop-color="#0B0B18"/></linearGradient>
                  <linearGradient id="jdf-a" x1="5" y1="24" x2="27" y2="24" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#C084FC"/><stop offset=".5" stop-color="#818CF8"/><stop offset="1" stop-color="#34D399"/></linearGradient>
                </defs>
                <rect width="32" height="32" rx="8" fill="url(#jdf-t)"/>
                <circle cx="16" cy="16.75" r="9.75" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="3" stroke-linecap="round" stroke-dasharray="45.9 61.3" transform="rotate(135 16 16.75)"/>
                <circle class="arc" cx="16" cy="16.75" r="9.75" fill="none" stroke="url(#jdf-a)" stroke-width="3" stroke-linecap="round" stroke-dasharray="36.5 61.3" transform="rotate(135 16 16.75)"/>
                <path d="M17.9 11.6v6.4a3 3 0 0 1-6 0" fill="none" stroke="#fff" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span class="label"></span>
            </span>
          </button>
        </div>
        <div class="grip" title="Drag to move" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
      </div>
      <button class="x" aria-label="Hide on this page" title="Hide on this page"><svg viewBox="0 0 10 10"><path d="M2 2l6 6M8 2 2 8"/></svg></button>
    </div>`;

  const wrap = root.querySelector('.wrap');
  const tab = root.querySelector('.tab');
  const label = root.querySelector('.label');
  const grip = root.querySelector('.grip');
  const infoScore = root.querySelector('.info-score');
  const infoHint = root.querySelector('.info-hint');
  const afBtn = root.querySelector('.af');
  const arc = root.querySelector('.arc');
  const GAUGE = 2 * Math.PI * 9.75 * 0.75; // the gauge is a 270-degree arc

  let mode = 'always';
  let dismissed = false;
  let panelOpen = false;
  let score = null;
  let band = null;
  let dead = false;
  let navTimer = 0;

  // After a reload at chrome://extensions, this old content script stays on the page with a
  // dead chrome.* handle. Touching it throws "Extension context invalidated". Tear down quietly.
  function alive() {
    if (dead) return false;
    try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
  }
  function teardown() {
    if (dead) return;
    dead = true;
    try { clearInterval(navTimer); } catch (e) { /* ignore */ }
    try { if (window.__jdfEdgeTabNavTimer === navTimer) window.__jdfEdgeTabNavTimer = 0; } catch (e) { /* ignore */ }
    try { window.removeEventListener('resize', onResize); } catch (e) { /* ignore */ }
    try { document.removeEventListener('fullscreenchange', evaluate); } catch (e) { /* ignore */ }
    try { host.remove(); } catch (e) { /* ignore */ }
    try { if (window.__jdfEdgeTabCleanup === teardown) window.__jdfEdgeTabCleanup = null; } catch (e) { /* ignore */ }
  }
  window.__jdfEdgeTabCleanup = teardown;
  function isInvalidated(err) {
    return /Extension context invalidated|context invalidated/i.test(String(err && err.message || err));
  }
  function safeChrome(fn) {
    if (!alive()) { teardown(); return; }
    try { return fn(); } catch (e) {
      if (isInvalidated(e)) teardown();
    }
  }

  function paint() {
    if (dead) return;
    wrap.classList.toggle('open', panelOpen);
    wrap.classList.toggle('scored', score != null);
    wrap.classList.remove('APPLY', 'MAYBE', 'SKIP');
    if (band) wrap.classList.add(band);
    label.textContent = score != null ? `${score}%` : '';
    // The logo's ring shows the real score once there is one (default artwork shows ~78%).
    const pct = score != null ? Math.max(2, score) : 78;
    // The logo's gauge fills to the score: violet-to-mint for apply, amber for maybe, red for skip.
    arc.setAttribute('stroke-dasharray', `${(GAUGE * pct / 100).toFixed(2)} 61.3`);
    arc.setAttribute('stroke', band === 'MAYBE' ? '#FBBF24' : band === 'SKIP' ? '#F87171' : 'url(#jdf-a)');
    const word = { APPLY: 'Apply', MAYBE: 'Maybe', SKIP: 'Skip' }[band] || '';
    infoScore.textContent = score != null ? `${score}% · ${word}` : 'Check this job\u2019s fit';
    infoHint.innerHTML = panelOpen ? 'Panel is open' : 'Click to open <kbd>\u2318\u21e7J</kbd>';
    tab.setAttribute('aria-label', 'Open JD Filler side panel' + (score != null ? `, score ${score} percent` : ''));
  }

  function evaluate() {
    if (dead) return;
    const show = !dismissed && !document.fullscreenElement && (mode === 'always' || (mode === 'jobs' && looksLikeJob()));
    host.style.display = show ? 'block' : 'none';
    if (show && !host.isConnected) (document.body || document.documentElement).appendChild(host);
    if (show) dodge();
  }

  // Other extensions (Jobright, Simplify, Tsenta...) pin their own panels to the right edge at the maximum
  // z-index, so they would sit on top of this card and swallow its clicks. If something covers the right edge
  // at our height, dock just to its left; slide back to the edge when it goes away.
  function topLevel(el) {
    while (el && el.parentElement && el.parentElement !== document.body && el.parentElement !== document.documentElement) el = el.parentElement;
    return el;
  }
  function isOverlay(el) {
    if (!el || el === host || el === document.body || el === document.documentElement) return false;
    const cs = getComputedStyle(el);
    return cs.position === 'fixed' || cs.position === 'sticky' || (parseInt(cs.zIndex, 10) || 0) >= 1000;
  }
  let dockRight = 0;
  function dodge() {
    if (dead || host.style.display === 'none') return;
    try {
      const r = host.getBoundingClientRect();
      const y = Math.round(r.top + r.height / 2);
      const w = document.documentElement.clientWidth || window.innerWidth;
      const cover = topLevel(document.elementFromPoint(w - 3, y));
      let right = 0;
      if (isOverlay(cover)) {
        // Walk left until the point is no longer on that overlay: that is its left edge.
        let edge = w - 3;
        for (let x = w - 3; x > w * 0.35; x -= 6) {
          if (topLevel(document.elementFromPoint(x, y)) !== cover) { edge = x + 6; break; }
          edge = x;
        }
        right = Math.max(0, w - edge + 6);
        if (right > w * 0.6) right = 0; // a full-width overlay (modal): stay put
      }
      if (right !== dockRight) {
        dockRight = right;
        host.style.right = right + 'px';
        wrap.classList.toggle('docked', right > 0);
      }
    } catch (e) { /* page may be mid-navigation */ }
  }
  const onResize = () => dodge();
  window.addEventListener('resize', onResize);

  // ---------- position + drag ----------
  function placeAt(pct) {
    const clamped = Math.max(6, Math.min(88, pct));
    host.style.top = clamped + '%';
    return clamped;
  }
  let drag = null;
  grip.addEventListener('pointerdown', (e) => {
    if (dead || e.button !== 0) return;
    e.preventDefault();
    drag = { y: e.clientY, startTop: host.getBoundingClientRect().top, moved: false };
    try { grip.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  grip.addEventListener('pointermove', (e) => {
    if (dead || !drag) return;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dy) < 3) return;
    drag.moved = true;
    wrap.classList.add('dragging');
    placeAt(((drag.startTop + dy) / window.innerHeight) * 100);
  });
  const endDrag = (e) => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    wrap.classList.remove('dragging');
    try { grip.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (moved) {
      const pct = (host.getBoundingClientRect().top / window.innerHeight) * 100;
      safeChrome(() => chrome.storage.local.set({ edgeTabY: Math.round(pct * 10) / 10 }).catch(() => {}));
    }
  };
  grip.addEventListener('pointerup', endDrag);
  grip.addEventListener('pointercancel', endDrag);
  tab.addEventListener('click', (e) => { e.preventDefault(); toggle(); });

  function toggle() {
    // The click is the user gesture sidePanel.open() needs; the background opens it right away.
    safeChrome(() => {
      chrome.runtime.sendMessage({ type: 'jdf.togglePanel' }).then((res) => {
        if (res && res.ok) { panelOpen = res.open; paint(); }
      }).catch(() => { if (!alive()) teardown(); });
    });
  }

  root.querySelector('.x').addEventListener('click', (e) => { e.stopPropagation(); dismissed = true; evaluate(); });
  function runAutofill(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (dead || afBtn.getAttribute('aria-busy') === 'true') return;
    afBtn.setAttribute('aria-busy', 'true');
    afBtn.classList.remove('ok', 'err');
    afBtn.textContent = 'Filling…';
    safeChrome(() => {
      chrome.runtime.sendMessage({ type: 'jdf.autofill' }).then((res) => {
        if (dead) return;
        afBtn.removeAttribute('aria-busy');
        if (res && res.ok) {
          afBtn.classList.add('ok');
          afBtn.textContent = res.filled ? `Filled ${res.filled}` : 'No fields';
        } else {
          afBtn.classList.add('err');
          afBtn.textContent = 'Failed';
        }
        setTimeout(() => {
          if (dead) return;
          afBtn.classList.remove('ok', 'err');
          afBtn.textContent = 'Autofill';
        }, 2200);
      }).catch(() => {
        if (dead) return;
        afBtn.removeAttribute('aria-busy');
        afBtn.classList.add('err');
        afBtn.textContent = 'Failed';
        if (!alive()) teardown();
      });
    });
  }
  afBtn.addEventListener('click', runAutofill);
  afBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') runAutofill(e);
  });

  // ---------- messages from the panel / background ----------
  // Listeners must never throw: Chrome surfaces that as "Errors" on the extension card.
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      try {
        if (dead || !msg) return;
        if (!alive()) { teardown(); return; }
        if (msg.type === 'jdf.score') { score = typeof msg.score === 'number' ? msg.score : null; band = score == null ? null : msg.band; paint(); }
        if (msg.type === 'jdf.panel') { panelOpen = !!msg.open; paint(); }
      } catch (e) { if (isInvalidated(e) || !alive()) teardown(); }
    });
  } catch (e) { teardown(); }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      try {
        if (dead) return;
        if (!alive()) { teardown(); return; }
        if (area === 'session') {
          for (const key of Object.keys(changes)) {
            if (!/^panelOpen:/.test(key)) continue;
            panelOpen = !!(changes[key] && changes[key].newValue);
            paint();
          }
          return;
        }
        if (area !== 'local') return;
        if (changes.edgeTab) { mode = changes.edgeTab.newValue || 'always'; evaluate(); }
        if (changes.edgeTabY && !drag) placeAt(changes.edgeTabY.newValue);
      } catch (e) { if (isInvalidated(e) || !alive()) teardown(); }
    });
  } catch (e) { teardown(); }

  // SPA navigation (LinkedIn, Workday): re-check the page type and drop a score that belonged to the old URL.
  let lastHref = location.href;
  navTimer = setInterval(() => {
    try {
      if (dead) return;
      if (!alive()) { teardown(); return; }
      dodge();
      if (location.href === lastHref) return;
      lastHref = location.href;
      score = null; band = null; paint();
      evaluate();
    } catch (e) { if (isInvalidated(e) || !alive()) teardown(); }
  }, 1000);
  window.__jdfEdgeTabNavTimer = navTimer;
  document.addEventListener('fullscreenchange', evaluate);

  safeChrome(() => {
    chrome.storage.local.get(['edgeTab', 'edgeTabY']).then((s) => {
      if (dead) return;
      mode = s.edgeTab || 'always';
      if (typeof s.edgeTabY === 'number') placeAt(s.edgeTabY);
      paint();
      evaluate();
      // JSON-LD and SPA content often arrive after document_idle.
      setTimeout(evaluate, 1500);
      setTimeout(evaluate, 4000);
    }).catch(() => { if (!alive()) teardown(); });
  });
  safeChrome(() => {
    chrome.runtime.sendMessage({ type: 'jdf.panelState' }).then((res) => {
      if (dead) return;
      if (res && res.ok) { panelOpen = res.open; paint(); }
    }).catch(() => { if (!alive()) teardown(); });
  });
})();
