// Panel logic — scan, results, scoring, element picker, history, export

let scanResults = null;
let activeTab = 'violations';

// DOM refs
const scanBtn = document.getElementById('scanBtn');
const pickerBtn = document.getElementById('pickerBtn');
const selectorInput = document.getElementById('selectorInput');
const levelA = document.getElementById('levelA');
const levelAA = document.getElementById('levelAA');
const levelAAA = document.getElementById('levelAAA');
const bestPractices = document.getElementById('bestPractices');
const statusEl = document.getElementById('status');
const summaryEl = document.getElementById('summary');
const scoreBar = document.getElementById('scoreBar');
const scoreCircle = document.getElementById('scoreCircle');
const scoreLabel = document.getElementById('scoreLabel');
const scoreGrade = document.getElementById('scoreGrade');
const tabsEl = document.getElementById('tabs');
const resultsEl = document.getElementById('results');
const detailPanel = document.getElementById('detailPanel');
const detailTitle = document.getElementById('detailTitle');
const detailContent = document.getElementById('detailContent');
const closeDetail = document.getElementById('closeDetail');
const exportJson = document.getElementById('exportJson');
const exportCsv = document.getElementById('exportCsv');
const historyBtn = document.getElementById('historyBtn');
const historyPanel = document.getElementById('historyPanel');
const closeHistory = document.getElementById('closeHistory');
const clearHistory = document.getElementById('clearHistory');
const historyContent = document.getElementById('historyContent');

// Event listeners
scanBtn.addEventListener('click', startScan);
pickerBtn.addEventListener('click', startPicker);
closeDetail.addEventListener('click', hideDetail);
exportJson.addEventListener('click', () => doExport('json'));
exportCsv.addEventListener('click', () => doExport('csv'));
historyBtn.addEventListener('click', showHistory);
closeHistory.addEventListener('click', () => historyPanel.classList.add('hidden'));
clearHistory.addEventListener('click', () => {
  localStorage.removeItem('wcag-scan-history');
  showHistory();
});

tabsEl.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    activeTab = tab.dataset.tab;
    tabsEl.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    renderResults();
  });
});

// --- Element Picker ---
function startPicker() {
  const tabId = chrome.devtools.inspectedWindow.tabId;
  pickerBtn.textContent = 'Picking...';
  pickerBtn.disabled = true;

  chrome.runtime.sendMessage({
    action: 'startPicker',
    tabId
  }, (response) => {
    if (response && response.selector) {
      selectorInput.value = response.selector;
      showStatus(`Selected: ${response.selector}`, 'success');
    } else if (response && response.error) {
      showStatus(`Picker failed: ${response.error}`, 'error');
    }
    pickerBtn.textContent = 'Pick Element';
    pickerBtn.disabled = false;
  });
}

// --- Scan ---
async function startScan() {
  const levels = [];
  if (levelA.checked) levels.push('A');
  if (levelAA.checked) levels.push('AA');
  if (levelAAA.checked) levels.push('AAA');

  if (levels.length === 0) {
    showStatus('Select at least one WCAG level', 'error');
    return;
  }

  scanBtn.disabled = true;
  scanBtn.textContent = 'Scanning...';
  showStatus('Injecting axe-core and scanning page...', 'scanning');
  summaryEl.classList.add('hidden');
  scoreBar.classList.add('hidden');
  tabsEl.classList.add('hidden');
  resultsEl.innerHTML = '';

  const tabId = chrome.devtools.inspectedWindow.tabId;

  try {
    // Inject axe-core
    await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'injectAxe', tabId }, (response) => {
        if (response && response.error) reject(new Error(response.error));
        else resolve();
      });
    });

    // Brief delay to ensure axe global is available to the content script
    await new Promise(r => setTimeout(r, 200));

    // Run scan
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'runScan',
        tabId,
        options: {
          levels,
          bestPractices: bestPractices.checked,
          selector: selectorInput.value.trim() || null
        }
      }, (resp) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (resp && resp.error) reject(new Error(resp.error));
        else resolve(resp);
      });
    });

    scanResults = response.results;

    // Calculate and display score
    const score = calculateScore(scanResults);
    updateScore(score);
    updateSummary();
    renderResults();

    // Save to history
    saveToHistory(score, scanResults);

    showStatus(`Scan complete. Score: ${score}/100. Found ${scanResults.violations.length} violation rules.`, 'success');

    exportJson.disabled = false;
    exportCsv.disabled = false;
  } catch (err) {
    showStatus(`Scan failed: ${err.message}`, 'error');
    scanResults = null;
  } finally {
    scanBtn.disabled = false;
    scanBtn.textContent = 'Scan Full Page';
  }
}

