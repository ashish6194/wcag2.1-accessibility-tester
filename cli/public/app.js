// WCAG 2.1 Tester — Dashboard Frontend

let currentResults = null;
let activeTab = 'violations';

// DOM
const urlInput = document.getElementById('urlInput');
const scanBtn = document.getElementById('scanBtn');
const scanBtnText = document.getElementById('scanBtnText');
const scanSpinner = document.getElementById('scanSpinner');
const progress = document.getElementById('progress');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const resultsContainer = document.getElementById('resultsContainer');
const rulesList = document.getElementById('rulesList');
const toast = document.getElementById('toast');
const historySidebar = document.getElementById('historySidebar');
const historyList = document.getElementById('historyList');

// Event listeners
scanBtn.addEventListener('click', startScan);
urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') startScan(); });
document.getElementById('historyToggle').addEventListener('click', toggleHistory);
document.getElementById('closeHistoryBtn').addEventListener('click', () => historySidebar.classList.add('hidden'));
document.getElementById('clearHistoryBtn').addEventListener('click', () => { localStorage.removeItem('wcag-history'); renderHistory(); });
document.getElementById('exportJsonBtn').addEventListener('click', () => exportResults('json'));
document.getElementById('exportCsvBtn').addEventListener('click', () => exportResults('csv'));
document.getElementById('exportHtmlBtn').addEventListener('click', () => exportHtmlReport());

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    activeTab = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    renderRules();
  });
});

// --- Scan ---
async function startScan() {
  const url = urlInput.value.trim();
  if (!url) { showToast('Please enter a URL'); return; }

  scanBtn.disabled = true;
  scanBtnText.textContent = 'Scanning...';
  scanSpinner.classList.remove('hidden');
  progress.classList.remove('hidden');
  resultsContainer.classList.add('hidden');
  progressFill.style.width = '10%';
  progressText.textContent = 'Starting scan...';

  try {
    // Use SSE for real-time progress
    const es = new EventSource(`/api/scan/stream?url=${encodeURIComponent(url)}`);
    let progressStep = 10;

    es.addEventListener('status', (e) => {
      const data = JSON.parse(e.data);
      progressStep = Math.min(progressStep + 15, 85);
      progressFill.style.width = progressStep + '%';
      progressText.textContent = data.message;
    });

    es.addEventListener('result', (e) => {
      currentResults = JSON.parse(e.data);
      progressFill.style.width = '100%';
      progressText.textContent = 'Scan complete!';
    });

    es.addEventListener('error', (e) => {
      try {
        const data = JSON.parse(e.data);
        showErrorBanner(data.message);
      } catch (_) {
        showErrorBanner('Scan connection lost. Check server and try again.');
      }
      es.close();
      progress.classList.add('hidden');
      scanBtn.disabled = false;
      scanBtnText.textContent = 'Scan';
      scanSpinner.classList.add('hidden');
    });

    es.addEventListener('done', () => {
      es.close();
      if (currentResults) {
        renderResults();
        saveHistory(currentResults);
        document.getElementById('exportJsonBtn').disabled = false;
        document.getElementById('exportCsvBtn').disabled = false;
        document.getElementById('exportHtmlBtn').disabled = false;
      }
      setTimeout(() => progress.classList.add('hidden'), 1000);
    });

    // Fallback: close SSE after 120s
    setTimeout(() => {
      if (es.readyState !== EventSource.CLOSED) {
        es.close();
        if (!currentResults) showToast('Scan timed out. Try again.');
      }
    }, 120000);

  } catch (err) {
    showToast('Scan failed: ' + err.message);
  } finally {
    scanBtn.disabled = false;
    scanBtnText.textContent = 'Scan';
    scanSpinner.classList.add('hidden');
  }
}

