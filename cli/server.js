#!/usr/bin/env node

const express = require('express');
const path = require('path');
const puppeteer = require('puppeteer');
const { scanPage, calculateScore, countNodes, scoreGrade } = require('./scanner');
const CRITERIA = require('./wcag-criteria');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Shared browser instance
let browser = null;

async function getBrowser() {
  if (!browser || !browser.connected) {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }
  return browser;
}

// --- API Routes ---

// GET /api/criteria — WCAG criteria list
app.get('/api/criteria', (req, res) => {
  res.json(CRITERIA);
});

// POST /api/scan — run accessibility scan
app.post('/api/scan', async (req, res) => {
  const { url, levels, bestPractices } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const b = await getBrowser();
    const result = await scanPage(b, url, {
      log: () => {},
      levels: levels || ['A', 'AA', 'AAA'],
      bestPractices: bestPractices !== false
    });

    // Build summary
    const levelAAATags = ['wcag2aaa', 'wcag21aaa'];
    const levelAATags = ['wcag2aa', 'wcag21aa'];
    const levelATags = ['wcag2a', 'wcag21a'];
    const byLevel = { A: 0, AA: 0, AAA: 0, BP: 0 };
    const byImpact = { critical: 0, serious: 0, moderate: 0, minor: 0 };

    result.merged.violations.forEach(rule => {
      const tags = rule.tags || [];
      if (tags.some(t => levelAAATags.includes(t))) byLevel.AAA++;
      else if (tags.some(t => levelAATags.includes(t))) byLevel.AA++;
      else if (tags.some(t => levelATags.includes(t))) byLevel.A++;
      if (tags.includes('best-practice')) byLevel.BP++;

      const impact = rule.impact || 'minor';
      byImpact[impact] = (byImpact[impact] || 0) + countNodes([rule]);
    });

    res.json({
      url: result.url,
      pageTitle: result.pageTitle,
      score: result.score,
      grade: scoreGrade(result.score),
      engines: result.engines,
      summary: {
        violations: countNodes(result.merged.violations),
        violationRules: result.merged.violations.length,
        incomplete: result.merged.incomplete.length,
        passed: result.merged.passes.length,
        inapplicable: result.merged.inapplicable.length
      },
      byLevel,
      byImpact,
      violations: result.merged.violations.map(simplifyRule),
      incomplete: result.merged.incomplete.map(simplifyRule),
      passes: result.merged.passes.map(r => ({ id: r.id, description: r.description || r.help, tags: r.tags })),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/scan/stream — SSE for real-time scan progress
app.get('/api/scan/stream', async (req, res) => {
  const url = req.query.url;
  const levels = req.query.levels ? req.query.levels.split(',') : ['A', 'AA', 'AAA'];
  const bestPractices = req.query.bestPractices !== 'false';
  if (!url) {
    return res.status(400).json({ error: 'URL query param required' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    send('status', { message: 'Launching browser...' });
    const b = await getBrowser();

    send('status', { message: 'Loading page...' });

    const result = await scanPage(b, url, {
      log: (msg) => send('status', { message: msg }),
      levels,
      bestPractices
    });

    // Build summary (same as POST handler)
    const levelAAATags = ['wcag2aaa', 'wcag21aaa'];
    const levelAATags = ['wcag2aa', 'wcag21aa'];
    const levelATags = ['wcag2a', 'wcag21a'];
    const byLevel = { A: 0, AA: 0, AAA: 0, BP: 0 };
    const byImpact = { critical: 0, serious: 0, moderate: 0, minor: 0 };

    result.merged.violations.forEach(rule => {
      const tags = rule.tags || [];
      if (tags.some(t => levelAAATags.includes(t))) byLevel.AAA++;
      else if (tags.some(t => levelAATags.includes(t))) byLevel.AA++;
      else if (tags.some(t => levelATags.includes(t))) byLevel.A++;
      if (tags.includes('best-practice')) byLevel.BP++;
      const impact = rule.impact || 'minor';
      byImpact[impact] = (byImpact[impact] || 0) + countNodes([rule]);
    });

    send('result', {
      url: result.url,
      pageTitle: result.pageTitle,
      score: result.score,
      grade: scoreGrade(result.score),
      engines: result.engines,
      summary: {
        violations: countNodes(result.merged.violations),
        violationRules: result.merged.violations.length,
        incomplete: result.merged.incomplete.length,
        passed: result.merged.passes.length,
        inapplicable: result.merged.inapplicable.length
      },
      byLevel,
      byImpact,
      violations: result.merged.violations.map(simplifyRule),
      incomplete: result.merged.incomplete.map(simplifyRule),
      passes: result.merged.passes.map(r => ({ id: r.id, description: r.description || r.help, tags: r.tags })),
      timestamp: new Date().toISOString()
    });

    send('done', {});
  } catch (err) {
    send('error', { message: err.message });
  }

  res.end();
});

// POST /api/report/html — generate HTML report from scan results
app.post('/api/report/html', async (req, res) => {
  const { url, levels, bestPractices } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    const b = await getBrowser();
    const result = await scanPage(b, url, { 
      log: () => {},
      levels: levels || ['A', 'AA', 'AAA'],
      bestPractices: bestPractices !== false
    });

    const { generateReport } = require('./report');
    const os = require('os');
    const path = require('path');
    const fs = require('fs');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const tmpPath = path.join(os.tmpdir(), `wcag-report-${timestamp}.html`);

    generateReport({
      url: result.url,
      timestamp: new Date().toISOString(),
      axeResults: result.axeResults,
      pa11yResults: result.pa11yResults,
      merged: result.merged,
      filepath: tmpPath,
      score: result.score
    });

    const html = fs.readFileSync(tmpPath, 'utf-8');
    fs.unlinkSync(tmpPath);

    let slug = '';
    if (result.pageTitle) {
      slug = '-' + result.pageTitle.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
    }
    
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="wcag-report${slug}-${timestamp}.html"`);
    res.send(html);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function simplifyRule(rule) {
  return {
    id: rule.id,
    impact: rule.impact,
    description: rule.description || rule.help,
    help: rule.help,
    helpUrl: rule.helpUrl,
    tags: rule.tags,
    source: rule.source || 'axe-core',
    nodes: (rule.nodes || []).map(n => ({
      selector: n.target ? n.target.join(' > ') : '',
      html: n.html || '',
      message: n.failureSummary || ''
    }))
  };
}

// Start server
app.listen(PORT, () => {
  console.log(`\n  WCAG 2.1 Accessibility Tester Dashboard`);
  console.log(`  ────────────────────────────────────────`);
  console.log(`  Running at: http://localhost:${PORT}\n`);

  // Try to open browser
  try {
    const { exec } = require('child_process');
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    exec(`${cmd} http://localhost:${PORT}`);
  } catch (_) {}
});

// Cleanup on exit
process.on('SIGINT', async () => {
  if (browser) await browser.close();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  if (browser) await browser.close();
  process.exit(0);
});
