#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { generateReport } = require('./report');
const { scanPage, calculateScore, scoreGrade, countNodes, mergeResults, extractPa11yTags, mapPa11yType } = require('./scanner');

// --- CLI Argument Parsing ---
const args = process.argv.slice(2);
const flags = {
  ci: args.includes('--ci'),
  json: args.includes('--json'),
  junit: args.includes('--junit'),
  noOpen: args.includes('--no-open'),
  threshold: null,
  output: null,
};

// Parse --threshold=N
const thresholdArg = args.find(a => a.startsWith('--threshold='));
if (thresholdArg) flags.threshold = parseInt(thresholdArg.split('=')[1], 10);

// Parse --output=path
const outputArg = args.find(a => a.startsWith('--output='));
if (outputArg) flags.output = outputArg.split('=')[1];

// Collect URLs (non-flag arguments)
let urls = args.filter(a => !a.startsWith('--'));

// Check if first arg is a file containing URLs
if (urls.length === 1 && (urls[0].endsWith('.txt') || urls[0].endsWith('.csv'))) {
  const filePath = path.resolve(urls[0]);
  if (fs.existsSync(filePath)) {
    urls = fs.readFileSync(filePath, 'utf-8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));
    console.log(`Loaded ${urls.length} URLs from ${path.basename(filePath)}`);
  }
}

if (urls.length === 0) {
  console.log(`
WCAG 2.1 Accessibility Tester
==============================

Usage:
  node test.js <url>                        Test a single page
  node test.js <url1> <url2> ...            Test multiple pages
  node test.js urls.txt                     Test URLs from a file (one per line)

Options:
  --ci                  CI/CD mode: exit code 1 if violations found
  --json                Output results as JSON (to stdout or --output file)
  --junit               Output results as JUnit XML for CI systems
  --threshold=N         Fail only if score is below N (0-100), use with --ci
  --output=<path>       Write report to a specific file path
  --no-open             Don't auto-open the HTML report in browser

Examples:
  node test.js https://example.com
  node test.js https://example.com --ci --threshold=80
  node test.js https://example.com --junit --output=results.xml
  node test.js urls.txt --json --output=results.json
  node test.js https://site.com/page1 https://site.com/page2
`);
  process.exit(1);
}

// --- Main ---
async function run() {
  const isBatch = urls.length > 1;
  console.log(`\nWCAG 2.1 Accessibility Tester`);
  console.log(`Testing: ${isBatch ? `${urls.length} pages` : urls[0]}`);
  console.log(`Levels: A + AA + AAA`);
  if (flags.ci) console.log(`Mode: CI/CD${flags.threshold !== null ? ` (threshold: ${flags.threshold})` : ''}`);
  console.log('');

  let browser;
  const allResults = [];

  try {
    console.log('Launching browser...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const label = isBatch ? `[${i + 1}/${urls.length}] ` : '';
      console.log(`${label}Scanning: ${url}`);

      try {
        const result = await scanPage(browser, url, label);
        allResults.push(result);
      } catch (err) {
        console.error(`${label}  Failed: ${err.message}`);
        allResults.push({
          url,
          error: err.message,
          merged: { violations: [], incomplete: [], passes: [], inapplicable: [] },
          axeResults: { violations: [], incomplete: [], passes: [], inapplicable: [] },
          pa11yResults: [],
          score: 0
        });
      }
    }

    // Calculate scores
    allResults.forEach(r => {
      if (!r.error) {
        r.score = calculateScore(r.merged);
      }
    });

    // Output
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    if (flags.json) {
      const jsonOutput = formatJsonOutput(allResults);
      if (flags.output) {
        fs.writeFileSync(flags.output, JSON.stringify(jsonOutput, null, 2));
        console.log(`\nJSON report: ${flags.output}`);
      } else {
        console.log(JSON.stringify(jsonOutput, null, 2));
      }
    } else if (flags.junit) {
      const xml = formatJunitXml(allResults);
      const outPath = flags.output || `wcag-junit-${timestamp}.xml`;
      fs.writeFileSync(outPath, xml);
      console.log(`\nJUnit XML report: ${outPath}`);
    } else {
      // HTML report (default) — use page title in filename when available
      let defaultFilename = `wcag-report-${timestamp}.html`;
      if (!isBatch && allResults[0] && allResults[0].pageTitle) {
        const slug = sanitizeFilename(allResults[0].pageTitle);
        if (slug) defaultFilename = `wcag-report-${slug}-${timestamp}.html`;
      }
      const outPath = flags.output || defaultFilename;
      const filepath = path.resolve(outPath);

      if (isBatch) {
        generateReport({
          url: `${urls.length} pages`,
          timestamp: new Date().toISOString(),
          axeResults: mergeAllAxeResults(allResults),
          pa11yResults: allResults.flatMap(r => r.pa11yResults || []),
          merged: mergeAllResults(allResults),
          filepath,
          pages: allResults,
          score: averageScore(allResults)
        });
      } else {
        const r = allResults[0];
        generateReport({
          url: r.url,
          pageTitle: r.pageTitle,
          timestamp: new Date().toISOString(),
          axeResults: r.axeResults,
          pa11yResults: r.pa11yResults,
          merged: r.merged,
          filepath,
          score: r.score
        });
      }

      console.log(`\nReport: ${outPath}`);

      if (!flags.noOpen && !flags.ci) {
        try {
          const { exec } = require('child_process');
          const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
          exec(`${cmd} "${filepath}"`);
        } catch (_) {}
      }
    }

    // Summary
    const avgScore = averageScore(allResults);
    const totalViolations = allResults.reduce((s, r) => s + countNodes(r.merged.violations), 0);
    const totalIncomplete = allResults.reduce((s, r) => s + r.merged.incomplete.length, 0);
    const totalPassed = allResults.reduce((s, r) => s + r.merged.passes.length, 0);

    console.log(`\n${'='.repeat(50)}`);
    console.log(`  Score:        ${avgScore}/100 ${cliScoreGrade(avgScore)}`);
    console.log(`  Violations:   ${totalViolations} elements`);
    console.log(`  Needs Review: ${totalIncomplete} rules`);
    console.log(`  Passed:       ${totalPassed} rules`);
    if (isBatch) {
      console.log(`  Pages:        ${allResults.length} (${allResults.filter(r => r.error).length} failed)`);
    }
    console.log(`${'='.repeat(50)}\n`);

    // CI exit code
    if (flags.ci) {
      if (flags.threshold !== null) {
        if (avgScore < flags.threshold) {
          console.log(`FAIL: Score ${avgScore} is below threshold ${flags.threshold}`);
          process.exit(1);
        } else {
          console.log(`PASS: Score ${avgScore} meets threshold ${flags.threshold}`);
          process.exit(0);
        }
      } else if (totalViolations > 0) {
        console.log(`FAIL: ${totalViolations} violations found`);
        process.exit(1);
      } else {
        console.log('PASS: No violations found');
        process.exit(0);
      }
    }

  } catch (err) {
    console.error(`\nFatal error: ${err.message}`);
    process.exit(2);
  } finally {
    if (browser) await browser.close();
  }
}

// --- CLI Score Grade (with terminal colors) ---
function cliScoreGrade(score) {
  const grade = scoreGrade(score);
  if (score >= 70) return `\x1b[32m${grade}\x1b[0m`;  // green
  if (score >= 50) return `\x1b[33m${grade}\x1b[0m`;  // yellow
  return `\x1b[31m${grade}\x1b[0m`;                    // red
}

function averageScore(results) {
  const valid = results.filter(r => !r.error);
  if (valid.length === 0) return 0;
  return Math.round(valid.reduce((s, r) => s + r.score, 0) / valid.length);
}

function mergeAllResults(allResults) {
  return {
    violations: allResults.flatMap(r => r.merged.violations),
    incomplete: allResults.flatMap(r => r.merged.incomplete),
    passes: allResults.flatMap(r => r.merged.passes),
    inapplicable: allResults.flatMap(r => r.merged.inapplicable)
  };
}

function mergeAllAxeResults(allResults) {
  return {
    violations: allResults.flatMap(r => r.axeResults.violations),
    incomplete: allResults.flatMap(r => r.axeResults.incomplete),
    passes: allResults.flatMap(r => r.axeResults.passes),
    inapplicable: allResults.flatMap(r => r.axeResults.inapplicable)
  };
}

// --- JSON Output ---
function formatJsonOutput(results) {
  return {
    tool: 'WCAG 2.1 Accessibility Tester',
    timestamp: new Date().toISOString(),
    summary: {
      pagesScanned: results.length,
      averageScore: averageScore(results),
      totalViolations: results.reduce((s, r) => s + countNodes(r.merged.violations), 0),
      totalNeedsReview: results.reduce((s, r) => s + r.merged.incomplete.length, 0),
      totalPassed: results.reduce((s, r) => s + r.merged.passes.length, 0)
    },
    pages: results.map(r => ({
      url: r.url,
      score: r.score,
      error: r.error || null,
      violations: (r.merged.violations || []).map(rule => ({
        id: rule.id,
        impact: rule.impact,
        description: rule.description || rule.help,
        tags: rule.tags,
        helpUrl: rule.helpUrl,
        elements: (rule.nodes || []).map(n => ({
          selector: n.target ? n.target.join(' > ') : '',
          html: n.html,
          message: n.failureSummary
        }))
      })),
      incomplete: r.merged.incomplete.length,
      passed: r.merged.passes.length
    }))
  };
}

// --- JUnit XML Output ---
function formatJunitXml(results) {
  const totalTests = results.reduce((s, r) => s + r.merged.violations.length + r.merged.passes.length, 0);
  const totalFailures = results.reduce((s, r) => s + r.merged.violations.length, 0);
  const totalErrors = results.filter(r => r.error).length;

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<testsuites name="WCAG 2.1 Accessibility" tests="${totalTests}" failures="${totalFailures}" errors="${totalErrors}" time="0">\n`;

  results.forEach(r => {
    const tests = r.merged.violations.length + r.merged.passes.length;
    const failures = r.merged.violations.length;

    xml += `  <testsuite name="${escXml(r.url)}" tests="${tests}" failures="${failures}" errors="${r.error ? 1 : 0}">\n`;

    if (r.error) {
      xml += `    <testcase name="page-load"><error message="${escXml(r.error)}"/></testcase>\n`;
    }

    // Passed rules as passed test cases
    (r.merged.passes || []).forEach(rule => {
      xml += `    <testcase name="${escXml(rule.id)}: ${escXml(rule.description || rule.help || '')}" classname="wcag.passed"/>\n`;
    });

    // Violations as failed test cases
    (r.merged.violations || []).forEach(rule => {
      const nodeCount = rule.nodes ? rule.nodes.length : 0;
      const firstNode = rule.nodes && rule.nodes[0];
      const message = firstNode ? (firstNode.failureSummary || '') : '';
      xml += `    <testcase name="${escXml(rule.id)}: ${escXml(rule.description || rule.help || '')}" classname="wcag.violations">\n`;
      xml += `      <failure message="${escXml(rule.help || rule.description || '')}" type="${escXml(rule.impact || 'violation')}">\n`;
      xml += `Impact: ${escXml(rule.impact || 'unknown')}\n`;
      xml += `Elements: ${nodeCount}\n`;
      xml += `Tags: ${(rule.tags || []).join(', ')}\n`;
      if (message) xml += `Fix: ${escXml(message)}\n`;
      if (rule.helpUrl) xml += `Help: ${escXml(rule.helpUrl)}\n`;
      xml += `      </failure>\n`;
      xml += `    </testcase>\n`;
    });

    xml += `  </testsuite>\n`;
  });

  xml += `</testsuites>\n`;
  return xml;
}

function sanitizeFilename(title) {
  if (!title) return '';
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')   // remove special chars
    .replace(/\s+/g, '-')            // spaces to dashes
    .replace(/-+/g, '-')             // collapse dashes
    .replace(/^-|-$/g, '')           // trim dashes
    .slice(0, 50);                   // keep it reasonable
}

function escXml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

run();
