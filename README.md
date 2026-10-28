# JD Filler

Personal Chrome extension. Open a job posting, press the toolbar button (or `Cmd+Shift+J`), and in one place you get:

1. **Clean facts** pulled from the page: company, role, link, source, location, work mode, job type, salary, experience asked, sponsorship (with the exact work-auth sentences), posted date, and the JD text.
2. **A rule check in code** (no API call): a red banner for auto-skip hits and an amber one for maybes, each with the quoted sentence.
3. **A Claude apply score** (0 to 100) with fit, what to lead with, what not to claim, and the next action. 70 and up means apply, 40 to 69 is a maybe, under 40 is a skip.
4. **A row in your Notion Application Tracker**, created automatically when the score reaches your threshold (default 70, or by hand), with Undo.

Plus: a **Profile page** (name, address, links, education, experience, skills by honesty level, EEO answers, each with a copy button) that also feeds Claude; **insider links** per company (H-1B history, alumni from your school, recruiters, Glassdoor, E-Verify); **ATS keywords** and a **resume-tailoring prompt**; a **Tracker** with stages (Saved, Applied, OA, Screen, Interview, Offer, Rejected), stage filters and a weekly goal; Copy for Grok (template) and CSV export.

## Install

1. `git clone https://github.com/krushaalkalkani/jd-filler.git`
2. `chrome://extensions` -> turn on **Developer mode** -> **Load unpacked** -> pick the `jd-filler` folder.
3. Pin the icon. Shortcut `Cmd+Shift+J` (Mac) / `Ctrl+Shift+J`; change it at `chrome://extensions/shortcuts`.
4. After every `git pull`, press the refresh icon on the extension card.

## Keys (Settings tab)

Both keys are stored in `chrome.storage.local` on this machine only. They are never synced and never printed.

### Anthropic API key
1. Create a key at https://platform.claude.com/ (API keys).
2. Paste it into **Anthropic API key**, press **Test**. The test lists the models your key can see and warns if `claude-opus-5-5` is missing.
3. Calls go from the extension's background worker straight to `api.anthropic.com` with the `anthropic-dangerous-direct-browser-access: true` header. Every check uses Claude Opus 5.5 (`claude-opus-5-5`) at medium effort; the **Deep** toggle runs the same model at xhigh effort.

### Notion token and database
1. Go to https://www.notion.so/profile/integrations -> **New integration** (internal). Copy the secret.
2. Share the tracker with the integration: open the **Application Tracker** database in Notion -> `...` menu (top right) -> **Connections** -> add your integration.
3. Paste the secret into **Notion internal integration token**. The data source id and database page id are prefilled for your tracker; change them if you move it. Press **Test**: it checks the token, reaches the data source, and lists any of the 10 required properties that are missing.

Required properties and the exact option names (the test tells you if one is missing):

| Property | Type | Options |
|---|---|---|
| Company Name | title | |
| Job Title | text | |
| Job Link | url | |
| Location | text | |
| Salary Range | text | |
| Work Mode | select | Remote, Hybrid, On-site |
| Job Type | select | Full Time, Part Time, Internship, Contract, Volunteer |
| Sponsorship | select | Sponsors visa, OPT/CPT OK, Not mentioned, No sponsorship, US citizens only |
| Source | select | Linkedin, Job Portal, Company's career page, Indeed, Sonic Jobs |
| Applied On | date | date only |

Mapping: Greenhouse / Lever / Workday / Ashby / company sites -> "Company's career page"; Glassdoor / Handshake / other boards -> "Job Portal". A select is left empty when the value is Unknown. The Rejected On column is never touched.

## Profile page

Open it from the **Profile** tab in the popup (or right-click the icon, Options). Every field autosaves to this computer and has a **Copy** button so you can paste into application forms. Sections: basics and address, links (LinkedIn, GitHub, X, portfolio, other), education, work experience, skills in three honesty levels (proven / listed only / never claim / no record), certifications, languages, targets, and the standard work-authorization and equal-employment answers. **Copy profile as text** gives one block for a chat bot; Export / Import JSON moves it between machines.

Claude's system prompt is built from this page: positioning line, education, experience, targets, minimum pay and the skill levels. If the page has never been opened, a built-in copy of the same defaults is used.

## Buttons (Job tab)

- **Check** (or click the ring) - sends the page facts, the rule hits and the cleaned JD (max ~12k chars) to Claude and shows the card. The scoring rubric, your profile and evidence levels live in the system prompt in `background.js` (cached with `cache_control`). Strict JSON comes back through structured outputs (`output_config.format`). The card: line 1 score (coloured green 70+, amber 40 to 69, red under 40) / company / role / location / mode / pay / level, line 2 auth + quotes + `OPT day X/90`, then Fit (3 points tagged Strong / Partial / Gap), Lead with, Don't claim, Do now, red flags, and the model/time/token line.
- **Deep** - toggle: Opus 5.5 at xhigh effort instead of medium. Slower, more careful. Remembered.
- **Resume prompt** - copies a tailoring prompt for your resume tool: role, company, the ATS keywords Claude found (only ones you can truthfully use), what to lead with, what not to claim, the fit map and the JD.
- **Links under the title** - H-1B history (search), alumni at the company from your school (LinkedIn people search), recruiters at the company, Glassdoor, E-Verify check.
- **Log to Notion** - creates the tracker row. It first queries the data source for the same Job Link and shows "Already logged" instead of creating a duplicate. On success you get the page link and an **Undo** button (moves the page to trash). The job is also saved and marked Applied in the Saved tab. With the Settings option on (default), this runs by itself when the score is at least the threshold you set (default 70).
- **Copy for Grok / Facts / JSON / Save** (bottom bar) and **Re-read** - as before. Re-read after you click a different job in a LinkedIn list. The template also has {{score}} and {{keywords}}.