// --- Render Results ---
function renderResults() {
  if (!currentResults) return;
  const r = currentResults;

  // Score gauge
  drawScoreGauge(r.score);
  document.getElementById('scoreValue').textContent = r.score;
  document.getElementById('scoreValue').style.color = scoreColor(r.score);
  document.getElementById('gradeText').textContent = `Grade ${r.grade}`;

  // Summary cards
  document.getElementById('sViolations').textContent = r.summary.violations;
  document.getElementById('sIncomplete').textContent = r.summary.incomplete;
  document.getElementById('sPassed').textContent = r.summary.passed;
  document.getElementById('sNA').textContent = r.summary.inapplicable;

  // Engine stats
  if (r.engines) {
    document.getElementById('engAxeVal').textContent = `${r.engines.axeCore.violations} rules, ${r.engines.axeCore.elements} elements`;
    document.getElementById('engPa11yVal').textContent = `${r.engines.pa11y.issues} issues`;
    document.getElementById('engLHVal').textContent = r.engines.lighthouse.score !== null ? `${r.engines.lighthouse.score}/100, ${r.engines.lighthouse.failures} failures` : 'N/A';
    document.getElementById('engCustomVal').textContent = `${r.engines.custom.violations} violations, ${r.engines.custom.incomplete} review`;
  }

  // Charts
  drawImpactChart(r.byImpact);
  drawLevelChart(r.byLevel);

  // Rules
  renderRules();

  resultsContainer.classList.remove('hidden');
}

function renderRules() {
  if (!currentResults) return;
  rulesList.innerHTML = '';

  let data;
  if (activeTab === 'violations') data = currentResults.violations;
  else if (activeTab === 'incomplete') data = currentResults.incomplete;
  else if (activeTab === 'passes') data = currentResults.passes;
  else data = [];

  if (!data || data.length === 0) {
    rulesList.innerHTML = `<div class="empty-state">No ${activeTab} found.</div>`;
    return;
  }

  const impactOrder = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  const sorted = [...data].sort((a, b) => (impactOrder[a.impact] || 4) - (impactOrder[b.impact] || 4));

  sorted.forEach(rule => {
    const item = document.createElement('div');
    item.className = 'rule-item';
    const impact = rule.impact || 'info';
    const tags = (rule.tags || []).filter(t => t.startsWith('wcag') || t === 'best-practice');
    const nodeCount = rule.nodes ? rule.nodes.length : 0;

    item.innerHTML = `
      <div class="rule-header">
        <span class="impact-badge impact-${impact}">${esc(impact)}</span>
        <span class="rule-desc">${esc(rule.description || rule.id)}</span>
        ${nodeCount > 0 ? `<span class="rule-count">${nodeCount}</span>` : ''}
        ${tags.map(t => `<span class="wcag-tag">${esc(fmtTag(t))}</span>`).join('')}
        ${rule.source ? `<span class="wcag-tag source-tag">${esc(rule.source)}</span>` : ''}
      </div>
      ${rule.nodes && rule.nodes.length > 0 ? `
      <div class="rule-nodes">
        ${rule.nodes.map(n => `
        <div class="node-card">
          <div class="node-selector">${esc(n.selector)}</div>
          <div class="node-html">${esc(n.html)}</div>
          ${n.message ? `<div class="node-msg">${esc(n.message)}</div>` : ''}
        </div>`).join('')}
      </div>` : ''}
    `;

    item.querySelector('.rule-header').addEventListener('click', () => item.classList.toggle('expanded'));
    rulesList.appendChild(item);
  });
}

// --- Score Gauge (Canvas) ---
function drawScoreGauge(score) {
  const canvas = document.getElementById('scoreGauge');
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const cx = w / 2, cy = h / 2, r = 60;
  const lineWidth = 10;

  ctx.clearRect(0, 0, w, h);

  // Background arc
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 2.25);
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Score arc
  const pct = score / 100;
  const endAngle = Math.PI * 0.75 + (Math.PI * 1.5 * pct);
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI * 0.75, endAngle);
  ctx.strokeStyle = scoreColor(score);
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.stroke();
}

function scoreColor(score) {
  if (score >= 90) return '#16a34a';
  if (score >= 70) return '#d97706';
  return '#dc2626';
}

