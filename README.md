# JD Filler

Personal Chrome extension that lives in Chrome's **side panel**. Open a job posting and click the **edge tab** pinned to the right side of the page (or the toolbar button, or `Cmd+Shift+J`). The panel stays open while you browse and follows whichever tab you are on, and in one place you get:

1. **Clean facts** pulled from the page: company, role, link, source, location, work mode, job type, salary, experience asked, sponsorship (with the exact work-auth sentences), posted date, and the JD text.
2. **A rule check in code** (no API call): a red banner for auto-skip hits and an amber one for maybes, each with the quoted sentence.
3. **A Claude apply score** (0 to 100) with fit, what to lead with, what not to claim, and the next action. 70 and up means apply, 40 to 69 is a maybe, under 40 is a skip.
4. **A row in your Notion Application Tracker**, created automatically when the score reaches your threshold (default 70, or by hand), with Undo.

Plus: a **Profile page** (name, address, links, education, experience, skills by honesty level, EEO answers, each with a copy button) that also feeds Claude; **insider links** per company (H-1B history, alumni from your school, recruiters, Glassdoor, E-Verify); **ATS keywords** and a **resume-tailoring prompt**; Copy (template).

## Install

1. `git clone https://github.com/krushaalkalkani/jd-filler.git`
2. `chrome://extensions` -> turn on **Developer mode** -> **Load unpacked** -> pick the `jd-filler` folder.
3. Pin the icon. Shortcut `Cmd+Shift+J` (Mac) / `Ctrl+Shift+J`; change it at `chrome://extensions/shortcuts`.
4. After every `git pull`, press the refresh icon on the extension card.

## Keys (Settings, the gear icon)

Both keys are stored in `chrome.storage.local` on this machine only. They are never synced and never printed.

### Anthropic API key
1. Create a key at https://platform.claude.com/ (API keys).
2. Paste it into **Anthropic API key**, press **Test**. The test lists the models your key can see and warns if `claude-opus-5-5` is missing.
3. Calls go from the extension's background worker straight to `api.anthropic.com` with the `anthropic-dangerous-direct-browser-access: true` header. Every check uses Claude Opus 5.5 (`claude-opus-5-5`) at medium effort; the **Deep** option runs the same model at xhigh effort.

### Notion token and database
1. Go to https://www.notion.so/profile/integrations -> **New integration** (internal). Copy the secret.
2. Share the tracker with the integration: open the **Application Tracker** database in Notion -> `...` menu (top right) -> **Connections** -> add your integration.
3. Paste the secret into **Notion internal integration token**. The data source id and database page id are prefilled for your tracker; change them if you move it. Press **Test**: it checks the token, reaches the data source, and lists any of the required properties that are missing.

Required properties and the exact option names (the test tells you if one is missing):

| Property | Type | Options |
|---|---|---|
| Company Name | title | |
| Job Title | text | |
| Job Link | url | company Apply URL when LinkedIn has an offsite Apply link; otherwise the LinkedIn / ATS page URL |
| Location | text | |
| Salary Range | text | |
| Work Mode | select | Remote, Hybrid, On-site |
| Job Type | select | Full Time, Part Time, Internship, Contract, Volunteer |
| Sponsorship | select | Sponsors visa, OPT/CPT OK, Not mentioned, No sponsorship, US citizens only |
| Source | select | Linkedin, Job Portal, Company's career page, Indeed, Sonic Jobs |
| Stage | select | must include **Applied** (set automatically on every Log to Notion) |
| Applied On | date | date only |

The Notion page **body** is filled with the scraped job description (paragraph blocks). Mapping: Greenhouse / Lever / Workday / Ashby / company sites -> "Company's career page"; Glassdoor / Handshake / other boards -> "Job Portal". A select is left empty when the value is Unknown. The Rejected On column is never touched.

## Profile page

Open it from **Settings → Your profile** in the side panel (or right-click the icon, Options). Every field autosaves to this computer and has a **Copy** button so you can paste into application forms. Sections: basics and address, links (LinkedIn, GitHub, X, portfolio, other), education, work experience, skills in three honesty levels (proven / listed only / never claim / no record), certifications, languages, targets, and the standard work-authorization and equal-employment answers. **Copy profile as text** gives one block for a chat bot; Export / Import JSON moves it between machines.

Claude's system prompt is built from this page: positioning line, education, experience, targets, minimum pay and the skill levels. If the page has never been opened, a built-in copy of the same defaults is used.

## The side panel

A calm, dense "pro tool" layout: slate greys, one indigo accent for actions, green / amber / red reserved for the score. Light and dark follow the system. It is fluid from 300 px up, so it works at whatever width you drag the side panel to.

