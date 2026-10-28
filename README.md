# JD Filler

Personal Chrome extension. Open any job posting, press the toolbar button (or `Cmd+Shift+J`), and it pulls out:

| Field | Where it comes from |
|---|---|
| Company, Role, Job link | Site selectors, JSON-LD `JobPosting`, page title, or the ATS URL (Lever, Greenhouse, Workday, Ashby, iCIMS, ...) |
| Source | Hostname: LinkedIn / Indeed / Handshake / Glassdoor / Company Site / Other |
| Location, Work mode (Remote / Hybrid / On-site) | Pills and labels first, then the JD text |
| Job type (Full-time / Part-time / Contract / Internship / Co-op) | Pills, JSON-LD `employmentType`, then the JD text |
| Salary | Pills, JSON-LD `baseSalary`, then the first `$X - $Y` range in the JD |
| Experience asked, Seniority | `N+ years ... experience` in the JD; seniority from the title |
| Sponsorship (Sponsors / No sponsorship / Unknown) + note | Sentences mentioning sponsorship, visa, H-1B, OPT, citizenship, clearance, ITAR, E-Verify, C2C |
| Work auth lines | Those sentences quoted verbatim so you can read them yourself |
| Posted, Applicants, Deadline | LinkedIn subline, Workday "Posted", JSON-LD `datePosted` / `validThrough` |
| Full JD text | The description block, trimmed to 30k chars |

Every field is editable in the popup before you copy.

## Buttons

- **Copy for Grok** - renders the template (Settings tab) with all facts plus the full JD. Paste it into your Grok bot.
- **Facts only** - same template, cut off before the `{{jd}}` line.
- **JSON** - raw fields as JSON.
- **Save** - keeps the job in the Saved tab (stored locally in Chrome). From there you can Load, Copy, Open, tick Applied, Delete, or Export CSV. The CSV columns match the Notion Job Tracker (Role, Company, Job Link, Location, Work Mode, Source, Sponsorship, Stage, Applied On, ...).
- **Re-read** - run the extractor again (use this on LinkedIn after you click a different job in the list).

## Install (unpacked, personal use)

1. `git clone https://github.com/krushaalkalkani/jd-filler.git`
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. **Load unpacked** and pick the `jd-filler` folder.
4. Pin the extension. Shortcut: `Cmd+Shift+J` (Mac) / `Ctrl+Shift+J`. Change it at `chrome://extensions/shortcuts`.

After you `git pull` an update, press the refresh icon on the extension card in `chrome://extensions`.

## Supported sites

Site-specific readers: LinkedIn (logged in and guest view), Indeed, Glassdoor, Handshake, Greenhouse, Lever, Workday, Ashby, SmartRecruiters.
Everything else uses JSON-LD `JobPosting` (most company career sites have it) and a generic fallback (h1, og tags, the largest description-like block). The grey line under the form says which reader was used.

Tested on: Greenhouse (job-boards.greenhouse.io), LinkedIn guest job view, Workday (myworkdayjobs.com), Lever (jobs.lever.co).

## Template

Settings tab. Placeholders:

```
{{company}} {{role}} {{link}} {{source}} {{location}} {{work_mode}} {{job_type}} {{salary}}
{{experience}} {{seniority}} {{sponsorship}} {{sponsorship_note}} {{auth_lines}}
{{posted}} {{applicants}} {{deadline}} {{jd}} {{date}}
```

Empty fields render as `Not stated`. The template is synced through your Chrome profile.

## Notes

- Nothing runs on a page until you open the popup (`activeTab` + `scripting`, no background host permissions). Nothing leaves your browser; saved jobs live in `chrome.storage.local`.
- Sponsorship detection is regex-based. Always read the quoted auth lines; "Unknown" means the posting did not say it clearly.
- LinkedIn changes its class names now and then. If Role or Company come back empty on LinkedIn, the selectors in `extractor.js` (`linkedin()` function) need updating.
- Chrome blocks extensions on `chrome://` pages and the Web Store; the popup will say so.

## Files

- `manifest.json` - MV3 manifest
- `extractor.js` - injected into the page, returns the job object
- `popup.html` / `popup.css` / `popup.js` - the UI, copy, save, CSV export, template
- `icons/` - toolbar icons
