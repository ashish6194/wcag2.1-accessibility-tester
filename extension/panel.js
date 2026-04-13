// Panel logic — scan triggers, results rendering, filtering, export

let scanResults = null;
let activeTab = 'violations';

// DOM refs
const scanBtn = document.getElementById('scanBtn');
const selectorInput = document.getElementById('selectorInput');
const levelA = document.getElementById('levelA');
const levelAA = document.getElementById('levelAA');
const levelAAA = document.getElementById('levelAAA');
const bestPractices = document.getElementById('bestPractices');
const statusEl = document.getElementById('status');
const summaryEl = document.getElementById('summary');
const tabsEl = document.getElementById('tabs');
const resultsEl = document.getElementById('results');
const detailPanel = document.getElementById('detailPanel');
const detailTitle = document.getElementById('detailTitle');
const detailContent = document.getElementById('detailContent');
const closeDetail = document.getElementById('closeDetail');
const exportJson = document.getElementById('exportJson');
const exportCsv = document.getElementById('exportCsv');

// Event listeners
scanBtn.addEventListener('click', startScan);
closeDetail.addEventListener('click', hideDetail);
exportJson.addEventListener('click', () => doExport('json'));
exportCsv.addEventListener('click', () => doExport('csv'));

tabsEl.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    activeTab = tab.dataset.tab;
    tabsEl.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    renderResults();
  });
});

// Scan
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
  tabsEl.classList.add('hidden');
  resultsEl.innerHTML = '';

  const tabId = chrome.devtools.inspectedWindow.tabId;

  try {
    // Inject axe-core into the page's isolated world
    await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'injectAxe', tabId }, (response) => {
        if (response && response.error) reject(new Error(response.error));
        else resolve();
      });
    });

    // Brief delay to ensure axe global is available to the content script
    await new Promise(r => setTimeout(r, 200));

    // Then run the scan
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
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (resp && resp.error) {
          reject(new Error(resp.error));
        } else {
          resolve(resp);
        }
      });
    });

    scanResults = response.results;
    showStatus(`Scan complete. Found ${scanResults.violations.length} violation rules.`, 'success');
    updateSummary();
    renderResults();

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

// Render results for the active tab
function renderResults() {
  if (!scanResults) return;

  const data = scanResults[activeTab] || [];
  resultsEl.innerHTML = '';

  if (data.length === 0) {
    resultsEl.innerHTML = `<div class="results-empty">No ${activeTab} found.</div>`;
    return;
  }

  // Sort by impact severity
  const impactOrder = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  const sorted = [...data].sort((a, b) => {
    return (impactOrder[a.impact] || 4) - (impactOrder[b.impact] || 4);
  });

  sorted.forEach(rule => {
    const group = document.createElement('div');
    group.className = 'rule-group';

    // Header
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

    // Nodes (affected elements)
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

        // Highlight button
        item.querySelector('.highlight-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          const tabId = chrome.devtools.inspectedWindow.tabId;
          chrome.runtime.sendMessage({ action: 'highlight', tabId, selector });
        });

        // Detail button
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
  const wcagTags = tags.filter(t =>
    t.startsWith('wcag') || t === 'best-practice'
  );
  // Show human-readable WCAG tags
  return wcagTags.map(tag => {
    const label = formatTag(tag);
    return `<span class="wcag-tag">${label}</span>`;
  }).join('');
}

function formatTag(tag) {
  const map = {
    'wcag2a': 'A',
    'wcag2aa': 'AA',
    'wcag2aaa': 'AAA',
    'wcag21a': '2.1 A',
    'wcag21aa': '2.1 AA',
    'wcag21aaa': '2.1 AAA',
    'best-practice': 'BP'
  };
  if (map[tag]) return map[tag];
  // Handle tags like wcag111 → 1.1.1
  const match = tag.match(/^wcag(\d)(\d)(\d+)$/);
  if (match) return `${match[1]}.${match[2]}.${match[3]}`;
  return tag;
}

// Detail panel
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

  // Highlight the element on the page
  const tabId = chrome.devtools.inspectedWindow.tabId;
  chrome.runtime.sendMessage({ action: 'highlight', tabId, selector });
}

function hideDetail() {
  detailPanel.classList.add('hidden');
  const tabId = chrome.devtools.inspectedWindow.tabId;
  chrome.runtime.sendMessage({ action: 'clearHighlight', tabId });
}

// Export
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
