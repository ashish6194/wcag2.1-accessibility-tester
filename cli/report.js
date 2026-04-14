const fs = require('fs');
const CRITERIA = require('./wcag-criteria');

function generateReport({ url, pageTitle, timestamp, axeResults, pa11yResults, merged, filepath, pages, score }) {
  const html = buildHtml(url, pageTitle, timestamp, axeResults, pa11yResults, merged, pages, score);
  fs.writeFileSync(filepath, html, 'utf-8');
}

function buildHtml(url, pageTitle, timestamp, axeResults, pa11yResults, merged, pages, score) {
  const date = new Date(timestamp).toLocaleString();
  const totalViolationNodes = merged.violations.reduce((s, r) => s + (r.nodes ? r.nodes.length : 0), 0);
  const totalIncompleteNodes = merged.incomplete.reduce((s, r) => s + (r.nodes ? r.nodes.length : 0), 0);

  // Count by level using exact tag matching
  const byLevel = { A: 0, AA: 0, AAA: 0, BP: 0 };
  const levelAAATags = ['wcag2aaa', 'wcag21aaa'];
  const levelAATags = ['wcag2aa', 'wcag21aa'];
  const levelATags = ['wcag2a', 'wcag21a'];
  merged.violations.forEach(rule => {
    const tags = rule.tags || [];
    if (tags.some(t => levelAAATags.includes(t))) byLevel.AAA++;
    else if (tags.some(t => levelAATags.includes(t))) byLevel.AA++;
    else if (tags.some(t => levelATags.includes(t))) byLevel.A++;
    if (tags.includes('best-practice')) byLevel.BP++;
  });

  // Count by impact
  const byImpact = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  merged.violations.forEach(rule => {
    const impact = rule.impact || 'minor';
    byImpact[impact] = (byImpact[impact] || 0) + (rule.nodes ? rule.nodes.length : 0);
  });

  // Manual checklist — criteria not fully automatable
  const manualCriteria = CRITERIA.filter(c => c.automatable !== 'full');
  const principles = ['Perceivable', 'Operable', 'Understandable', 'Robust'];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${pageTitle ? esc(pageTitle) + ' — ' : ''}WCAG 2.1 Accessibility Report</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;background:#f8f9fa;line-height:1.6;font-size:14px}
.container{max-width:1100px;margin:0 auto;padding:20px}
h1{font-size:20px;margin-bottom:4px}
h2{font-size:17px;margin:28px 0 12px;padding-bottom:6px;border-bottom:2px solid #e5e7eb}
h3{font-size:14px;margin:16px 0 8px}
.meta{color:#6b7280;font-size:13px;margin-bottom:20px}
.meta span{margin-right:16px}

/* Summary cards */
.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
.card{background:#fff;border-radius:8px;padding:16px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.08)}
.card-count{font-size:28px;font-weight:700;line-height:1.2}
.card-label{font-size:12px;color:#6b7280;margin-top:2px}
.card-violations .card-count{color:#dc2626}
.card-incomplete .card-count{color:#d97706}
.card-passes .card-count{color:#16a34a}
.card-inapplicable .card-count{color:#6b7280}

/* Level breakdown */
.levels{display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap}
.level-chip{padding:6px 14px;border-radius:6px;font-size:13px;font-weight:600;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.08)}
.level-chip span{font-size:18px;margin-right:4px}

/* Impact breakdown */
.impacts{display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap}
.impact-chip{padding:6px 14px;border-radius:6px;font-size:13px;font-weight:600}
.impact-critical{background:#fef2f2;color:#dc2626}
.impact-serious{background:#fff7ed;color:#ea580c}
.impact-moderate{background:#fffbeb;color:#d97706}
.impact-minor{background:#f0fdf4;color:#16a34a}

/* Rules */
.rule{background:#fff;border-radius:8px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,0.06);overflow:hidden}
.rule-header{padding:12px 16px;cursor:pointer;display:flex;align-items:center;gap:10px}
.rule-header:hover{background:#f9fafb}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.3px}
.badge-critical{background:#fef2f2;color:#dc2626}
.badge-serious{background:#fff7ed;color:#ea580c}
.badge-moderate{background:#fffbeb;color:#d97706}
.badge-minor{background:#f0fdf4;color:#16a34a}
.rule-desc{flex:1;font-weight:500}
.rule-count{background:#f3f4f6;padding:2px 10px;border-radius:12px;font-size:12px;color:#6b7280;font-weight:600}
.tag{display:inline-block;padding:1px 6px;border-radius:3px;font-size:11px;background:#eef2ff;color:#4338ca;font-weight:500;margin-left:4px}
.source-tag{background:#f0fdf4;color:#16a34a}
.rule-nodes{padding:0 16px 12px;display:none}
.rule.expanded .rule-nodes{display:block}
.rule-detail{padding:12px 16px;display:none;background:#fafbfc;border-top:1px solid #e5e7eb}
.rule.expanded .rule-detail{display:block}
.rule-reason{margin-bottom:12px;padding:10px 14px;background:#eff6ff;border-left:3px solid #3b82f6;border-radius:0 6px 6px 0;font-size:13px;color:#1e40af;line-height:1.6}
.rule-reason strong{display:block;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#3b82f6;margin-bottom:3px}
.rule-links{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.rule-wcag-link{display:inline-flex;align-items:center;gap:4px;padding:6px 12px;background:#eef2ff;border:1px solid #c7d2fe;border-radius:6px;font-size:12px;font-weight:600;color:#4338ca;text-decoration:none;transition:all 0.15s}
.rule-wcag-link:hover{background:#e0e7ff;border-color:#a5b4fc;text-decoration:none}
.rule-wcag-link svg{width:14px;height:14px}
.rule-fix-summary{margin-bottom:12px;padding:10px 14px;background:#f0fdf4;border-left:3px solid #16a34a;border-radius:0 6px 6px 0;font-size:13px;color:#166534;line-height:1.6}
.rule-fix-summary strong{display:block;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#16a34a;margin-bottom:3px}
.node{padding:12px 14px;margin-top:10px;background:#fff;border:1px solid #e5e7eb;border-radius:8px}
.node-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:#6b7280;margin-bottom:4px}
.node-selector{font-family:'SF Mono',Monaco,monospace;font-size:12px;color:#7c3aed;margin-bottom:8px;word-break:break-all;padding:6px 8px;background:#f5f3ff;border-radius:4px}
.node-html{font-family:'SF Mono',Monaco,monospace;font-size:12px;color:#1a1a1a;background:#1e293b;color:#e2e8f0;padding:10px 12px;border-radius:6px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;max-height:120px;overflow-y:auto;line-height:1.5}
.node-html .hl-tag{color:#7dd3fc}
.node-html .hl-attr{color:#fbbf24}
.node-html .hl-val{color:#86efac}
.node-fix{margin-top:8px;padding:8px 10px;background:#fefce8;border-radius:4px;font-size:12px;color:#854d0e;line-height:1.5}
.node-fix strong{color:#a16207}
.node-msg{font-size:13px;color:#374151;margin-top:6px}

/* Manual checklist */
.checklist{background:#fff;border-radius:8px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.06);margin-bottom:12px}
.check-item{padding:8px 0;border-bottom:1px solid #f3f4f6;display:flex;gap:10px;align-items:flex-start}
.check-item:last-child{border-bottom:none}
.check-box{width:18px;height:18px;border:2px solid #d1d5db;border-radius:4px;flex-shrink:0;margin-top:2px;cursor:pointer}
.check-box:hover{border-color:#3b82f6}
.check-id{font-weight:600;color:#3b82f6;min-width:48px}
.check-level{font-size:11px;font-weight:600;padding:1px 6px;border-radius:3px;min-width:28px;text-align:center}
.check-level-a{background:#dbeafe;color:#1d4ed8}
.check-level-aa{background:#fef3c7;color:#92400e}
.check-level-aaa{background:#fce7f3;color:#9d174d}
.check-name{font-weight:500;flex:1}
.check-manual{font-size:12px;color:#6b7280;margin-top:2px}
.check-auto{font-size:11px;padding:1px 6px;border-radius:3px;background:#f3f4f6;color:#6b7280}

/* Toggle */
.toggle-btn{background:none;border:none;color:#3b82f6;font-size:13px;cursor:pointer;padding:4px 0}
.toggle-btn:hover{text-decoration:underline}

/* Footer */
.footer{text-align:center;padding:20px;color:#9ca3af;font-size:12px;margin-top:20px}
</style>
</head>
<body>
<div class="container">
  <h1>${pageTitle ? esc(pageTitle) : 'WCAG 2.1 Accessibility Report'}</h1>
  <div style="font-size:14px;color:#6b7280;margin-bottom:4px">WCAG 2.1 Accessibility Report</div>
  <div class="meta">
    <span>URL: <strong>${esc(url)}</strong></span>
    <span>Date: ${esc(date)}</span>
    <span>Engines: axe-core + pa11y + Lighthouse + custom</span>
  </div>

  ${renderComplianceVerdict(merged, score, byImpact)}

  ${renderPrioritizedActions(merged)}

  <!-- Score -->
  ${score !== undefined ? `
  <h2 style="margin-top:32px">Score Breakdown</h2>
  <div style="display:flex;align-items:center;gap:20px;margin-bottom:24px;background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
    <div style="width:80px;height:80px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:800;color:#fff;background:${score >= 90 ? '#16a34a' : score >= 70 ? '#d97706' : '#dc2626'}">${score}</div>
    <div style="flex:1">
      <div style="font-size:18px;font-weight:700">Compliance Score (WCAG 2.1 AA): ${score}/100</div>
      <div style="font-size:14px;color:#6b7280;margin-top:2px">Grade: ${score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 50 ? 'D' : 'F'} — ${score >= 90 ? 'Excellent' : score >= 80 ? 'Good' : score >= 70 ? 'Needs Improvement' : score >= 50 ? 'Poor' : 'Critical Issues'}</div>
      <div style="font-size:12px;color:#9ca3af;margin-top:6px;line-height:1.5">
        Measures compliance with <strong>WCAG 2.1 Level A + AA</strong> success criteria — the conformance level required by <strong>Section 508 (US)</strong>, <strong>ADA</strong>, and <strong>EN 301 549 (EU)</strong>. AAA violations and best-practice issues are reported separately and do not affect this score.
      </div>
    </div>
  </div>` : ''}

  <!-- Summary -->
  <div class="summary">
    <div class="card card-violations">
      <div class="card-count">${totalViolationNodes}</div>
      <div class="card-label">Violations</div>
    </div>
    <div class="card card-incomplete">
      <div class="card-count">${totalIncompleteNodes}</div>
      <div class="card-label">Needs Review</div>
    </div>
    <div class="card card-passes">
      <div class="card-count">${merged.passes.length}</div>
      <div class="card-label">Passed Rules</div>
    </div>
    <div class="card card-inapplicable">
      <div class="card-count">${merged.inapplicable.length}</div>
      <div class="card-label">Not Applicable</div>
    </div>
  </div>

  <!-- Batch Page Summary -->
  ${pages && pages.length > 1 ? `
  <h2>Page Scores (${pages.length} pages)</h2>
  <div style="display:grid;gap:8px;margin-bottom:24px">
    ${pages.map(p => `
    <div style="display:flex;align-items:center;gap:12px;background:#fff;padding:10px 16px;border-radius:6px;box-shadow:0 1px 2px rgba(0,0,0,0.06)">
      <span style="display:inline-block;width:36px;height:36px;border-radius:50%;text-align:center;line-height:36px;font-weight:700;font-size:13px;color:#fff;background:${p.score >= 90 ? '#16a34a' : p.score >= 70 ? '#d97706' : '#dc2626'}">${p.score}</span>
      <span style="flex:1;font-size:13px;word-break:break-all">${esc(p.url)}</span>
      ${p.error ? '<span style="color:#dc2626;font-size:12px">Error</span>' : `<span style="color:#6b7280;font-size:12px">${p.merged.violations.reduce((s,r) => s + (r.nodes ? r.nodes.length : 0), 0)} violations</span>`}
    </div>`).join('')}
  </div>` : ''}

  <!-- Level breakdown -->
  <div class="levels">
    <div class="level-chip"><span>${byLevel.A}</span> Level A</div>
    <div class="level-chip"><span>${byLevel.AA}</span> Level AA</div>
    <div class="level-chip"><span>${byLevel.AAA}</span> Level AAA</div>
    <div class="level-chip"><span>${byLevel.BP}</span> Best Practices</div>
  </div>

  <!-- Impact breakdown -->
  <div class="impacts">
    <div class="impact-chip impact-critical">${byImpact.critical} Critical</div>
    <div class="impact-chip impact-serious">${byImpact.serious} Serious</div>
    <div class="impact-chip impact-moderate">${byImpact.moderate} Moderate</div>
    <div class="impact-chip impact-minor">${byImpact.minor} Minor</div>
  </div>

  <!-- Violations grouped by WCAG criterion -->
  <h2>Violations by WCAG Criterion (${merged.violations.length} rules, ${totalViolationNodes} elements)</h2>
  ${renderRulesByWcagCriterion(merged.violations)}

  <!-- Needs Review -->
  <h2>Needs Review (${merged.incomplete.length} rules)</h2>
  ${renderRules(merged.incomplete, 'incomplete')}

  <!-- Passed -->
  <h2>Passed (${merged.passes.length} rules)</h2>
  <details>
    <summary class="toggle-btn">Show ${merged.passes.length} passed rules</summary>
    ${renderRules(merged.passes, 'pass')}
  </details>

  <!-- Manual Checklist -->
  <h2>Manual Review Checklist</h2>
  <p style="color:#6b7280;margin-bottom:16px;font-size:13px">
    These ${manualCriteria.length} criteria require human review. Automated tools cannot fully verify them.
  </p>
  ${principles.map(p => {
    const items = manualCriteria.filter(c => c.principle === p);
    if (items.length === 0) return '';
    return `
    <h3>${esc(p)} (${items.length} criteria)</h3>
    <div class="checklist">
      ${items.map(c => `
      <div class="check-item">
        <div class="check-box" onclick="this.style.background=this.style.background?'':'#3b82f6';this.style.borderColor=this.style.borderColor==='rgb(59, 130, 246)'?'#d1d5db':'#3b82f6'"></div>
        <span class="check-id">${esc(c.id)}</span>
        <span class="check-level check-level-${c.level.toLowerCase()}">${esc(c.level)}</span>
        <div style="flex:1">
          <div class="check-name">${esc(c.name)}</div>
          <div class="check-manual">${esc(c.manual)}</div>
        </div>
        <span class="check-auto">${esc(c.automatable)}</span>
      </div>`).join('')}
    </div>`;
  }).join('')}

  <div class="footer">
    Generated by WCAG 2.1 Tester | axe-core + pa11y | ${esc(date)}
  </div>
</div>

<script>
document.querySelectorAll('.rule-header').forEach(h => {
  h.addEventListener('click', () => h.parentElement.classList.toggle('expanded'));
});
</script>
</body>
</html>`;
}

function renderRules(rules, type) {
  if (!rules || rules.length === 0) {
    return '<p style="color:#9ca3af;padding:12px 0">None found.</p>';
  }

  const impactOrder = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  const sorted = [...rules].sort((a, b) => (impactOrder[a.impact] || 4) - (impactOrder[b.impact] || 4));

  return sorted.map(rule => {
    const impact = rule.impact || 'info';
    const tags = (rule.tags || []).filter(t => t.startsWith('wcag') || t === 'best-practice');
    const nodeCount = rule.nodes ? rule.nodes.length : 0;
    const source = rule.source || 'axe-core';

    // Map to WCAG criterion
    const wcagId = extractWcagId(tags);
    const criterion = wcagId ? CRITERIA.find(c => c.id === wcagId) : null;
    const reason = getWhyItMatters(rule, criterion);
    const wcagUrl = wcagId ? `https://www.w3.org/WAI/WCAG21/Understanding/${wcagIdToSlug(wcagId)}` : '';
    const fixSummary = getFixSummary(rule);

    return `
    <div class="rule">
      <div class="rule-header">
        <span class="badge badge-${impact}">${esc(impact)}</span>
        <span class="rule-desc">${esc(rule.description || rule.help || rule.id)}</span>
        ${nodeCount > 0 ? `<span class="rule-count">${nodeCount} element${nodeCount > 1 ? 's' : ''}</span>` : ''}
        ${tags.map(t => `<span class="tag">${esc(formatTag(t))}</span>`).join('')}
        <span class="tag source-tag">${esc(source)}</span>
      </div>
      <div class="rule-detail">
        ${criterion ? `
        <div class="rule-reason">
          <strong>Why it matters${criterion ? ` (WCAG ${esc(criterion.id)} ${esc(criterion.name)} — Level ${esc(criterion.level)})` : ''}</strong>
          ${esc(reason)}
        </div>` : `
        <div class="rule-reason">
          <strong>Why it matters</strong>
          ${esc(reason)}
        </div>`}
        <div class="rule-links">
          ${wcagUrl ? `<a class="rule-wcag-link" href="${esc(wcagUrl)}" target="_blank"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 3H3v10h10v-3M9 1h6v6M15 1L7 9"/></svg> WCAG ${esc(wcagId)} — ${criterion ? esc(criterion.name) : 'Documentation'}</a>` : ''}
          ${rule.helpUrl ? `<a class="rule-wcag-link" href="${esc(rule.helpUrl)}" target="_blank" style="background:#f0fdf4;border-color:#bbf7d0;color:#166534"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 3H3v10h10v-3M9 1h6v6M15 1L7 9"/></svg> axe-core Rule: ${esc(rule.id)}</a>` : ''}
        </div>
        ${fixSummary ? `
        <div class="rule-fix-summary">
          <strong>How to fix</strong>
          ${esc(fixSummary)}
        </div>` : ''}
        ${rule.nodes && rule.nodes.length > 0 ? `
        <div class="rule-nodes" style="display:block;padding:0">
          ${rule.nodes.map((node, i) => {
            const selector = node.target ? node.target.join(' > ') : '';
            const html = node.html || '';
            return `
            <div class="node">
              <div class="node-label">Element ${i + 1} of ${nodeCount}</div>
              <div class="node-label" style="margin-top:6px">Location (CSS Selector)</div>
              <div class="node-selector">${esc(selector)}</div>
              ${html ? `
              <div class="node-label">Source Code</div>
              <div class="node-html">${highlightHtml(esc(html))}</div>` : ''}
              ${node.failureSummary ? `
              <div class="node-fix">
                <strong>Fix:</strong> ${esc(node.failureSummary)}
              </div>` : ''}
            </div>`;
          }).join('')}
        </div>` : ''}
      </div>
    </div>`;
  }).join('');
}

// Extract WCAG criterion ID from tags (e.g., wcag111 → 1.1.1)
function extractWcagId(tags) {
  if (!tags) return null;
  for (const tag of tags) {
    const m = tag.match(/^wcag(\d)(\d)(\d+)$/);
    if (m) return m[1] + '.' + m[2] + '.' + m[3];
  }
  return null;
}

// Convert WCAG ID to URL slug (1.1.1 → non-text-content)
function wcagIdToSlug(id) {
  const slugMap = {
    '1.1.1':'non-text-content','1.2.1':'audio-only-and-video-only-prerecorded','1.2.2':'captions-prerecorded',
    '1.2.3':'audio-description-or-media-alternative-prerecorded','1.2.4':'captions-live','1.2.5':'audio-description-prerecorded',
    '1.3.1':'info-and-relationships','1.3.2':'meaningful-sequence','1.3.3':'sensory-characteristics',
    '1.3.4':'orientation','1.3.5':'identify-input-purpose','1.3.6':'identify-purpose',
    '1.4.1':'use-of-color','1.4.2':'audio-control','1.4.3':'contrast-minimum',
    '1.4.4':'resize-text','1.4.5':'images-of-text','1.4.6':'contrast-enhanced',
    '1.4.10':'reflow','1.4.11':'non-text-contrast','1.4.12':'text-spacing','1.4.13':'content-on-hover-or-focus',
    '2.1.1':'keyboard','2.1.2':'no-keyboard-trap','2.1.4':'character-key-shortcuts',
    '2.2.1':'timing-adjustable','2.2.2':'pause-stop-hide',
    '2.3.1':'three-flashes-or-below-threshold','2.3.3':'animation-from-interactions',
    '2.4.1':'bypass-blocks','2.4.2':'page-titled','2.4.3':'focus-order','2.4.4':'link-purpose-in-context',
    '2.4.5':'multiple-ways','2.4.6':'headings-and-labels','2.4.7':'focus-visible',
    '2.4.8':'location','2.4.9':'link-purpose-link-only','2.4.10':'section-headings',
    '2.5.1':'pointer-gestures','2.5.2':'pointer-cancellation','2.5.3':'label-in-name',
    '2.5.4':'motion-actuation','2.5.5':'target-size',
    '3.1.1':'language-of-page','3.1.2':'language-of-parts','3.1.4':'abbreviations','3.1.5':'reading-level',
    '3.2.1':'on-focus','3.2.2':'on-input','3.2.3':'consistent-navigation','3.2.4':'consistent-identification',
    '3.2.5':'change-on-request',
    '3.3.1':'error-identification','3.3.2':'labels-or-instructions','3.3.3':'error-suggestion',
    '3.3.4':'error-prevention-legal-financial-data','3.3.5':'help','3.3.6':'error-prevention-all',
    '4.1.1':'parsing','4.1.2':'name-role-value','4.1.3':'status-messages'
  };
  return slugMap[id] || id.replace(/\./g, '-');
}

// "Why it matters" — real-world user impact explanation
function getWhyItMatters(rule, criterion) {
  // Impact-based reasons
  const impactReasons = {
    'color-contrast': 'Users with low vision or color blindness cannot read text that does not have enough contrast against its background. This affects approximately 300 million people worldwide.',
    'color-contrast-enhanced': 'Enhanced contrast helps users with moderately low vision who do not use assistive technology. A 7:1 ratio ensures readability in more lighting conditions.',
    'image-alt': 'Screen reader users hear "image" with no description. Without alt text, they have no idea what the image shows or why it is there.',
    'link-name': 'Screen reader users navigate by links. Without accessible text, they hear "link" with no indication of where it goes.',
    'button-name': 'Screen reader users cannot determine the purpose of a button without an accessible name.',
    'label': 'Users relying on voice control cannot target form fields without labels. Screen reader users do not know what information to enter.',
    'document-title': 'The page title is the first thing screen reader users hear. It helps users understand where they are and distinguish between open tabs.',
    'html-has-lang': 'Screen readers use the language attribute to switch pronunciation. Without it, content may be read with the wrong accent or pronunciation rules.',
    'bypass': 'Keyboard-only users must tab through every navigation link before reaching the main content. A skip link lets them jump directly to content.',
    'heading-order': 'Screen reader users navigate by headings. Skipping levels (h1 to h3) creates confusion about the document structure.',
  };

  // Check by rule ID first
  const ruleId = (rule.id || '').replace(/^(pa11y-|lh-|custom-)/, '');
  if (impactReasons[ruleId]) return impactReasons[ruleId];

  // Check by custom rule patterns
  if (rule.id && rule.id.startsWith('custom-')) {
    const customReasons = {
      'custom-alt-suspicious': 'Screen reader users will hear meaningless text like "image" or "photo" instead of a useful description.',
      'custom-alt-filename': 'Screen reader users will hear the raw filename, which provides no meaningful information about the image.',
      'custom-alt-long': 'Very long alt text forces screen reader users to listen to a lengthy description. Consider a shorter alt with a longer description via aria-describedby.',
      'custom-alt-redundant': 'Screen reader users will hear the same text twice — once from the image alt and once from the visible text nearby.',
      'custom-alt-duplicate': 'Multiple images with identical alt text may confuse screen reader users about which image is which.',
      'custom-image-title-no-alt': 'The title attribute is shown on hover but is not reliably announced by screen readers. Alt text is the correct way to provide image descriptions.',
      'custom-spacer-image-alt': 'Spacer or decorative images should be hidden from screen readers with alt="" so they do not clutter the experience.',
      'custom-touch-target-minimum': 'Small touch targets are difficult for users with motor impairments, tremors, or limited dexterity to tap accurately.',
      'custom-touch-target-enhanced': 'Larger touch targets (44x44px) reduce errors for all users, especially on mobile devices.',
      'custom-link-suspicious': 'Links like "click here" or "read more" are meaningless when listed out of context. Screen reader users often navigate by listing all links on a page.',
      'custom-link-internal-broken': 'The in-page anchor target does not exist, so clicking this link does nothing. This breaks keyboard navigation.',
      'custom-label-empty': 'An empty label provides no information to screen reader users about what the form field expects.',
      'custom-label-orphaned': 'The label is not connected to any form control, so clicking it does nothing and screen readers cannot associate it.',
      'custom-fieldset-missing': 'Without a fieldset and legend, screen reader users do not know that radio buttons or checkboxes belong to a group.',
      'custom-mouse-only-handler': 'Users who cannot use a mouse (keyboard-only, switch devices, voice control) cannot activate this element.',
      'custom-heading-possible': 'Text that looks like a heading but is not marked up as one is invisible to screen reader navigation. Users cannot jump to this section.',
      'custom-text-small': 'Very small text is difficult to read for users with low vision, and cannot always be enlarged by browser zoom.',
      'custom-flash-risk': 'Rapidly flashing content can trigger seizures in people with photosensitive epilepsy. This is a serious safety issue.',
      'custom-video-no-captions': 'Deaf and hard-of-hearing users cannot understand video content without captions.',
      'custom-skip-navigation': 'Without a skip link or main landmark, keyboard users must tab through every navigation element on every page.',
      'custom-focus-visible': 'Keyboard users cannot see where they are on the page if focused elements have no visible outline.',
      'custom-horizontal-scroll': 'Users who zoom in to read text may need to scroll horizontally, which is disorienting and difficult for many users.',
      'custom-text-spacing-clip': 'Users who increase text spacing for readability may lose content that clips due to fixed-height containers.',
      'custom-reading-level': 'Content at a high reading level excludes users with cognitive disabilities, learning disabilities, or non-native speakers.',
      'custom-meta-refresh': 'Automatic page redirects can disorient users, especially those using screen readers or who need more time to read.',
      'custom-auto-updating': 'Moving content is distracting for users with attention disorders and impossible to read for users with some cognitive disabilities.',
      'custom-error-prevention': 'Without a confirmation step, users may accidentally submit payments, delete data, or make irreversible changes.',
      'custom-new-window-warning': 'Opening a new window without warning disorients screen reader users and breaks the back button for all users.',
    };
    if (customReasons[rule.id]) return customReasons[rule.id];
  }

  // Fallback: generate from criterion
  if (criterion) {
    return criterion.description + ' This ensures the content is accessible to users with disabilities.';
  }

  // Generic fallback by impact
  const genericReasons = {
    critical: 'This issue completely blocks access for some users with disabilities.',
    serious: 'This issue creates a significant barrier for users with disabilities.',
    moderate: 'This issue makes the content more difficult to use for some users with disabilities.',
    minor: 'This issue may create a minor inconvenience for some users with disabilities.'
  };
  return genericReasons[rule.impact] || 'This issue may affect accessibility for some users.';
}

// "How to fix" summary for common rules
function getFixSummary(rule) {
  const fixes = {
    'color-contrast': 'Increase the contrast ratio between text color and background color. Use a contrast checker tool to verify the ratio meets 4.5:1 for normal text or 3:1 for large text.',
    'color-contrast-enhanced': 'Increase the contrast ratio to at least 7:1 for normal text or 4.5:1 for large text to meet AAA requirements.',
    'image-alt': 'Add a descriptive alt attribute to the image. If decorative, use alt="". If complex, provide a longer description via aria-describedby.',
    'link-name': 'Add text content to the link, or use aria-label to provide an accessible name.',
    'button-name': 'Add text content inside the button, or use aria-label to provide an accessible name.',
    'label': 'Add a <label> element associated with the form control via the "for" attribute matching the input\'s "id".',
    'document-title': 'Add a descriptive <title> element inside <head> that clearly identifies the page content.',
    'html-has-lang': 'Add lang="en" (or appropriate language code) to the <html> element.',
    'bypass': 'Add a skip navigation link at the top of the page, or use a <main> landmark to identify the primary content area.',
    'heading-order': 'Ensure headings follow a logical order (h1 then h2 then h3). Do not skip heading levels.',
    'custom-alt-suspicious': 'Replace the alt text with a meaningful description of the image content and purpose.',
    'custom-alt-filename': 'Replace the filename in alt text with a meaningful description of what the image shows.',
    'custom-link-suspicious': 'Replace vague link text with a description of where the link goes, e.g., "View our pricing plans" instead of "Click here".',
    'custom-label-empty': 'Add descriptive text inside the <label> element so users know what the form field expects.',
    'custom-label-orphaned': 'Update the label\'s "for" attribute to match an existing form control\'s "id" attribute.',
    'custom-fieldset-missing': 'Wrap related radio buttons or checkboxes in a <fieldset> element with a <legend> that describes the group.',
    'custom-mouse-only-handler': 'Add a keyboard event handler (onkeydown/onkeypress), role, and tabindex to make the element keyboard accessible. Or use a <button> element instead.',
    'custom-touch-target-minimum': 'Increase the clickable/tappable area to at least 24x24 CSS pixels using padding, min-width, or min-height.',
    'custom-focus-visible': 'Add a visible :focus or :focus-visible style (outline, border, or box-shadow) so keyboard users can see where they are.',
    'custom-video-no-captions': 'Add a <track kind="captions" src="captions.vtt" srclang="en"> element inside the <video> tag.',
    'custom-skip-navigation': 'Add a visually hidden skip link as the first focusable element: <a href="#main" class="skip-link">Skip to main content</a>.',
    'custom-heading-possible': 'Convert this text to an appropriate heading element (h2, h3, etc.) to make it navigable by screen readers.',
    'custom-flash-risk': 'Remove or slow down the animation to ensure content does not flash more than 3 times per second.',
    'custom-text-spacing-clip': 'Remove the fixed height or change overflow:hidden to overflow:visible so content can expand when text spacing is increased.',
    'custom-reading-level': 'Simplify sentence structure, use shorter words, and provide summaries of complex content.',
    'custom-error-prevention': 'Add a confirmation step (review page, checkbox, or modal) before submitting important forms.',
  };

  const ruleId = (rule.id || '').replace(/^(pa11y-|lh-)/, '');
  return fixes[ruleId] || fixes[rule.id] || '';
}

// Syntax highlight HTML in code blocks
function highlightHtml(html) {
  return html
    .replace(/(&lt;\/?)([\w-]+)/g, '$1<span style="color:#7dd3fc">$2</span>')
    .replace(/([\w-]+)(=)(&quot;[^&]*&quot;)/g, '<span style="color:#fbbf24">$1</span>$2<span style="color:#86efac">$3</span>');
}

function formatTag(tag) {
  const map = {
    'wcag2a': 'A', 'wcag2aa': 'AA', 'wcag2aaa': 'AAA',
    'wcag21a': '2.1 A', 'wcag21aa': '2.1 AA', 'wcag21aaa': '2.1 AAA',
    'best-practice': 'BP'
  };
  if (map[tag]) return map[tag];
  const match = tag.match(/^wcag(\d)(\d)(\d+)$/);
  if (match) return `${match[1]}.${match[2]}.${match[3]}`;
  return tag;
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================================
// 1. COMPLIANCE VERDICT
// ============================================================
function renderComplianceVerdict(merged, score, byImpact) {
  // Count A/AA violations only (compliance-critical)
  const criticalCount = byImpact.critical || 0;
  const seriousCount = byImpact.serious || 0;
  const moderateCount = byImpact.moderate || 0;

  // Filter to A/AA only
  const aaViolations = merged.violations.filter(rule => {
    const tags = rule.tags || [];
    const hasA_or_AA = tags.some(t => /^wcag(2|21)(a|aa)$/.test(t) || /^wcag\d{3,}$/.test(t));
    const isAAAOnly = tags.some(t => /^wcag(2|21)aaa$/.test(t)) && !hasA_or_AA;
    return hasA_or_AA && !isAAAOnly;
  });

  const aaCriticalRules = aaViolations.filter(r => r.impact === 'critical').length;
  const aaSeriousRules = aaViolations.filter(r => r.impact === 'serious').length;
  const aaModerateRules = aaViolations.filter(r => r.impact === 'moderate').length;
  const aaTotalElements = aaViolations.reduce((s, r) => s + (r.nodes ? r.nodes.length : 0), 0);

  // Determine verdict
  let verdict, verdictColor, verdictIcon;
  if (aaCriticalRules === 0 && aaSeriousRules === 0 && aaModerateRules === 0) {
    verdict = 'COMPLIANT'; verdictColor = '#16a34a'; verdictIcon = '✓';
  } else if (aaCriticalRules === 0 && aaSeriousRules === 0) {
    verdict = 'SUBSTANTIALLY COMPLIANT'; verdictColor = '#d97706'; verdictIcon = '⚠';
  } else {
    verdict = 'NOT COMPLIANT'; verdictColor = '#dc2626'; verdictIcon = '✗';
  }

  // Estimate effort
  const effortMinutes = (aaCriticalRules * 15) + (aaSeriousRules * 20) + (aaModerateRules * 10);
  let effort;
  if (effortMinutes === 0) effort = 'No fixes required';
  else if (effortMinutes < 60) effort = `~${effortMinutes} minutes`;
  else if (effortMinutes < 480) effort = `~${Math.round(effortMinutes / 60)} hours`;
  else effort = `${Math.round(effortMinutes / 480)}+ working days`;

  return `
  <div style="background:#fff;border-radius:12px;padding:24px;margin-bottom:24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);border-left:6px solid ${verdictColor}">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
      <span style="display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%;background:${verdictColor};color:#fff;font-size:22px;font-weight:700">${verdictIcon}</span>
      <div>
        <div style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">Compliance Verdict</div>
        <div style="font-size:22px;font-weight:800;color:${verdictColor}">${verdict}</div>
        <div style="font-size:13px;color:#6b7280;margin-top:2px">with WCAG 2.1 Level A + AA (Section 508, ADA, EN 301 549)</div>
      </div>
    </div>

    ${aaViolations.length > 0 ? `
    <div style="background:#f9fafb;border-radius:8px;padding:14px 16px;margin-top:16px">
      <div style="font-size:12px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:0.3px;margin-bottom:8px">Blockers to Compliance</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap">
        ${aaCriticalRules > 0 ? `<div><span style="display:inline-block;padding:2px 10px;border-radius:4px;background:#fef2f2;color:#dc2626;font-weight:700;font-size:12px">CRITICAL</span> <strong>${aaCriticalRules}</strong> issue${aaCriticalRules !== 1 ? 's' : ''} (blocks access entirely)</div>` : ''}
        ${aaSeriousRules > 0 ? `<div><span style="display:inline-block;padding:2px 10px;border-radius:4px;background:#fff7ed;color:#ea580c;font-weight:700;font-size:12px">SERIOUS</span> <strong>${aaSeriousRules}</strong> issue${aaSeriousRules !== 1 ? 's' : ''} (significant barrier)</div>` : ''}
        ${aaModerateRules > 0 ? `<div><span style="display:inline-block;padding:2px 10px;border-radius:4px;background:#fffbeb;color:#d97706;font-weight:700;font-size:12px">MODERATE</span> <strong>${aaModerateRules}</strong> issue${aaModerateRules !== 1 ? 's' : ''}</div>` : ''}
      </div>
      <div style="margin-top:10px;font-size:13px;color:#4b5563">
        <strong>${aaTotalElements}</strong> total elements affected across <strong>${aaViolations.length}</strong> distinct rules.
        &nbsp;&nbsp;Estimated effort to reach compliance: <strong>${effort}</strong>.
      </div>
    </div>` : `
    <div style="background:#f0fdf4;border-radius:8px;padding:14px 16px;margin-top:16px;color:#166534;font-size:13px">
      <strong>No WCAG 2.1 A/AA violations detected.</strong> This page passes automated compliance checks. Manual verification of non-automatable criteria still recommended.
    </div>`}
  </div>`;
}

// ============================================================
// 2. PRIORITIZED ACTION LIST (Fix These First)
// ============================================================
function renderPrioritizedActions(merged) {
  // Filter to compliance-critical (A/AA) violations
  const aaViolations = merged.violations.filter(rule => {
    const tags = rule.tags || [];
    const hasA_or_AA = tags.some(t => /^wcag(2|21)(a|aa)$/.test(t) || /^wcag\d{3,}$/.test(t));
    const isAAAOnly = tags.some(t => /^wcag(2|21)aaa$/.test(t)) && !hasA_or_AA;
    return hasA_or_AA && !isAAAOnly;
  });

  if (aaViolations.length === 0) return '';

  // Score each rule: impact weight × log(node count) — ease factored in
  const impactWeights = { critical: 100, serious: 50, moderate: 20, minor: 5 };
  const priorityEffort = {
    // Quick wins
    'image-alt': 5, 'label': 10, 'button-name': 5, 'link-name': 5,
    'document-title': 2, 'html-has-lang': 1, 'duplicate-id': 5,
    // Medium
    'color-contrast': 30, 'color-contrast-enhanced': 30,
    'heading-order': 15, 'landmark-one-main': 10,
    // Larger
    'region': 20, 'bypass': 15
  };

  const scored = aaViolations.map(rule => {
    const weight = impactWeights[rule.impact] || 10;
    const nodes = rule.nodes ? rule.nodes.length : 1;
    // Priority = impact × slight node count scaling
    const priority = weight * (1 + Math.log10(nodes));
    const baseId = (rule.id || '').replace(/^(pa11y-|lh-|custom-)/, '');
    const effortPerNode = priorityEffort[baseId] || 10;
    const totalEffort = effortPerNode + (nodes - 1) * Math.min(effortPerNode * 0.3, 5);
    const effortLabel = totalEffort < 15 ? 'Quick (<15 min)' : totalEffort < 60 ? `${Math.round(totalEffort)} min` : `${Math.round(totalEffort / 60 * 2) / 2} hours`;
    return { rule, priority, effortLabel, nodes };
  }).sort((a, b) => b.priority - a.priority);

  const top5 = scored.slice(0, 5);

  return `
  <div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:24px;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
      <span style="font-size:20px">🎯</span>
      <div>
        <div style="font-size:16px;font-weight:700;color:#1a1a1a">Fix These First</div>
        <div style="font-size:12px;color:#6b7280">Top ${top5.length} issues prioritized by impact × effort</div>
      </div>
    </div>
    ${top5.map((item, i) => {
      const rule = item.rule;
      const impact = rule.impact || 'info';
      const impactEmoji = impact === 'critical' ? '🔴' : impact === 'serious' ? '🟠' : impact === 'moderate' ? '🟡' : '🟢';
      const desc = rule.description || rule.help || rule.id;
      return `
      <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 0;border-bottom:1px solid #f3f4f6">
        <div style="font-size:18px;font-weight:800;color:#9ca3af;min-width:28px">${i + 1}.</div>
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-size:14px">${impactEmoji}</span>
            <span style="font-weight:600;font-size:14px;color:#1a1a1a">${esc(desc)}</span>
          </div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px">
            <strong>${item.nodes}</strong> element${item.nodes !== 1 ? 's' : ''} · Estimated effort: <strong>${esc(item.effortLabel)}</strong>
            ${rule.helpUrl ? ` · <a href="${esc(rule.helpUrl)}" target="_blank" style="color:#3b82f6">Fix guide &rarr;</a>` : ''}
          </div>
        </div>
      </div>`;
    }).join('')}
    ${aaViolations.length > 5 ? `<div style="margin-top:12px;font-size:12px;color:#9ca3af">+${aaViolations.length - 5} more compliance issues below</div>` : ''}
  </div>`;
}

// ============================================================
// 3. GROUP VIOLATIONS BY WCAG CRITERION
// ============================================================
function renderRulesByWcagCriterion(rules) {
  if (!rules || rules.length === 0) {
    return '<p style="color:#9ca3af;padding:12px 0">None found.</p>';
  }

  // Group by WCAG criterion (e.g., 1.1.1)
  const byCriterion = {};
  rules.forEach(rule => {
    const tags = rule.tags || [];
    let criterionId = null;
    for (const tag of tags) {
      const m = tag.match(/^wcag(\d)(\d)(\d+)$/);
      if (m) { criterionId = m[1] + '.' + m[2] + '.' + m[3]; break; }
    }
    if (!criterionId) criterionId = 'other'; // Rules without specific criterion mapping

    if (!byCriterion[criterionId]) byCriterion[criterionId] = [];
    byCriterion[criterionId].push(rule);
  });

  // Sort criterion IDs
  const sortedIds = Object.keys(byCriterion).sort((a, b) => {
    if (a === 'other') return 1;
    if (b === 'other') return -1;
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) { if (pa[i] !== pb[i]) return pa[i] - pb[i]; }
    return 0;
  });

  return sortedIds.map(cid => {
    const criterion = cid !== 'other' ? CRITERIA.find(c => c.id === cid) : null;
    const cRules = byCriterion[cid];
    const totalNodes = cRules.reduce((s, r) => s + (r.nodes ? r.nodes.length : 0), 0);
    const wcagUrl = criterion ? `https://www.w3.org/WAI/WCAG21/Understanding/${wcagIdToSlug(cid)}` : '';

    return `
    <div style="margin-bottom:20px">
      <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:#eef2ff;border-radius:8px 8px 0 0;border-left:4px solid #4338ca">
        <span style="font-size:18px;font-weight:800;color:#4338ca">${cid !== 'other' ? esc(cid) : 'Uncategorized'}</span>
        ${criterion ? `
          <span style="flex:1;font-size:14px;font-weight:600;color:#1a1a1a">${esc(criterion.name)}</span>
          <span style="padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;background:${criterion.level === 'A' ? '#dbeafe' : criterion.level === 'AA' ? '#fef3c7' : '#fce7f3'};color:${criterion.level === 'A' ? '#1d4ed8' : criterion.level === 'AA' ? '#92400e' : '#9d174d'}">Level ${esc(criterion.level)}</span>
        ` : '<span style="flex:1;font-size:14px;color:#6b7280">Rules without direct WCAG mapping</span>'}
        <span style="font-size:12px;color:#6b7280">${cRules.length} rule${cRules.length !== 1 ? 's' : ''} · ${totalNodes} element${totalNodes !== 1 ? 's' : ''}</span>
        ${wcagUrl ? `<a href="${esc(wcagUrl)}" target="_blank" style="font-size:12px;color:#3b82f6;text-decoration:none;font-weight:500">W3C docs &rarr;</a>` : ''}
      </div>
      ${renderRules(cRules, 'violation')}
    </div>`;
  }).join('');
}

module.exports = { generateReport };
