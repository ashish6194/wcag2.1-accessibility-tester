# WCAG 2.1 Accessibility Testing Toolkit

A comprehensive accessibility testing toolkit that tests web pages against all **78 WCAG 2.1 success criteria** (Level A, AA, and AAA). Powered by **4 engines** — axe-core, pa11y, Lighthouse, and 59 custom WAVE-parity checks.

**Three tools included:**

1. **Chrome Extension** — DevTools panel for in-browser testing with element highlighting
2. **CLI Tool** — Node.js script that generates rich HTML reports with fix guidance
3. **Web Dashboard** — Local web app at `localhost:3000` with charts and scan history

---

## Coverage

| Level | Covered | Total |
|-------|---------|-------|
| **A** | 30/30 | 100% |
| **AA** | 20/20 | 100% |
| **AAA** | 16/28 | 57% |
| **Total** | **67/78** | **86%** |

The 12 remaining AAA criteria are **manual-only worldwide** (no tool can automate them — e.g., sign language interpretation, live captions, reading level judgment).

---

## Testing Engines

| Engine | Purpose |
|--------|---------|
| **axe-core** v4.11.2 | Primary engine — Deque's open-source accessibility library |
| **pa11y** | HTML_CodeSniffer runner for WCAG2AAA coverage |
| **Lighthouse** | Google's accessibility audit (included with Chrome) |
| **Custom Checks** | 59 custom rules covering WAVE-parity gaps |

All four engines run in parallel on each scan. Results are merged and deduplicated.

---

## Quick Start

### Chrome Extension

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `extension/` folder
4. Open DevTools on any page → click the **"WCAG 2.1 Tester"** tab
5. Click **Scan Full Page**

**Features:**
- Full page scan or partial scan (CSS selector or element picker)
- Filter by WCAG level (A / AA / AAA / Best Practices)
- Element highlighting on the page
- Severity tabs (Violations / Needs Review / Passed / N/A)
- Detail view with fix guidance and Deque help links
- Scan history with score diffs
- Export as JSON or CSV

### CLI Tool

```bash
cd cli
npm install

# Single page
node test.js https://example.com

# Multiple pages
node test.js https://example.com https://example.org

# Batch from file
node test.js urls.txt

# CI/CD mode with score threshold
node test.js https://example.com --ci --threshold=80

# Output formats
node test.js https://example.com --json --output=results.json
node test.js https://example.com --junit --output=results.xml
```

**CLI Flags:**
| Flag | Purpose |
|------|---------|
| `--ci` | CI/CD mode — exit 1 if violations found |
| `--threshold=N` | Fail only if score is below N (0-100), use with `--ci` |
| `--json` | Output results as JSON |
| `--junit` | Output as JUnit XML for Jenkins/GitHub Actions |
| `--output=<path>` | Write report to a specific file |
| `--no-open` | Don't auto-open the HTML report |

### Web Dashboard

```bash
cd cli
npm install
npm start
# Opens http://localhost:3000
```

**Dashboard Features:**
- URL input with real-time scan progress (Server-Sent Events)
- Animated score gauge with letter grade
- Summary cards (violations, needs review, passed, N/A)
- Donut chart (impact distribution) + bar chart (WCAG level breakdown)
- Expandable rule cards with fix guidance and W3C links
- Scan history sidebar with score trends (localStorage)
- Export as JSON or CSV

---

## HTML Report Contents

Each scan generates a self-contained HTML file with:

**1. Score Dashboard**
- Circular gauge (0-100) with letter grade (A-F)
- Summary cards: Violations, Needs Review, Passed, N/A
- Breakdown by WCAG level and impact severity

**2. Violations Section** (per rule)
- Severity badge (Critical / Serious / Moderate / Minor)
- **Why it matters** — real-world user impact explanation
- **WCAG rule link** — button to W3C WCAG 2.1 Understanding docs
- **axe-core rule link** — button to Deque rule documentation
- **How to fix** — specific remediation steps
- Per-element details:
  - CSS selector (location)
  - Syntax-highlighted HTML source code
  - Element-specific fix guidance

**3. Manual Review Checklist**
- All 78 WCAG 2.1 criteria grouped by principle (POUR)
- Interactive checkboxes to track progress
- Each criterion shows ID, level badge, name, and manual verification steps

