# WCAG 2.1 Accessibility Testing Toolkit

A comprehensive accessibility testing toolkit that tests web pages against all **78 WCAG 2.1 success criteria** (Level A, AA, and AAA). Powered by [axe-core](https://github.com/dequelabs/axe-core) — the same engine behind axe DevTools.

Two tools included:

1. **Chrome Extension** — A DevTools panel for in-browser testing with element highlighting
2. **CLI Tool** — A Node.js script that generates styled HTML reports

---

## Chrome Extension

### Features

- Full page scan or partial scan (target a specific CSS selector)
- Filter by WCAG level: A / AA / AAA / Best Practices
- Results grouped by rule, sorted by severity (Critical / Serious / Moderate / Minor)
- Tabs: Violations | Needs Review | Passed | Not Applicable
- Element highlighting — red overlay on the offending element with scroll-to
- Detail view — HTML snippet, CSS selector, fix guidance, Deque help link
- Export results as JSON or CSV

### Installation

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `extension/` folder from this project
5. The extension icon will appear in your toolbar

### Usage

1. Navigate to any web page you want to test
2. Open Chrome DevTools (right-click → Inspect, or `Cmd+Option+I` / `Ctrl+Shift+I`)
3. Click the **"WCAG 2.1 Tester"** tab in the DevTools panel
4. Select which WCAG levels to test (A, AA, AAA are all checked by default)
5. Click **Scan Full Page**
6. Review results — click any rule to expand and see affected elements
7. Click **Highlight** on any element to see it highlighted on the page
8. Click **Details** for fix guidance and a link to the relevant Deque help page
9. Use **Export JSON** or **Export CSV** to save results

#### Partial Page Scan

To scan only a section of the page, enter a CSS selector in the input field before scanning:

```
#main-content
.hero-section
nav.primary
```

---

## CLI Tool

### Features

- Dual-engine scanning: **axe-core** (primary) + **pa11y** (supplementary for broader AAA coverage)
- Generates a self-contained HTML report with:
  - Summary dashboard (violations, needs review, passed, not applicable)
  - Breakdown by WCAG level (A / AA / AAA) and impact (Critical / Serious / Moderate / Minor)
  - Issues grouped by rule with element selectors, HTML snippets, and fix suggestions
  - Source engine indicator (axe-core / pa11y)
  - **Manual review checklist** for all criteria that cannot be automated (~60% of WCAG 2.1)
- Auto-opens the report in your default browser

### Prerequisites

- Node.js 18 or later
- npm

### Installation

```bash
cd cli
npm install
```

### Usage

```bash
node test.js <url>
```

#### Examples

```bash
# Test a website
node test.js https://example.com

# Test a local development server
node test.js http://localhost:3000

# Test a specific page
node test.js https://mysite.com/contact
```

The report is saved to the current directory:

```
wcag-report-2026-04-13T13-07-57.html
```

### Report Sections

| Section | Description |
|---------|-------------|
| **Summary** | Total violations, needs review, passed rules, and not applicable |
| **Level Breakdown** | Issue count per WCAG level (A, AA, AAA, Best Practices) |
| **Impact Breakdown** | Issue count by severity (Critical, Serious, Moderate, Minor) |
| **Violations** | All confirmed failures, grouped by rule, expandable to see affected elements |
| **Needs Review** | Issues that require manual verification |
| **Passed** | Rules that passed (collapsed by default) |
| **Manual Checklist** | Interactive checklist of all WCAG 2.1 criteria requiring human review, grouped by principle (Perceivable, Operable, Understandable, Robust) |

---

## WCAG 2.1 Coverage

| Level | Criteria Count | Description |
|-------|---------------|-------------|
| A | 30 | Minimum accessibility requirements |
| AA | 20 | Standard compliance target (legal requirement in most jurisdictions) |
| AAA | 28 | Highest level of accessibility |
| **Total** | **78** | All success criteria covered |

### Automation Limitations

Automated tools can reliably test approximately **30-40%** of WCAG criteria. The remaining criteria require human judgment. The CLI report includes a manual review checklist covering all non-automatable criteria with guidance on what to check.

**Fully automatable:** Color contrast, language of page, parsing, duplicate IDs

**Partially automatable:** Alt text presence (but not quality), form labels, ARIA attributes, link text

**Manual only:** Captions, audio descriptions, meaningful sequence, keyboard navigation quality, consistent navigation, error suggestions

---

## Project Structure

```
wcag2.1/
├── README.md
├── extension/                  # Chrome Extension
│   ├── manifest.json           # Manifest V3 config
│   ├── devtools.html           # DevTools entry point
│   ├── devtools.js             # Creates the DevTools panel
│   ├── background.js           # Service worker (message relay)
│   ├── content-script.js       # Page-injected script (axe-core runner + highlighting)
│   ├── panel.html              # Panel UI structure
│   ├── panel.css               # Panel styling
│   ├── panel.js                # Panel logic (scan, render, export)
│   ├── lib/
│   │   └── axe.min.js          # axe-core 4.11.2 (~550KB)
│   └── icons/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
└── cli/                        # CLI Tool
    ├── package.json
    ├── test.js                 # Main entry point
    ├── report.js               # HTML report generator
    └── wcag-criteria.js        # All 78 WCAG 2.1 criteria reference data
```

---

## Technology

- **[axe-core](https://github.com/dequelabs/axe-core)** v4.11.2 — Open-source accessibility engine by Deque (MIT license)
- **[pa11y](https://github.com/pa11y/pa11y)** — Accessibility testing tool using HTML_CodeSniffer
- **[Puppeteer](https://pptr.dev/)** — Headless Chrome for CLI scanning
- **Chrome Extension Manifest V3** — Modern extension architecture

---

## License

MIT
