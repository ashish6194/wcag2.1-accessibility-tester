#!/usr/bin/env node

const puppeteer = require('puppeteer');
const { AxePuppeteer } = require('@axe-core/puppeteer');
const pa11y = require('pa11y');
const { generateReport } = require('./report');

const url = process.argv[2];

if (!url) {
  console.error('Usage: node test.js <url>');
  console.error('Example: node test.js https://example.com');
  process.exit(1);
}

async function run() {
  console.log(`\nWCAG 2.1 Accessibility Tester`);
  console.log(`Testing: ${url}`);
  console.log(`Levels: A + AA + AAA\n`);

  let browser;

  try {
    // Launch browser
    console.log('Launching browser...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    console.log('Loading page...');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Run axe-core
    console.log('Running axe-core scan (A + AA + AAA + best practices)...');
    const axeResults = await new AxePuppeteer(page)
      .withTags([
        'wcag2a', 'wcag2aa', 'wcag2aaa',
        'wcag21a', 'wcag21aa', 'wcag21aaa',
        'best-practice'
      ])
      .analyze();

    console.log(`  axe-core: ${axeResults.violations.length} violation rules, ${countNodes(axeResults.violations)} elements`);

    // Run pa11y
    console.log('Running pa11y scan (WCAG2AAA)...');
    let pa11yResults;
    try {
      pa11yResults = await pa11y(url, {
        standard: 'WCAG2AAA',
        runners: ['htmlcs'],
        timeout: 60000,
        chromeLaunchConfig: {
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
      });
      console.log(`  pa11y: ${pa11yResults.issues.length} issues`);
    } catch (err) {
      console.warn(`  pa11y scan failed: ${err.message}`);
      pa11yResults = { issues: [] };
    }

    // Merge results
    console.log('\nMerging results...');
    const merged = mergeResults(axeResults, pa11yResults);

    // Generate report
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `wcag-report-${timestamp}.html`;
    const filepath = require('path').join(process.cwd(), filename);

    generateReport({
      url,
      timestamp: new Date().toISOString(),
      axeResults,
      pa11yResults: pa11yResults.issues,
      merged,
      filepath
    });

    console.log(`\nReport generated: ${filename}`);
    console.log(`\nSummary:`);
    console.log(`  Violations:   ${merged.violations.length} rules (${countNodes(merged.violations)} elements)`);
    console.log(`  Needs Review: ${merged.incomplete.length} rules`);
    console.log(`  Passed:       ${merged.passes.length} rules`);

    // Try to open in browser
    try {
      const { exec } = require('child_process');
      const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      exec(`${openCmd} "${filepath}"`);
    } catch (_) { /* ignore */ }

  } catch (err) {
    console.error(`\nError: ${err.message}`);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
}

function countNodes(rules) {
  return rules.reduce((sum, r) => sum + (r.nodes ? r.nodes.length : 0), 0);
}

function mergeResults(axeResults, pa11yResults) {
  // Start with axe results as the base
  const merged = {
    violations: [...axeResults.violations],
    incomplete: [...axeResults.incomplete],
    passes: [...axeResults.passes],
    inapplicable: [...axeResults.inapplicable]
  };

  // Add pa11y issues that aren't already covered by axe
  const axeSelectors = new Set();
  axeResults.violations.forEach(rule => {
    rule.nodes.forEach(node => {
      if (node.target) {
        axeSelectors.add(node.target.join(' > '));
      }
    });
  });

  // Group pa11y issues by code (rule)
  const pa11yGrouped = {};
  (pa11yResults.issues || []).forEach(issue => {
    const key = issue.code || 'unknown';
    if (!pa11yGrouped[key]) {
      pa11yGrouped[key] = {
        id: `pa11y-${key}`,
        impact: mapPa11yType(issue.type),
        description: issue.message || '',
        help: issue.message || '',
        helpUrl: '',
        tags: extractPa11yTags(issue.code),
        nodes: [],
        source: 'pa11y'
      };
    }

    const selector = issue.selector || '';
    // Only add if not already found by axe
    if (!axeSelectors.has(selector)) {
      pa11yGrouped[key].nodes.push({
        target: [selector],
        html: issue.context || '',
        failureSummary: issue.message || '',
        source: 'pa11y'
      });
    }
  });

  // Add non-empty pa11y groups to violations
  Object.values(pa11yGrouped).forEach(group => {
    if (group.nodes.length > 0) {
      merged.violations.push(group);
    }
  });

  return merged;
}

function mapPa11yType(type) {
  const map = { error: 'serious', warning: 'moderate', notice: 'minor' };
  return map[type] || 'minor';
}

function extractPa11yTags(code) {
  if (!code) return [];
  // pa11y codes look like: WCAG2AAA.Principle1.Guideline1_1.1_1_1.H37
  const tags = [];

  // Match the standard prefix exactly
  if (/^WCAG2AAA\./.test(code)) tags.push('wcag2aaa');
  else if (/^WCAG2AA\./.test(code)) tags.push('wcag2aa');
  else if (/^WCAG2A\./.test(code)) tags.push('wcag2a');

  // Extract criterion number (the second occurrence like 1_1_1 after Guideline)
  const match = code.match(/\.(\d+)_(\d+)_(\d+)\./);
  if (match) tags.push(`wcag${match[1]}${match[2]}${match[3]}`);

  return tags;
}

run();