---

## The 59 Custom Checks

Our custom engine covers checks that axe-core, pa11y, and Lighthouse miss — replicating WAVE's unique value.

**Alt Text Quality (8)** — suspicious alt, filenames as alt, too-long alt, redundant alt, duplicate alt, title-no-alt, spacer images, images of text

**Content Structure (4)** — possible headings, possible lists, layout tables, empty table headers

**Link Quality (4)** — vague link text, redundant adjacent links, broken anchors, document file links

**Forms (5)** — empty labels, orphaned labels, missing fieldset/legend, title-only labels, error identification

**Interaction (3)** — mouse-only handlers, JS jump menus, positive tabindex

**Readability (4)** — small text (<10px), justified text, confusing underlines, redundant titles

**Media (3)** — YouTube caption check, video without tracks, autoplay without controls

**Navigation (3)** — skip nav missing, broken skip target, duplicate accesskeys

**Touch & Focus (2)** — touch target sizing (24px + 44px), focus visibility

**Text & Reflow (4)** — overflow clipping, horizontal scroll, animation detection, sensory instructions

**Media/Time-based (2)** — audio without transcript, live media detection

**Flashing Content (2)** — rapid animation detection, blink elements

**Timing & Sessions (3)** — meta refresh, countdown/timeout detection, auto-updating content

**Navigation Context (3)** — location/breadcrumbs, link purpose alone, section headings

**Input Modalities (1)** — device motion API detection

**Readability AAA (3)** — reading level estimation (Flesch-Kincaid), abbreviation expansion, uppercase abbreviation detection

**Predictable/Error Prevention (3)** — new window warnings, form confirmation, help availability

**Identify Purpose (1)** — landmark regions check

**Concurrent Input (1)** — touch-only handlers

---

## Project Structure

```
wcag2.1/
├── README.md
├── extension/                  # Chrome Extension
│   ├── manifest.json
│   ├── devtools.html, devtools.js
│   ├── background.js
│   ├── content-script.js       # axe-core runner + highlighting + element picker
│   ├── panel.html, panel.css, panel.js
│   ├── lib/axe.min.js
│   └── icons/
└── cli/                        # CLI Tool + Web Dashboard
    ├── package.json
    ├── scanner.js              # Shared 4-engine scanning logic
    ├── test.js                 # CLI entry point
    ├── server.js               # Express server for dashboard
    ├── report.js               # HTML report generator
    ├── wcag-criteria.js        # 78 WCAG 2.1 criteria reference
    └── public/                 # Web dashboard UI
        ├── index.html
        ├── style.css
        └── app.js
```

---

## CI/CD Integration

### GitHub Actions

```yaml
- name: WCAG 2.1 Accessibility Check
  run: |
    cd cli
    npm install
    node test.js https://staging.example.com --ci --threshold=85 --junit --output=a11y.xml

- name: Upload accessibility report
  uses: actions/upload-artifact@v3
  if: always()
  with:
    name: accessibility-report
    path: cli/a11y.xml
```

### Jenkins

```groovy
stage('Accessibility') {
  steps {
    sh 'cd cli && node test.js ${STAGING_URL} --ci --threshold=80 --junit --output=results.xml'
    junit 'cli/results.xml'
  }
}
```

---

## WCAG 2.1 Criteria Counts

| Level | Count | Description |
|-------|-------|-------------|
| A | 30 | Minimum requirements |
| AA | 20 | Standard compliance (legal requirement in most jurisdictions) |
| AAA | 28 | Highest level |
| **Total** | **78** | All success criteria |

---

## Technology

- **[axe-core](https://github.com/dequelabs/axe-core)** v4.11.2 — MIT license
- **[pa11y](https://github.com/pa11y/pa11y)** — LGPL license
- **[Lighthouse](https://github.com/GoogleChrome/lighthouse)** — Apache 2.0
- **[Puppeteer](https://pptr.dev/)** — headless Chrome automation
- **[Express](https://expressjs.com/)** — web dashboard server
- **Chrome Extension Manifest V3**

No API keys required. No paid services. Fully open-source dependencies.

---

## License

MIT