## Tracker tab

Every saved or logged job with a stage select (Saved, Applied, OA, Screen, Interview, Offer, Rejected), filter chips per stage, the score badge, the Notion link, and Load / Copy / Open / Delete. The header shows "N of goal applied this week" (Monday to Sunday, goal in Settings). Logging to Notion sets the stage to Applied; Undo sets it back to Saved. Export CSV includes score, band, stage, keywords and notes.

The OPT counter in the header is computed in code: day 1 = 2026-09-12, limit 90 days. Change `OPT_START` in `popup.js` if your EAD date differs.

## Rule check (rules.js)

Runs on the JD text as soon as the page is read, and again before every Check.

AUTO-SKIP: US citizen only; green card / permanent resident only; security clearance; ITAR / EAR / "U.S. person"; C2C only; PhD required (not preferred, not "MS or PhD"); Senior / Sr / Staff / Principal / Lead / III in the title; a firm 3+ years ("N+ years" counts, plain "N years" needs required / must / minimum; "in lieu of a degree" and "preferred" never count); unpaid; under 20 hours a week; a required language other than English, Hindi or Gujarati.

MAYBE: no visa sponsorship / will not sponsor; 1099; contract under 6 months; seasonal; pay under $60K a year (hourly x 2080); a personal email address as the contact.

AUTO-SKIP also covers scam signals: training or registration fees, pay-to-work, "we market your profile", bench sales, guaranteed placement, requests for SSN or passport copies.

Each hit shows the exact sentence. Edit the JD or Salary field and the banner recomputes.

## Errors

Bad key (401), rate limit (429), server errors and network timeouts (20 s) show as a message with a **Retry** button. Nothing is sent anywhere except `api.anthropic.com` and `api.notion.com`.

After a `git pull`, Chrome keeps running the old background service worker until you press the reload arrow on the JD Filler card at `chrome://extensions`. The popup notices the version mismatch and shows "Extension files changed: reload it" so a stale worker is not mistaken for a bug.

## Supported sites

Site readers: LinkedIn (logged in, search / collections / view pages, and the guest view), Indeed, Glassdoor, Handshake, Greenhouse, Lever, Workday, Ashby, SmartRecruiters, Sonic Jobs (source only). Everything else: JSON-LD `JobPosting` plus a generic fallback. The grey line under the form says which reader ran.

On LinkedIn every read is scoped to the selected job's detail pane (top card + "About the job"). The job list, Premium "match" widgets, "People you can reach out to", company insights and the footer are ignored, and a role that looks like LinkedIn chrome ("Low match to this role", "Top applicant", ...) is thrown away in favour of the tab title.

LinkedIn now ships two layouts. The classic one (named classes such as `job-details-jobs-unified-top-card__job-title`) is read by class. The 2025 one (standalone `/jobs/view/` pages and the new AI job search at `/jobs/search-results/`) has only hashed class names, so it is read by structure: the tab title ("Role | Company | LinkedIn"), the biggest short text in the pane, the "City · N days ago · N applicants" line, chip-sized text for work mode / job type / pay, and the "About the job" heading for the description. Widgets that other extensions inject into the page (Jobright's "Partial Match, Let's Make it Perfect" card, Tsenta, Simplify) are never accepted as the role or company.

## Testing the extractor

`test-extract.html` runs `extractor.js` and `rules.js` against the saved pages in `fixtures/` and shows pass/fail per field.

```bash
python3 -m http.server 8766
```

Then open http://localhost:8766/test-extract.html (opening the file directly also works in Chrome).

Fixtures: real captures of a Greenhouse page, a LinkedIn guest job view, a Workday page and a Lever page, plus three hand-built LinkedIn pages: `linkedin-search-mock` (classic search layout with the HNTB bug: other card's salary, Premium widget, footer), `linkedin-ai-search-new-layout` (2025 AI search with hashed classes and a Jobright widget) and `linkedin-view-new-layout` (2025 standalone job page). To add a real page: open it, Settings -> **Save page as fixture**, move the downloaded `*.fixture.js` into `fixtures/`, fill its `expect` values, and add a `<script>` line in `test-extract.html`.

## Files

- `manifest.json` - MV3; `activeTab`, `scripting`, `storage`; host permissions only for the two APIs
- `extractor.js` - injected into the page on demand, returns the job object
- `rules.js` - hard rules (shared by popup and test page)
- `background.js` - service worker: Claude verdict, Notion query / create / trash, key tests
- `popup.html` / `popup.css` / `popup.js` - popup UI
- `profile.html` / `profile.js` - profile page (options page)
- `test-popup.html` / `test-profile.html` - UI smoke tests with a fake chrome API
- `fixtures/`, `test-extract.html` - extractor tests
