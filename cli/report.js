const fs = require('fs');
const CRITERIA = require('./wcag-criteria');

function generateReport({ url, timestamp, axeResults, pa11yResults, merged, filepath }) {
  const html = buildHtml(url, timestamp, axeResults, pa11yResults, merged);
  fs.writeFileSync(filepath, html, 'utf-8');
}

function buildHtml(url, timestamp, axeResults, pa11yResults, merged) {
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
<title>WCAG 2.1 Report — ${esc(url)}</title>
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
.node{padding:10px 12px;margin-top:8px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px}
.node-selector{font-family:'SF Mono',Monaco,monospace;font-size:12px;color:#7c3aed;margin-bottom:4px;word-break:break-all}
.node-html{font-family:'SF Mono',Monaco,monospace;font-size:12px;color:#6b7280;background:#f3f4f6;padding:6px 8px;border-radius:4px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;max-height:80px;overflow-y:auto}
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
  <h1>WCAG 2.1 Accessibility Report</h1>
  <div class="meta">
    <span>URL: <strong>${esc(url)}</strong></span>
    <span>Date: ${esc(date)}</span>
    <span>Engines: axe-core + pa11y</span>
  </div>

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

  <!-- Violations -->
  <h2>Violations (${merged.violations.length} rules, ${totalViolationNodes} elements)</h2>
  ${renderRules(merged.violations, 'violation')}

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

    return `
    <div class="rule">
      <div class="rule-header">
        <span class="badge badge-${impact}">${esc(impact)}</span>
        <span class="rule-desc">${esc(rule.description || rule.help || rule.id)}</span>
        ${nodeCount > 0 ? `<span class="rule-count">${nodeCount}</span>` : ''}
        ${tags.map(t => `<span class="tag">${esc(formatTag(t))}</span>`).join('')}
        <span class="tag source-tag">${esc(source)}</span>
      </div>
      ${rule.nodes && rule.nodes.length > 0 ? `
      <div class="rule-nodes">
        ${rule.nodes.map(node => {
          const selector = node.target ? node.target.join(' > ') : '';
          return `
          <div class="node">
            <div class="node-selector">${esc(selector)}</div>
            <div class="node-html">${esc(node.html || '')}</div>
            ${node.failureSummary ? `<div class="node-msg">${esc(node.failureSummary)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>` : ''}
    </div>`;
  }).join('');
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

module.exports = { generateReport };