// --- Impact Donut Chart ---
function drawImpactChart(byImpact) {
  const canvas = document.getElementById('impactChart');
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const data = [
    { label: 'Critical', value: byImpact.critical || 0, color: '#dc2626' },
    { label: 'Serious', value: byImpact.serious || 0, color: '#ea580c' },
    { label: 'Moderate', value: byImpact.moderate || 0, color: '#d97706' },
    { label: 'Minor', value: byImpact.minor || 0, color: '#16a34a' },
  ];

  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No violations', w / 2, h / 2);
    return;
  }

  const cx = 100, cy = 95, r = 70, inner = 40;
  let startAngle = -Math.PI / 2;

  data.forEach(d => {
    if (d.value === 0) return;
    const sliceAngle = (d.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, startAngle + sliceAngle);
    ctx.arc(cx, cy, inner, startAngle + sliceAngle, startAngle, true);
    ctx.closePath();
    ctx.fillStyle = d.color;
    ctx.fill();
    startAngle += sliceAngle;
  });

  // Legend
  let ly = 20;
  data.forEach(d => {
    ctx.fillStyle = d.color;
    ctx.fillRect(200, ly, 12, 12);
    ctx.fillStyle = '#475569';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${d.label}: ${d.value}`, 218, ly + 10);
    ly += 24;
  });
}

// --- Level Bar Chart ---
function drawLevelChart(byLevel) {
  const canvas = document.getElementById('levelChart');
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const data = [
    { label: 'A', value: byLevel.A || 0, color: '#3b82f6' },
    { label: 'AA', value: byLevel.AA || 0, color: '#8b5cf6' },
    { label: 'AAA', value: byLevel.AAA || 0, color: '#ec4899' },
    { label: 'BP', value: byLevel.BP || 0, color: '#6b7280' },
  ];

  const max = Math.max(...data.map(d => d.value), 1);
  const barW = 40;
  const gap = 24;
  const startX = 40;
  const chartH = 140;
  const baseY = 170;

  // Y axis
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(startX - 5, baseY - chartH);
  ctx.lineTo(startX - 5, baseY);
  ctx.stroke();

  data.forEach((d, i) => {
    const x = startX + i * (barW + gap);
    const barH = (d.value / max) * chartH;

    // Bar
    ctx.fillStyle = d.color;
    ctx.beginPath();
    const radius = 4;
    const y = baseY - barH;
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + barW - radius, y);
    ctx.quadraticCurveTo(x + barW, y, x + barW, y + radius);
    ctx.lineTo(x + barW, baseY);
    ctx.lineTo(x, baseY);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.fill();

    // Value on top
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(d.value, x + barW / 2, y - 6);

    // Label below
    ctx.fillStyle = '#475569';
    ctx.font = '12px sans-serif';
    ctx.fillText(d.label, x + barW / 2, baseY + 16);
  });
}

// --- History ---
function getHistory() {
  try { return JSON.parse(localStorage.getItem('wcag-history') || '[]'); } catch { return []; }
}

function saveHistory(result) {
  const history = getHistory();
  history.unshift({
    url: result.url,
    score: result.score,
    violations: result.summary.violations,
    passed: result.summary.passed,
    timestamp: result.timestamp
  });
  if (history.length > 30) history.length = 30;
  localStorage.setItem('wcag-history', JSON.stringify(history));
}

function toggleHistory() {
  historySidebar.classList.toggle('hidden');
  if (!historySidebar.classList.contains('hidden')) renderHistory();
}

function renderHistory() {
  const history = getHistory();
  historyList.innerHTML = '';

  if (history.length === 0) {
    historyList.innerHTML = '<div class="empty-state">No scan history yet.</div>';
    return;
  }

  // Group by URL for diff
  const byUrl = {};
  history.forEach(h => { if (!byUrl[h.url]) byUrl[h.url] = []; byUrl[h.url].push(h); });

  history.forEach(entry => {
    const el = document.createElement('div');
    el.className = 'history-entry';
    const bg = scoreColor(entry.score);
    const date = new Date(entry.timestamp).toLocaleString();

    // Diff with previous scan of same URL
    const sameUrl = byUrl[entry.url] || [];
    const idx = sameUrl.indexOf(entry) + 1;
    const prev = sameUrl[idx];
    let diff = '';
    if (prev) {
      const d = entry.score - prev.score;
      if (d > 0) diff = `<span class="h-diff up">+${d}</span>`;
      else if (d < 0) diff = `<span class="h-diff down">${d}</span>`;
    }

    el.innerHTML = `
      <div class="h-score" style="background:${bg}">${entry.score}</div>
      <div class="h-info">
        <div class="h-url">${esc(entry.url)}</div>
        <div class="h-meta">${date} | ${entry.violations} violations</div>
      </div>
      ${diff}
    `;

    el.addEventListener('click', () => {
      urlInput.value = entry.url;
      historySidebar.classList.add('hidden');
    });

    historyList.appendChild(el);
  });
}

// --- Export ---
async function exportHtmlReport() {
  if (!currentResults) return;

  const btn = document.getElementById('exportHtmlBtn');
  const originalText = btn.textContent;
  btn.textContent = 'Generating...';
  btn.disabled = true;

  try {
    showToast('Generating HTML report (takes ~30s)...');
    const response = await fetch('/api/report/html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: currentResults.url })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to generate report');
    }

    const blob = await response.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `wcag-report-${ts()}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('HTML report downloaded!');
  } catch (err) {
    showToast('Failed to export HTML: ' + err.message);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

function exportResults(format) {
  if (!currentResults) return;
  let content, filename, mimeType;

  if (format === 'json') {
    content = JSON.stringify(currentResults, null, 2);
    filename = `wcag-report-${ts()}.json`;
    mimeType = 'application/json';
  } else {
    const rows = [['Type', 'Impact', 'Rule', 'Description', 'Tags', 'Selector', 'HTML', 'Fix', 'Help URL']];
    ['violations', 'incomplete'].forEach(type => {
      (currentResults[type] || []).forEach(rule => {
        (rule.nodes || []).forEach(n => {
          rows.push([type, rule.impact || '', rule.id, rule.description || '', (rule.tags || []).join('; '), n.selector, n.html, n.message, rule.helpUrl || '']);
        });
      });
    });
    content = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    filename = `wcag-report-${ts()}.csv`;
    mimeType = 'text/csv';
  }

  const blob = new Blob([content], { type: mimeType });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// --- Helpers ---
function fmtTag(tag) {
  const map = { 'wcag2a': 'A', 'wcag2aa': 'AA', 'wcag2aaa': 'AAA', 'wcag21a': '2.1 A', 'wcag21aa': '2.1 AA', 'wcag21aaa': '2.1 AAA', 'best-practice': 'BP' };
  if (map[tag]) return map[tag];
  const m = tag.match(/^wcag(\d)(\d)(\d+)$/);
  if (m) return `${m[1]}.${m[2]}.${m[3]}`;
  return tag;
}

function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function ts() { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); }

function showErrorBanner(message) {
  // Remove existing banner
  const existing = document.getElementById('errorBanner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'errorBanner';
  banner.style.cssText = `
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-left: 4px solid #dc2626;
    border-radius: 8px;
    padding: 16px 20px;
    margin: 20px 0;
    display: flex;
    align-items: flex-start;
    gap: 12px;
  `;
  banner.innerHTML = `
    <div style="font-size:22px;flex-shrink:0">⚠️</div>
    <div style="flex:1">
      <div style="font-size:14px;font-weight:700;color:#991b1b;margin-bottom:4px">Scan Failed</div>
      <div style="font-size:13px;color:#7f1d1d;line-height:1.5">${esc(message)}</div>
    </div>
    <button onclick="document.getElementById('errorBanner').remove()" style="background:none;border:none;cursor:pointer;font-size:20px;color:#991b1b;padding:0 4px">&times;</button>
  `;

  const resultsContainer = document.getElementById('resultsContainer');
  resultsContainer.parentElement.insertBefore(banner, resultsContainer);
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 4000);
}