// --- Scoring ---
function calculateScore(results) {
  const totalRules = results.violations.length + results.passes.length + results.incomplete.length;
  if (totalRules === 0) return 100;

  const impactWeights = { critical: 10, serious: 5, moderate: 3, minor: 1 };
  let penalty = 0;

  results.violations.forEach(rule => {
    const weight = impactWeights[rule.impact] || 1;
    const nodeCount = rule.nodes ? rule.nodes.length : 1;
    penalty += weight * Math.min(nodeCount, 10);
  });

  const maxPenalty = totalRules * 5;
  const rawScore = Math.max(0, 100 - (penalty / Math.max(maxPenalty, 1)) * 100);
  return Math.round(rawScore);
}

function updateScore(score) {
  scoreCircle.textContent = score;
  scoreCircle.style.background = score >= 90 ? '#16a34a' : score >= 70 ? '#d97706' : '#dc2626';
  scoreLabel.textContent = `Accessibility Score: ${score}/100`;
  const grade = score >= 90 ? 'A — Excellent' : score >= 80 ? 'B — Good' : score >= 70 ? 'C — Needs Improvement' : score >= 50 ? 'D — Poor' : 'F — Critical Issues';
  scoreGrade.textContent = `Grade: ${grade}`;
  scoreBar.classList.remove('hidden');
}

// --- History ---
function getHistory() {
  try {
    return JSON.parse(localStorage.getItem('wcag-scan-history') || '[]');
  } catch { return []; }
}

function saveToHistory(score, results) {
  const history = getHistory();

  // Get current page URL
  chrome.devtools.inspectedWindow.eval('window.location.href', (url) => {
    const entry = {
      url: url || 'Unknown',
      score,
      violations: countNodes(results.violations),
      rules: results.violations.length,
      passed: results.passes.length,
      timestamp: new Date().toISOString()
    };

    history.unshift(entry);

    // Keep last 50 entries
    if (history.length > 50) history.length = 50;
    localStorage.setItem('wcag-scan-history', JSON.stringify(history));
  });
}

function showHistory() {
  const history = getHistory();
  historyContent.innerHTML = '';

  if (history.length === 0) {
    historyContent.innerHTML = '<div style="text-align:center;padding:40px 20px;color:#9ca3af">No scan history yet.</div>';
    historyPanel.classList.remove('hidden');
    return;
  }

  // Group by URL to show diffs
  const byUrl = {};
  history.forEach(h => {
    if (!byUrl[h.url]) byUrl[h.url] = [];
    byUrl[h.url].push(h);
  });

  history.forEach((entry, i) => {
    const item = document.createElement('div');
    item.className = 'history-item';

    const bg = entry.score >= 90 ? '#16a34a' : entry.score >= 70 ? '#d97706' : '#dc2626';
    const date = new Date(entry.timestamp).toLocaleString();

    // Compare with previous scan of same URL
    const sameUrl = byUrl[entry.url] || [];
    const prevIndex = sameUrl.indexOf(entry) + 1;
    const prev = sameUrl[prevIndex];
    let diffHtml = '';
    if (prev) {
      const diff = entry.score - prev.score;
      if (diff > 0) diffHtml = `<span class="history-diff improved">+${diff}</span>`;
      else if (diff < 0) diffHtml = `<span class="history-diff regressed">${diff}</span>`;
      else diffHtml = `<span class="history-diff same">=</span>`;
    }

    item.innerHTML = `
      <div class="history-score" style="background:${bg}">${entry.score}</div>
      <div class="history-info">
        <div class="history-url">${escapeHtml(entry.url)}</div>
        <div class="history-meta">${date} | ${entry.violations} violations | ${entry.passed} passed</div>
      </div>
      ${diffHtml}
    `;

    historyContent.appendChild(item);
  });

  historyPanel.classList.remove('hidden');
}

// --- Status & Summary ---
function showStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = `status ${type}`;
  statusEl.classList.remove('hidden');
}

function updateSummary() {
  if (!scanResults) return;
  document.getElementById('violationCount').textContent = countNodes(scanResults.violations);
  document.getElementById('incompleteCount').textContent = countNodes(scanResults.incomplete);
  document.getElementById('passCount').textContent = scanResults.passes.length;
  document.getElementById('inapplicableCount').textContent = scanResults.inapplicable.length;
  summaryEl.classList.remove('hidden');
  tabsEl.classList.remove('hidden');
}

function countNodes(rules) {
  return rules.reduce((sum, rule) => sum + (rule.nodes ? rule.nodes.length : 0), 0);
}