- **App bar** - the live dot and status ("Read from LinkedIn"), **Read again** and **Settings**. Under it, the **OPT clock**: a bar from day 1 to day 90 that turns amber after day 45 and red after day 75.
- **Job card** - a coloured company monogram, company and location, the role, and chips for sponsorship, mode, type, pay, years asked, posted and applicants.
- **Rule callouts** - "Auto-skip" (red) and "Worth a second look" (amber), each with the sentence that triggered it.
- **Score card** - the ring is the one loud element. **Check fit** (or click the ring, or `Cmd+Enter`) sends the page facts, the rule hits and the cleaned JD (max ~12k chars) to Claude Opus 5.5. **Fast / Deep** picks medium or xhigh effort (remembered). The band (Apply 70+, Maybe 40 to 69, Skip under 40), the one-line reason and level / type / years / pay appear next to the ring, and a coloured stripe tops the card.
- **Verdict cards** - Work authorization (status pill, `OPT day X of 90`, the quoted sentences), Fit (each key requirement with a three-step meter: strong / partial / gap), Strategy (Lead with, Don't claim, Do now), ATS keywords (Copy all), Red flags. Anything "Not stated" is hidden. The model, effort, time and tokens are in the grey line under them.
- **Research** - one-click links for the company: H-1B history, alumni from your school, recruiters, Glassdoor, E-Verify.
- **Details / Job description** - disclosure rows. Open Details to edit any field before you copy or log.
- **Action bar** (sticky) - **Copy job** (your template: facts + JD), **Log to Notion**, and **⋯** (Copy resume prompt, Copy facts only, Copy as JSON). Log to Notion first queries the data source for the same Job Link and shows "Already in your tracker" instead of creating a duplicate; on success Stage is set to Applied, the JD is written into the page body, you get the page link and an **Undo** button (moves the page to trash). With the Settings option on (default), logging runs by itself when the score is at least the threshold you set (default 70).

Switching tabs swaps the panel to that tab's job. Each tab's job, score and Notion state are kept in memory, so going back to a tab shows its result again without another API call. On LinkedIn, clicking a different job in the list changes the URL and the panel re-reads it about a second later.

## The edge tab

`edge-tab.js` is a content script that pins a small dark tab to the right edge of job pages (known job boards and ATS hosts, URLs with /jobs or /careers, or any page with `JobPosting` JSON-LD). It lives in a closed shadow root, so the page's CSS cannot restyle it.

- **Click** opens the side panel; click again closes it (Chrome 141+). The tab turns indigo while the panel is open.
- After a check, the tab shows the score with a coloured ring around the logo, so you can see the result without opening the panel. Hover for "82% apply".
- **Drag** it up or down; the position is remembered. The small **×** hides it on that page until the next load.
- Settings → **Edge tab on web pages**: Job pages (default), Everywhere, or Off.

The OPT counter in the header is computed in code: day 1 = 2026-09-12, limit 90 days. Change `OPT_START` in `sidepanel.js` if your EAD date differs.

## Rule check (rules.js)

Runs on the JD text as soon as the page is read, and again before every Check.

AUTO-SKIP: US citizen only; green card / permanent resident only; security clearance; ITAR / EAR / "U.S. person"; C2C only; PhD required (not preferred, not "MS or PhD"); Senior / Sr / Staff / Principal / Lead / III in the title; a firm 3+ years ("N+ years" counts, plain "N years" needs required / must / minimum; "in lieu of a degree" and "preferred" never count); unpaid; under 20 hours a week; a required language other than English, Hindi or Gujarati.

MAYBE: no visa sponsorship / will not sponsor; 1099; contract under 6 months; seasonal; pay under $60K a year (hourly x 2080); a personal email address as the contact.

AUTO-SKIP also covers scam signals: training or registration fees, pay-to-work, "we market your profile", bench sales, guaranteed placement, requests for SSN or passport copies.

Each hit shows the exact sentence. Edit the JD or Salary field and the banner recomputes.

## Errors

Bad key (401), rate limit (429), server errors and network timeouts (20 s) show as a message with a **Retry** button. Nothing is sent anywhere except `api.anthropic.com` and `api.notion.com`.

After a `git pull`, Chrome keeps running the old background service worker until you press the reload arrow on the JD Filler card at `chrome://extensions`. The panel notices the version mismatch and shows "Extension files changed: reload it" so a stale worker is not mistaken for a bug.

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

- `manifest.json` - MV3; `sidePanel`, `scripting`, `storage`; host access to all sites so the panel can read whichever tab you switch to and the edge tab can run (network requests still go only to the two APIs)
- `extractor.js` - injected into the page on demand, returns the job object
- `rules.js` - hard rules (shared by the panel and the test page)
- `background.js` - service worker: Claude verdict, Notion query / create / trash, key tests, side panel open / close and open-state tracking
- `sidepanel.html` / `sidepanel.css` / `sidepanel.js` - side panel UI
- `edge-tab.js` - the edge tab content script
- `profile.html` / `profile.css` / `profile.js` - profile page (options page)
- `test-sidepanel.html` / `test-edge-tab.html` / `test-profile.html` - UI smoke tests with a fake chrome API
- `fixtures/`, `test-extract.html` - extractor tests
