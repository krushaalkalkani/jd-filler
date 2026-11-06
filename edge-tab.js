// edge-tab.js - content script. A small tab pinned to the right edge of job pages that opens the JD Filler
// side panel, shows the latest score, and can be dragged up or down. Lives in a closed shadow root so the
// page's CSS cannot touch it (and it cannot touch the page).
(() => {
  if (window.top !== window || window.__jdfEdgeTab) return;
  window.__jdfEdgeTab = true;

  const JOB_HOSTS = /(^|\.)(indeed\.com|glassdoor\.[a-z.]+|joinhandshake\.com|greenhouse\.io|lever\.co|myworkdayjobs\.com|myworkdaysite\.com|ashbyhq\.com|smartrecruiters\.com|icims\.com|jobvite\.com|workable\.com|bamboohr\.com|rippling\.com|dice\.com|ziprecruiter\.com|wellfound\.com|builtin\.com|simplify\.jobs|jobright\.ai|careers\.[^.]+\.[a-z]+)$/i;
  const JOB_PATH = /(^|[\/_-])(jobs?|careers?|positions?|openings?|vacanc(y|ies)|requisitions?|job-?details?|viewjob)([\/_?=-]|$)/i;

  function looksLikeJob() {
    const host = location.hostname.replace(/^www\./, '');
    if (/(^|\.)linkedin\.com$/.test(host)) return /^\/jobs\//.test(location.pathname) || /currentJobId=/.test(location.search);
    if (JOB_HOSTS.test(host)) return true;
    if (JOB_PATH.test(location.pathname + location.search)) return true;
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) if (/"JobPosting"/.test(s.textContent || '')) return true;
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
      .wrap { position: relative; display: flex; align-items: center; font: 500 12px/1.3 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", system-ui, sans-serif; }
      .tab {
        all: unset; box-sizing: border-box; cursor: pointer; touch-action: none; user-select: none;
        width: 46px; padding: 9px 6px 8px 0; display: flex; flex-direction: column; align-items: center; gap: 6px;
        border-radius: 14px 0 0 14px;
        background: rgba(17, 20, 28, .9); color: #fff;
        -webkit-backdrop-filter: blur(12px) saturate(1.5); backdrop-filter: blur(12px) saturate(1.5);
        box-shadow: 0 10px 30px -6px rgba(15, 23, 42, .45), 0 0 0 1px rgba(255, 255, 255, .08) inset, 0 1px 0 rgba(255, 255, 255, .1) inset;
        transform: translateX(6px); transition: transform .22s cubic-bezier(.2, .8, .2, 1), background .2s, box-shadow .2s;
      }
      .wrap:hover .tab, .tab:focus-visible, .wrap.dragging .tab { transform: translateX(0); }
      .tab:focus-visible { outline: 2px solid #818cf8; outline-offset: 2px; }
      .wrap.open .tab { background: linear-gradient(160deg, #5b5ff0, #4338ca); box-shadow: 0 10px 30px -6px rgba(67, 56, 202, .55), 0 0 0 1px rgba(255, 255, 255, .14) inset; }
      .dragging .tab { cursor: grabbing; }
      .logo { position: relative; width: 30px; height: 30px; display: grid; place-items: center; }
      .logo .mark { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; background: linear-gradient(145deg, #6366f1, #4338ca 60%, #312e81); box-shadow: inset 0 1px 0 rgba(255,255,255,.22); transition: transform .2s; }
      .wrap.open .logo .mark { background: rgba(255, 255, 255, .16); }
      .logo svg.m { width: 17px; height: 17px; fill: none; stroke: #fff; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
      .ring { position: absolute; inset: -5px; width: 40px; height: 40px; transform: rotate(-90deg); display: none; }
      .ring circle { fill: none; stroke-width: 3; stroke-linecap: round; }
      .ring .t { stroke: rgba(255, 255, 255, .12); }
      .ring .f { stroke: var(--band); stroke-dasharray: 113.1; stroke-dashoffset: 113.1; transition: stroke-dashoffset .8s cubic-bezier(.2, .8, .2, 1); }
      .scored .ring { display: block; }
      .scored .logo .mark { transform: scale(.82); }
      .label { font-size: 10px; font-weight: 650; letter-spacing: .04em; color: rgba(255, 255, 255, .72); font-variant-numeric: tabular-nums; }
      .scored .label { font-size: 13px; letter-spacing: -.02em; color: var(--band); font-weight: 720; }
      .wrap.open.scored .label { color: #fff; }
      .grip { width: 14px; height: 3px; border-radius: 2px; background: rgba(255, 255, 255, .22); margin-top: 1px; }
      .tip {
        position: absolute; right: 54px; top: 50%; transform: translate(6px, -50%); opacity: 0; pointer-events: none; white-space: nowrap;
        background: rgba(17, 20, 28, .94); color: #fff; padding: 7px 10px; border-radius: 9px; font-size: 12px;
        box-shadow: 0 8px 24px -6px rgba(15, 23, 42, .45); transition: opacity .15s, transform .15s;
      }
      .tip small { display: block; color: rgba(255, 255, 255, .55); font-size: 10.5px; margin-top: 1px; }
      .tip b { color: var(--band, #fff); font-weight: 650; }
      .wrap:hover .tip { opacity: 1; transform: translate(0, -50%); transition-delay: .25s; }
      .dragging .tip { opacity: 0 !important; }
      .x {
        all: unset; position: absolute; left: -7px; top: -7px; width: 18px; height: 18px; border-radius: 50%; cursor: pointer;
        display: grid; place-items: center; background: #fff; color: #334155; box-shadow: 0 1px 4px rgba(0, 0, 0, .3);
        opacity: 0; transform: scale(.8); transition: opacity .15s, transform .15s;
      }
      .x svg { width: 10px; height: 10px; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; }
      .wrap:hover .x { opacity: 1; transform: scale(1); }
      .APPLY { --band: #34d399; } .MAYBE { --band: #fbbf24; } .SKIP { --band: #f87171; }
      @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
      @media print { .wrap { display: none; } }
    </style>
    <div class="wrap" part="wrap">
      <div class="tip" role="tooltip"><span class="tip-main">Open JD Filler</span><small>⌘⇧J · drag to move</small></div>
      <button class="tab" aria-label="Open JD Filler side panel">
        <span class="logo">
          <svg class="ring" viewBox="0 0 40 40" aria-hidden="true"><circle class="t" cx="20" cy="20" r="18"/><circle class="f" cx="20" cy="20" r="18"/></svg>
          <span class="mark"><svg class="m" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4.5v9.25a3.25 3.25 0 0 1-6.1 1.56"/><path d="M13.5 4.5H16a6 6 0 0 1 0 12h-2.5z"/></svg></span>
        </span>
        <span class="label">FIT</span>
        <span class="grip" aria-hidden="true"></span>
      </button>
      <button class="x" aria-label="Hide on this page" title="Hide on this page"><svg viewBox="0 0 10 10"><path d="M2 2l6 6M8 2 2 8"/></svg></button>
    </div>`;

  const wrap = root.querySelector('.wrap');
  const tab = root.querySelector('.tab');
  const label = root.querySelector('.label');
  const tipMain = root.querySelector('.tip-main');
  const ringFill = root.querySelector('.ring .f');

  let mode = 'jobs';
  let dismissed = false;
  let panelOpen = false;
  let score = null;
  let band = null;

  function paint() {
    wrap.classList.toggle('open', panelOpen);
    wrap.classList.toggle('scored', score != null);
    wrap.classList.remove('APPLY', 'MAYBE', 'SKIP');
    if (band) wrap.classList.add(band);
    label.textContent = score != null ? `${score}` : 'FIT';
    ringFill.style.strokeDashoffset = score != null ? String(113.1 * (1 - score / 100)) : '113.1';
    const word = { APPLY: 'apply', MAYBE: 'maybe', SKIP: 'skip' }[band] || '';
    tipMain.innerHTML = (panelOpen ? 'Close JD Filler' : 'Open JD Filler') + (score != null ? ` · <b>${score}% ${word}</b>` : '');
    tab.setAttribute('aria-label', (panelOpen ? 'Close' : 'Open') + ' JD Filler side panel' + (score != null ? `, score ${score} percent` : ''));
  }

  function evaluate() {
    const show = !dismissed && !document.fullscreenElement && (mode === 'always' || (mode === 'jobs' && looksLikeJob()));
    host.style.display = show ? 'block' : 'none';
    if (show && !host.isConnected) (document.body || document.documentElement).appendChild(host);
  }

  // ---------- position + drag ----------
  function placeAt(pct) {
    const clamped = Math.max(6, Math.min(88, pct));
    host.style.top = clamped + '%';
    return clamped;
  }
  let drag = null;
  tab.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { y: e.clientY, startTop: host.getBoundingClientRect().top, moved: false };
    tab.setPointerCapture(e.pointerId);
  });
  tab.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dy) < 5) return;
    drag.moved = true;
    wrap.classList.add('dragging');
    placeAt(((drag.startTop + dy) / window.innerHeight) * 100);
  });
  tab.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    wrap.classList.remove('dragging');
    try { tab.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (moved) {
      const pct = (host.getBoundingClientRect().top / window.innerHeight) * 100;
      chrome.storage.local.set({ edgeTabY: Math.round(pct * 10) / 10 }).catch(() => {});
      return;
    }
    toggle();
  });
  tab.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });

  function toggle() {
    // The click is the user gesture sidePanel.open() needs; the background opens it right away.
    chrome.runtime.sendMessage({ type: 'jdf.togglePanel' }).then((res) => {
      if (res && res.ok) { panelOpen = res.open; paint(); }
    }).catch(() => {});
  }

  root.querySelector('.x').addEventListener('click', (e) => { e.stopPropagation(); dismissed = true; evaluate(); });

  // ---------- messages from the panel / background ----------
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.type === 'jdf.score') { score = typeof msg.score === 'number' ? msg.score : null; band = score == null ? null : msg.band; paint(); }
    if (msg.type === 'jdf.panel') { panelOpen = !!msg.open; paint(); }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.edgeTab) { mode = changes.edgeTab.newValue || 'jobs'; evaluate(); }
    if (changes.edgeTabY && !drag) placeAt(changes.edgeTabY.newValue);
  });

  // SPA navigation (LinkedIn, Workday): re-check the page type and drop a score that belonged to the old URL.
  let lastHref = location.href;
  setInterval(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    score = null; band = null; paint();
    evaluate();
  }, 1000);
  document.addEventListener('fullscreenchange', evaluate);

  chrome.storage.local.get(['edgeTab', 'edgeTabY']).then((s) => {
    mode = s.edgeTab || 'jobs';
    if (typeof s.edgeTabY === 'number') placeAt(s.edgeTabY);
    paint();
    evaluate();
    // JSON-LD and SPA content often arrive after document_idle.
    setTimeout(evaluate, 1500);
  }).catch(() => {});
  chrome.runtime.sendMessage({ type: 'jdf.panelState' }).then((res) => { if (res && res.ok) { panelOpen = res.open; paint(); } }).catch(() => {});
})();