// --- Render Results ---
function renderResults() {
  if (!scanResults) return;

  const data = scanResults[activeTab] || [];
  resultsEl.innerHTML = '';

  if (data.length === 0) {
    resultsEl.innerHTML = `<div class="results-empty">No ${activeTab} found.</div>`;
    return;
  }

  const impactOrder = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  const sorted = [...data].sort((a, b) => (impactOrder[a.impact] || 4) - (impactOrder[b.impact] || 4));

  sorted.forEach(rule => {
    const group = document.createElement('div');
    group.className = 'rule-group';

    const header = document.createElement('div');
    header.className = 'rule-header';
    const impact = rule.impact || 'info';

    header.innerHTML = `
      <span class="impact-badge impact-${impact}">${impact}</span>
      <span class="rule-description">${escapeHtml(rule.description || rule.help || rule.id)}</span>
      ${rule.nodes ? `<span class="rule-count">${rule.nodes.length}</span>` : ''}
      <span class="wcag-tags">${renderTags(rule.tags)}</span>
    `;

    header.addEventListener('click', () => {
      const nodes = group.querySelector('.rule-nodes');
      if (nodes) nodes.classList.toggle('expanded');
    });

    group.appendChild(header);

    if (rule.nodes && rule.nodes.length > 0) {
      const nodesEl = document.createElement('div');
      nodesEl.className = 'rule-nodes';

      rule.nodes.forEach(node => {
        const item = document.createElement('div');
        item.className = 'node-item';
        const selector = node.target ? node.target.join(' > ') : '';
        const html = node.html || '';
        const message = node.failureSummary || node.message || '';

        item.innerHTML = `
          <div class="node-selector">${escapeHtml(selector)}</div>
          <div class="node-html">${escapeHtml(html)}</div>
          ${message ? `<div class="node-message">${escapeHtml(message)}</div>` : ''}
          <div class="node-actions">
            <button class="btn btn-sm highlight-btn">Highlight</button>
            <button class="btn btn-sm detail-btn">Details</button>
          </div>
        `;

        item.querySelector('.highlight-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          const tabId = chrome.devtools.inspectedWindow.tabId;
          chrome.runtime.sendMessage({ action: 'highlight', tabId, selector });
        });

        item.querySelector('.detail-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          showDetail(rule, node);
        });

        nodesEl.appendChild(item);
      });

      group.appendChild(nodesEl);
    }

    resultsEl.appendChild(group);
  });
}

function renderTags(tags) {
  if (!tags) return '';
  return tags
    .filter(t => t.startsWith('wcag') || t === 'best-practice')
    .map(tag => `<span class="wcag-tag">${formatTag(tag)}</span>`)
    .join('');
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

// --- Detail Panel ---
function showDetail(rule, node) {
  detailTitle.textContent = rule.help || rule.description || rule.id;
  const selector = node.target ? node.target.join(' > ') : '';

  detailContent.innerHTML = `
    <div class="detail-section">
      <h4>Impact</h4>
      <p><span class="impact-badge impact-${rule.impact || 'info'}">${rule.impact || 'info'}</span></p>
    </div>
    <div class="detail-section">
      <h4>Description</h4>
      <p>${escapeHtml(rule.description || 'No description available.')}</p>
    </div>
    <div class="detail-section">
      <h4>How to Fix</h4>
      <p>${escapeHtml(node.failureSummary || 'No fix suggestion available.')}</p>
    </div>
    <div class="detail-section">
      <h4>Element</h4>
      <div class="detail-code">${escapeHtml(node.html || 'N/A')}</div>
    </div>
    <div class="detail-section">
      <h4>CSS Selector</h4>
      <div class="detail-code">${escapeHtml(selector)}</div>
    </div>
    <div class="detail-section">
      <h4>WCAG Criteria</h4>
      <p>${renderTags(rule.tags)}</p>
    </div>
    <div class="detail-section">
      <h4>Rule ID</h4>
      <p><code>${escapeHtml(rule.id)}</code></p>
    </div>
    ${rule.helpUrl ? `
    <div class="detail-section">
      <h4>Learn More</h4>
      <p><a href="${escapeHtml(rule.helpUrl)}" target="_blank">${escapeHtml(rule.helpUrl)}</a></p>
    </div>` : ''}
  `;

  detailPanel.classList.remove('hidden');
  const tabId = chrome.devtools.inspectedWindow.tabId;
  chrome.runtime.sendMessage({ action: 'highlight', tabId, selector });
}

function hideDetail() {
  detailPanel.classList.add('hidden');
  const tabId = chrome.devtools.inspectedWindow.tabId;
  chrome.runtime.sendMessage({ action: 'clearHighlight', tabId });
}

// --- Export ---
function doExport(format) {
  if (!scanResults) return;

  let content, filename, mimeType;

  if (format === 'json') {
    content = JSON.stringify(scanResults, null, 2);
    filename = `wcag-report-${timestamp()}.json`;
    mimeType = 'application/json';
  } else {
    content = generateCsv(scanResults);
    filename = `wcag-report-${timestamp()}.csv`;
    mimeType = 'text/csv';
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function generateCsv(results) {
  const rows = [['Type', 'Impact', 'Rule ID', 'Description', 'WCAG Tags', 'Element Selector', 'HTML', 'How to Fix', 'Help URL']];

  ['violations', 'incomplete'].forEach(type => {
    (results[type] || []).forEach(rule => {
      (rule.nodes || []).forEach(node => {
        rows.push([
          type,
          rule.impact || '',
          rule.id,
          rule.description || '',
          (rule.tags || []).join('; '),
          node.target ? node.target.join(' > ') : '',
          node.html || '',
          node.failureSummary || '',
          rule.helpUrl || ''
        ]);
      });
    });
  });

  return rows.map(row =>
    row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  ).join('\n');
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
