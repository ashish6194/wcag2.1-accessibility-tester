// scanner.js — Reusable accessibility scanning engine (3 engines + custom checks)
// Engines: axe-core, pa11y, Lighthouse
// Custom: reading order, touch targets, text spacing, animation detection, focus traps
// Used by both CLI (test.js) and Web Dashboard (server.js)

const { AxePuppeteer } = require('@axe-core/puppeteer');
const pa11y = require('pa11y');

// --- Single Page Scan (3 engines + custom) ---
async function scanPage(browser, url, options = {}) {
  const label = options.label || '';
  const log = options.log || console.log;

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  try {
    log(`${label}Loading page...`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // 1. axe-core
    log(`${label}Running axe-core...`);
    const axeResults = await new AxePuppeteer(page)
      .withTags(['wcag2a', 'wcag2aa', 'wcag2aaa', 'wcag21a', 'wcag21aa', 'wcag21aaa', 'best-practice'])
      .analyze();
    log(`${label}  axe-core: ${axeResults.violations.length} rules, ${countNodes(axeResults.violations)} elements`);

    // 2. pa11y
    log(`${label}Running pa11y...`);
    let pa11yResults;
    try {
      pa11yResults = await pa11y(url, {
        standard: 'WCAG2AAA', runners: ['htmlcs'], timeout: 60000,
        chromeLaunchConfig: { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
      });
      log(`${label}  pa11y: ${pa11yResults.issues.length} issues`);
    } catch (err) {
      log(`${label}  pa11y failed: ${err.message}`);
      pa11yResults = { issues: [] };
    }

    // 3. Lighthouse
    log(`${label}Running Lighthouse...`);
    let lighthouseResults = { score: null, audits: [] };
    try {
      lighthouseResults = await runLighthouse(url, log, label);
      log(`${label}  Lighthouse: score ${lighthouseResults.score}/100, ${lighthouseResults.audits.filter(a => a.score === 0).length} failures`);
    } catch (err) {
      log(`${label}  Lighthouse failed: ${err.message}`);
    }

    // 4. Custom checks (run in page context via Puppeteer)
    log(`${label}Running custom checks...`);
    let customResults = { violations: [], incomplete: [] };
    try {
      customResults = await runCustomChecks(page);
      log(`${label}  Custom: ${customResults.violations.length} violations, ${customResults.incomplete.length} needs review`);
    } catch (err) {
      log(`${label}  Custom checks failed: ${err.message}`);
    }

    // Merge all results
    const merged = mergeAllEngineResults(axeResults, pa11yResults, lighthouseResults, customResults);
    const score = calculateScore(merged);

    return {
      url, axeResults,
      pa11yResults: pa11yResults.issues || [],
      lighthouseResults,
      customResults,
      merged, score,
      engines: {
        axeCore: { violations: axeResults.violations.length, elements: countNodes(axeResults.violations) },
        pa11y: { issues: (pa11yResults.issues || []).length },
        lighthouse: { score: lighthouseResults.score, failures: lighthouseResults.audits.filter(a => a.score === 0).length },
        custom: { violations: customResults.violations.length, incomplete: customResults.incomplete.length }
      }
    };
  } finally {
    await page.close();
  }
}

// --- Lighthouse ---
async function runLighthouse(url, log, label) {
  const lighthouse = (await import('lighthouse')).default;
  const chromeLauncher = await import('chrome-launcher');

  const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless', '--no-sandbox'] });

  try {
    const result = await lighthouse(url, {
      logLevel: 'error',
      output: 'json',
      onlyCategories: ['accessibility'],
      port: chrome.port,
    });

    const lhr = result.lhr;
    const accessibilityScore = Math.round((lhr.categories.accessibility.score || 0) * 100);

    const audits = lhr.categories.accessibility.auditRefs.map(ref => {
      const audit = lhr.audits[ref.id];
      return {
        id: audit.id,
        title: audit.title,
        description: audit.description,
        score: audit.score,
        weight: ref.weight,
        group: ref.group,
        details: audit.details,
        nodes: (audit.details && audit.details.items || []).map(item => {
          const node = item.node || {};
          return {
            selector: node.selector || '',
            html: node.snippet || '',
            explanation: node.explanation || '',
            nodeLabel: node.nodeLabel || ''
          };
        })
      };
    });

    return { score: accessibilityScore, audits };
  } finally {
    await chrome.kill();
  }
}

// --- Custom Accessibility Checks ---
// 30+ checks covering WAVE parity gaps that axe-core/pa11y/Lighthouse miss
async function runCustomChecks(page) {
  const results = await page.evaluate(() => {
    const violations = [];
    const incomplete = [];

    // --- Helpers ---
    function sel(el) {
      if (!el || el === document.body) return 'body';
      if (el.id) return '#' + el.id;
      let parts = [];
      while (el && el !== document.body && el !== document.documentElement) {
        let s = el.tagName.toLowerCase();
        if (el.id) { parts.unshift('#' + el.id); break; }
        if (el.className && typeof el.className === 'string') {
          const c = el.className.trim().split(/\s+/).slice(0, 2).join('.');
          if (c) s += '.' + c;
        }
        parts.unshift(s);
        el = el.parentElement;
      }
      return parts.join(' > ');
    }

    function htm(el) {
      if (!el) return '';
      const h = el.cloneNode(false).outerHTML;
      return h.length > 200 ? h.slice(0, 200) + '...' : h;
    }

    function push(arr, id, impact, desc, tags, el) {
      arr.push({ id, impact, description: desc, tags, selector: sel(el), html: htm(el) });
    }

    // ================================================================
    // GROUP 1: ALT TEXT QUALITY (WAVE's biggest differentiator)
    // ================================================================

    const imgs = document.querySelectorAll('img');
    imgs.forEach(img => {
      const alt = (img.alt || '').trim();
      const src = (img.src || '').toLowerCase();
      const rect = img.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      // 1. Suspicious alt text — contains "image", "photo", "picture", filename patterns
      if (alt && /^(image|photo|picture|graphic|icon|img|untitled|screenshot|dsc|img_|photo_)\b/i.test(alt)) {
        push(violations, 'custom-alt-suspicious', 'serious',
          `Suspicious alt text: "${alt}" — likely not meaningful (WCAG 1.1.1)`,
          ['wcag111', 'wcag2a'], img);
      }

      // 2. Alt text is a filename
      if (alt && /\.(jpg|jpeg|png|gif|svg|webp|bmp|ico)$/i.test(alt)) {
        push(violations, 'custom-alt-filename', 'serious',
          `Alt text appears to be a filename: "${alt}" (WCAG 1.1.1)`,
          ['wcag111', 'wcag2a'], img);
      }

      // 3. Alt text too long (>100 chars)
      if (alt.length > 100) {
        push(incomplete, 'custom-alt-long', 'minor',
          `Alt text is ${alt.length} characters — consider using aria-describedby for long descriptions (WCAG 1.1.1)`,
          ['wcag111', 'wcag2a'], img);
      }

      // 4. Redundant alt — matches adjacent text (strict: only when EXACT match and short)
      const parent = img.parentElement;
      if (parent && alt && alt.length >= 5 && alt.length <= 30) {
        // Get sibling text excluding this image
        const siblingText = Array.from(parent.childNodes)
          .filter(n => n !== img && n.nodeType === Node.TEXT_NODE)
          .map(n => (n.textContent || '').trim())
          .join(' ').trim();
        // Only flag if alt exactly matches a sibling text node (not embedded in larger text)
        if (siblingText && siblingText.toLowerCase() === alt.toLowerCase()) {
          push(incomplete, 'custom-alt-redundant', 'minor',
            `Alt text duplicates adjacent text: "${alt}" — decorative images should use alt="" (WCAG 1.1.1)`,
            ['wcag111', 'wcag2a'], img);
        }
      }

      // 5. Image has title but no alt
      if (!img.hasAttribute('alt') && img.hasAttribute('title')) {
        push(violations, 'custom-image-title-no-alt', 'serious',
          'Image has title attribute but no alt — title is not a substitute for alt (WCAG 1.1.1)',
          ['wcag111', 'wcag2a'], img);
      }

      // 6. Spacer/decorative image without null alt
      if ((rect.width <= 3 || rect.height <= 3) && alt) {
        push(violations, 'custom-spacer-image-alt', 'moderate',
          `Tiny image (${Math.round(rect.width)}x${Math.round(rect.height)}px) has alt text — likely decorative, should use alt="" (WCAG 1.1.1)`,
          ['wcag111', 'wcag2a'], img);
      }

      // 7. Images of text detection
      if (alt.length > 50 && rect.width > 100 && rect.height < 100) {
        push(incomplete, 'custom-image-of-text', 'moderate',
          'Image has long alt text and text-like dimensions — verify it is not an image of text (WCAG 1.4.5)',
          ['wcag145', 'wcag2aa'], img);
      }
    });

    // 8. Duplicate alt text across nearby images
    const altMap = {};
    imgs.forEach(img => {
      const alt = (img.alt || '').trim();
      if (alt && alt.length > 3) { altMap[alt] = (altMap[alt] || 0) + 1; }
    });
    Object.entries(altMap).forEach(([alt, count]) => {
      if (count > 1) {
        push(incomplete, 'custom-alt-duplicate', 'moderate',
          `${count} images share identical alt text: "${alt.slice(0, 50)}" (WCAG 1.1.1)`,
          ['wcag111', 'wcag2a'], document.body);
      }
    });

    // ================================================================
    // GROUP 2: CONTENT STRUCTURE HEURISTICS
    // ================================================================

    // 9. Possible headings — bold/large text not in heading tags
    // Stricter: requires larger font (20px+), bold (700+), isolated element, no link/button context
    document.querySelectorAll('p, div, span').forEach(el => {
      if (el.closest('h1,h2,h3,h4,h5,h6,header,nav,footer,a,button,label')) return;
      // Skip if parent is already a heading-like element
      const parent = el.parentElement;
      if (parent && /^(H[1-6]|HEADER|NAV|BUTTON|A|LABEL)$/.test(parent.tagName)) return;
      const style = window.getComputedStyle(el);
      const fontSize = parseFloat(style.fontSize);
      const fontWeight = parseInt(style.fontWeight);
      const text = (el.textContent || '').trim();
      // Check if this element stands alone visually (no siblings or isolated block)
      const hasSiblingText = parent && Array.from(parent.children).some(c => c !== el && (c.textContent || '').trim().length > 5);
      if (text.length > 3 && text.length < 60 && fontSize >= 20 && fontWeight >= 700 &&
          el.children.length === 0 && !hasSiblingText) {
        push(incomplete, 'custom-heading-possible', 'minor',
          `Text looks like a heading but is not in a heading element: "${text.slice(0, 40)}" (WCAG 1.3.1)`,
          ['wcag131', 'wcag2a'], el);
      }
    });

    // 10. Possible lists — sequential items not in list markup
    document.querySelectorAll('p, div').forEach(el => {
      const text = (el.innerHTML || '');
      const brParts = text.split(/<br\s*\/?>/i);
      if (brParts.length >= 3) {
        const startsWithBullet = brParts.filter(p => /^\s*[•\-\*\d+\.]\s/.test(p.replace(/<[^>]+>/g, '')));
        if (startsWithBullet.length >= 3) {
          push(incomplete, 'custom-list-possible', 'moderate',
            'Content appears to be a list but uses <br> instead of proper list markup (WCAG 1.3.1)',
            ['wcag131', 'wcag2a'], el);
        }
      }
    });

    // 11. Layout tables
    document.querySelectorAll('table').forEach(table => {
      const hasTh = table.querySelector('th');
      const hasCaption = table.querySelector('caption');
      const hasRole = table.getAttribute('role');
      if (!hasTh && !hasCaption && hasRole !== 'presentation' && hasRole !== 'none') {
        const cells = table.querySelectorAll('td');
        if (cells.length > 0 && cells.length <= 20) {
          push(incomplete, 'custom-table-layout', 'moderate',
            'Table has no headers or caption — if used for layout, add role="presentation" (WCAG 1.3.1)',
            ['wcag131', 'wcag2a'], table);
        }
      }
    });

    // 12. Empty table headers
    document.querySelectorAll('th').forEach(th => {
      if (!(th.textContent || '').trim()) {
        push(violations, 'custom-th-empty', 'moderate',
          'Table header cell is empty (WCAG 1.3.1)',
          ['wcag131', 'wcag2a'], th);
      }
    });

    // ================================================================
    // GROUP 3: LINK QUALITY
    // ================================================================

    const links = document.querySelectorAll('a[href]');

    // 13. Suspicious/vague link text
    const vaguePatterns = /^(click here|here|more|read more|learn more|details|link|this|go|continue|info)$/i;
    links.forEach(a => {
      const text = (a.textContent || '').trim();
      if (vaguePatterns.test(text)) {
        push(violations, 'custom-link-suspicious', 'moderate',
          `Vague link text: "${text}" — link purpose should be clear from text alone (WCAG 2.4.4)`,
          ['wcag244', 'wcag2a'], a);
      }
    });

    // 14. Redundant/adjacent links — same href, visually close
    // WAVE-style: catches logo+text pointing to same URL, nav items repeated, etc.
    const linksByHref = {};
    links.forEach(a => {
      const href = a.href;
      if (!href) return;
      if (!linksByHref[href]) linksByHref[href] = [];
      linksByHref[href].push(a);
    });
    Object.entries(linksByHref).forEach(([href, els]) => {
      if (els.length > 1) {
        for (let i = 0; i < els.length - 1; i++) {
          const a = els[i];
          const b = els[i + 1];
          // Check visual adjacency via bounding rects
          const rectA = a.getBoundingClientRect();
          const rectB = b.getBoundingClientRect();
          const vertDist = Math.abs(rectA.top - rectB.top);
          const horizDist = Math.abs(rectA.left - rectB.left);
          // Consider adjacent if within 50px horizontal and 100px vertical (same row/near-row)
          const isVisuallyAdjacent = vertDist < 100 && horizDist < 500;
          // Or structurally close (same parent, or within 2 levels)
          const isStructurallyClose = a.parentElement === b.parentElement ||
            a.parentElement === b.parentElement?.parentElement ||
            a.parentElement?.parentElement === b.parentElement ||
            a.contains(b) || b.contains(a);

          if (isVisuallyAdjacent || isStructurallyClose) {
            const textA = (a.textContent || '').trim();
            const textB = (b.textContent || '').trim();
            push(incomplete, 'custom-link-redundant', 'minor',
              `Multiple links point to same URL (${href.slice(0, 60)}${href.length > 60 ? '...' : ''}) — consider combining "${textA.slice(0, 30)}" and "${textB.slice(0, 30)}" into one link (WCAG 2.4.4)`,
              ['wcag244', 'wcag2a'], a);
            break;
          }
        }
      }
    });

    // 15. Broken internal anchor links
    links.forEach(a => {
      const href = a.getAttribute('href');
      if (href && href.startsWith('#') && href.length > 1) {
        const targetId = href.slice(1);
        if (!document.getElementById(targetId)) {
          push(violations, 'custom-link-internal-broken', 'moderate',
            `In-page link target "${href}" does not exist (WCAG 2.1.1)`,
            ['wcag211', 'wcag2a'], a);
        }
      }
    });

    // 16. Links to documents (non-HTML files)
    const docExtensions = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar)(\?|$)/i;
    links.forEach(a => {
      const href = a.getAttribute('href') || '';
      if (docExtensions.test(href)) {
        const ext = href.match(docExtensions)[1].toUpperCase();
        push(incomplete, 'custom-link-document', 'minor',
          `Link to ${ext} file — ensure the document is accessible or provide an accessible alternative`,
          ['wcag111', 'wcag2a'], a);
      }
    });

    // ================================================================
    // GROUP 4: FORM CHECKS
    // ================================================================

    // 17. Empty labels
    document.querySelectorAll('label').forEach(label => {
      if (!(label.textContent || '').trim() && !label.querySelector('img[alt]')) {
        push(violations, 'custom-label-empty', 'serious',
          'Label element is empty — provides no accessible name (WCAG 1.3.1, 3.3.2)',
          ['wcag131', 'wcag332', 'wcag2a'], label);
      }
    });

    // 18. Orphaned labels — for attribute points to nonexistent ID
    document.querySelectorAll('label[for]').forEach(label => {
      const forId = label.getAttribute('for');
      if (forId && !document.getElementById(forId)) {
        push(violations, 'custom-label-orphaned', 'serious',
          `Label "for" attribute points to nonexistent ID "${forId}" (WCAG 1.3.1, 3.3.2)`,
          ['wcag131', 'wcag332', 'wcag2a'], label);
      }
    });

    // 19. Radio/checkbox groups without fieldset + legend
    const radioGroups = {};
    document.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach(input => {
      const name = input.name;
      if (name) { radioGroups[name] = (radioGroups[name] || []); radioGroups[name].push(input); }
    });
    Object.entries(radioGroups).forEach(([name, inputs]) => {
      if (inputs.length >= 2) {
        const inFieldset = inputs[0].closest('fieldset');
        if (!inFieldset) {
          push(violations, 'custom-fieldset-missing', 'moderate',
            `Radio/checkbox group "${name}" (${inputs.length} items) is not wrapped in a fieldset with legend (WCAG 1.3.1)`,
            ['wcag131', 'wcag2a'], inputs[0]);
        }
      }
    });

    // 20. Form control uses title instead of label
    document.querySelectorAll('input, select, textarea').forEach(input => {
      if (input.type === 'hidden' || input.type === 'submit' || input.type === 'button') return;
      const hasLabel = input.labels && input.labels.length > 0;
      const hasAriaLabel = input.getAttribute('aria-label') || input.getAttribute('aria-labelledby');
      const hasTitle = input.getAttribute('title');
      if (!hasLabel && !hasAriaLabel && hasTitle) {
        push(incomplete, 'custom-label-title-only', 'moderate',
          'Form control uses title attribute instead of a proper label — title is not always exposed to AT (WCAG 1.3.1)',
          ['wcag131', 'wcag2a'], input);
      }
    });

    // 21. Required input without error identification mechanism
    document.querySelectorAll('input[required], select[required], textarea[required]').forEach(input => {
      const hasAriaDescribedBy = input.getAttribute('aria-describedby');
      const hasAriaErrorMessage = input.getAttribute('aria-errormessage');
      if (!hasAriaDescribedBy && !hasAriaErrorMessage) {
        push(incomplete, 'custom-error-identification', 'moderate',
          'Required input has no aria-describedby or aria-errormessage — verify errors are identified in text when invalid (WCAG 3.3.1)',
          ['wcag331', 'wcag2a'], input);
      }
    });

    // ================================================================
    // GROUP 5: INTERACTION / SCRIPTING
    // ================================================================

    // 22. Mouse-only event handlers
    document.querySelectorAll('[onclick]').forEach(el => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'a' || tag === 'button' || tag === 'input' || tag === 'select') return;
      const hasKeyHandler = el.hasAttribute('onkeypress') || el.hasAttribute('onkeydown') || el.hasAttribute('onkeyup');
      const hasRole = el.getAttribute('role');
      const hasTabindex = el.hasAttribute('tabindex');
      if (!hasKeyHandler && !hasRole && !hasTabindex) {
        push(violations, 'custom-mouse-only-handler', 'serious',
          'Element has onclick but no keyboard equivalent — not keyboard accessible (WCAG 2.1.1)',
          ['wcag211', 'wcag2a'], el);
      }
    });

    // 23. JavaScript jump menus (select + onchange navigation)
    document.querySelectorAll('select[onchange]').forEach(select => {
      const handler = (select.getAttribute('onchange') || '').toLowerCase();
      if (handler.includes('location') || handler.includes('navigate') || handler.includes('href') || handler.includes('window')) {
        push(violations, 'custom-js-jumpmenu', 'moderate',
          'Select element with onchange navigation — changes context without explicit user action (WCAG 3.2.2)',
          ['wcag322', 'wcag2a'], select);
      }
    });

    // 24. Positive tabindex values
    document.querySelectorAll('[tabindex]').forEach(el => {
      const val = parseInt(el.getAttribute('tabindex'));
      if (val > 0) {
        push(violations, 'custom-tabindex-positive', 'moderate',
          `Positive tabindex (${val}) disrupts natural focus order (WCAG 2.4.3)`,
          ['wcag243', 'wcag2a'], el);
      }
    });

    // ================================================================
    // GROUP 6: READABILITY & VISUAL
    // ================================================================

    // 25. Very small text — only flag meaningful text, skip icons/badges/legal-y elements
    const smallTextFlagged = new Set();
    document.querySelectorAll('p, li, td, a, label').forEach(el => {
      const text = (el.textContent || '').trim();
      if (text.length < 10) return; // skip tiny labels, icons, counts
      if (el.children.length > 2) return;
      const style = window.getComputedStyle(el);
      const fontSize = parseFloat(style.fontSize);
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return; // hidden
      if (fontSize > 0 && fontSize < 10 && style.display !== 'none' && style.visibility !== 'hidden') {
        // De-duplicate by rounded font-size — only report first occurrence per size
        const key = fontSize.toFixed(0);
        if (smallTextFlagged.has(key)) return;
        smallTextFlagged.add(key);
        push(incomplete, 'custom-text-small', 'minor',
          `Text is ${fontSize.toFixed(1)}px — very small text may be difficult to read (WCAG 1.4.8)`,
          ['wcag148', 'wcag2aaa'], el);
      }
    });

    // 26. Fully justified text
    document.querySelectorAll('p, div, li, td').forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.textAlign === 'justify' && (el.textContent || '').trim().length > 50) {
        push(incomplete, 'custom-text-justified', 'minor',
          'Fully justified text can create uneven spacing and reduce readability (WCAG 1.4.8)',
          ['wcag148', 'wcag2aaa'], el);
      }
    });

    // 27. Underlined text that is not a link (confusing)
    document.querySelectorAll('u, [style*="underline"]').forEach(el => {
      if (el.tagName.toLowerCase() === 'a') return;
      if (el.closest('a')) return;
      const style = window.getComputedStyle(el);
      if (style.textDecoration.includes('underline') && (el.textContent || '').trim()) {
        push(incomplete, 'custom-underline-nonlink', 'minor',
          'Underlined text is not a link — may confuse users who expect underlines to indicate links',
          ['best-practice'], el);
      }
    });

    // 28. Title attribute redundant (duplicates visible text)
    document.querySelectorAll('[title]').forEach(el => {
      const title = (el.getAttribute('title') || '').trim().toLowerCase();
      const text = (el.textContent || '').trim().toLowerCase();
      if (title && text && title === text) {
        push(incomplete, 'custom-title-redundant', 'minor',
          'Title attribute duplicates visible text — provides no additional information',
          ['best-practice'], el);
      }
    });

    // ================================================================
    // GROUP 7: MEDIA & EMBED
    // ================================================================

    // 29. YouTube embeds without captions verification
    document.querySelectorAll('iframe[src*="youtube"], iframe[src*="youtu.be"]').forEach(iframe => {
      push(incomplete, 'custom-youtube-video', 'moderate',
        'YouTube video embedded — verify captions are enabled and accurate (WCAG 1.2.2)',
        ['wcag122', 'wcag2a'], iframe);
    });

    // 30. HTML5 video/audio without captions
    document.querySelectorAll('video').forEach(video => {
      const hasTrack = video.querySelector('track[kind="captions"], track[kind="subtitles"]');
      if (!hasTrack) {
        push(violations, 'custom-video-no-captions', 'serious',
          'Video element has no caption track — provide captions for deaf/hard-of-hearing users (WCAG 1.2.2)',
          ['wcag122', 'wcag2a'], video);
      }
    });

    // 31. Auto-playing media
    document.querySelectorAll('video[autoplay], audio[autoplay]').forEach(el => {
      const hasPause = el.controls;
      if (!hasPause) {
        push(violations, 'custom-autoplay-no-controls', 'serious',
          'Auto-playing media without visible controls (WCAG 1.4.2)',
          ['wcag142', 'wcag2a'], el);
      } else {
        push(incomplete, 'custom-autoplay-with-controls', 'minor',
          'Auto-playing media — verify pause controls are accessible (WCAG 1.4.2)',
          ['wcag142', 'wcag2a'], el);
      }
    });

    // ================================================================
    // GROUP 8: NAVIGATION & STRUCTURE
    // ================================================================

    // 32. Skip navigation
    const firstLink = document.querySelector('a[href^="#"]');
    const hasSkipNav = firstLink && /skip/i.test(firstLink.textContent + (firstLink.getAttribute('aria-label') || ''));
    const hasMainLandmark = !!document.querySelector('main, [role="main"]');
    if (!hasSkipNav && !hasMainLandmark) {
      push(violations, 'custom-skip-navigation', 'moderate',
        'No skip navigation link or main landmark found (WCAG 2.4.1)',
        ['wcag241', 'wcag2a'], document.body);
    }

    // 33. Broken skip link target
    if (firstLink && /skip/i.test(firstLink.textContent)) {
      const href = firstLink.getAttribute('href');
      if (href && href.startsWith('#') && href.length > 1) {
        if (!document.getElementById(href.slice(1))) {
          push(violations, 'custom-skip-link-broken', 'serious',
            `Skip navigation link target "${href}" does not exist (WCAG 2.4.1)`,
            ['wcag241', 'wcag2a'], firstLink);
        }
      }
    }

    // 34. Accesskey conflicts
    const accesskeys = {};
    document.querySelectorAll('[accesskey]').forEach(el => {
      const key = el.getAttribute('accesskey');
      if (key) { accesskeys[key] = (accesskeys[key] || 0) + 1; }
    });
    Object.entries(accesskeys).forEach(([key, count]) => {
      if (count > 1) {
        push(violations, 'custom-accesskey-duplicate', 'moderate',
          `Accesskey "${key}" is used ${count} times — creates conflicts (WCAG 2.4.1)`,
          ['wcag241', 'wcag2a'], document.body);
      }
    });

    // ================================================================
    // GROUP 9: TOUCH TARGETS & FOCUS
    // ================================================================

    // 35. Touch target size — skip inline links within text (WCAG 2.5.8 exception)
    document.querySelectorAll('a, button, input, select, textarea, [role="button"], [role="link"], [tabindex]').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      // Skip hidden / input type=hidden / zero-size
      if (el.type === 'hidden') return;
      // Skip inline links (WCAG 2.5.8 explicitly exempts inline links within sentences)
      if (el.tagName === 'A') {
        const parent = el.parentElement;
        const parentTag = parent && parent.tagName;
        if (parentTag === 'P' || parentTag === 'LI' || parentTag === 'SPAN' || parentTag === 'TD') {
          // Inline link in text — skip
          const parentText = (parent.textContent || '').trim();
          const linkText = (el.textContent || '').trim();
          if (parentText.length > linkText.length + 10) return; // part of larger text
        }
      }
      if (rect.width < 24 || rect.height < 24) {
        push(violations, 'custom-touch-target-minimum', 'moderate',
          `Touch target is ${Math.round(rect.width)}x${Math.round(rect.height)}px — minimum 24x24px (WCAG 2.5.8)`,
          ['wcag258', 'wcag2aa'], el);
      } else if (rect.width < 44 || rect.height < 44) {
        push(incomplete, 'custom-touch-target-enhanced', 'minor',
          `Touch target is ${Math.round(rect.width)}x${Math.round(rect.height)}px — enhanced target 44x44px (WCAG 2.5.5)`,
          ['wcag255', 'wcag2aaa'], el);
      }
    });

    // 36. Focus visible on custom elements
    document.querySelectorAll('[tabindex="0"], [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="radio"]').forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.outline === 'none' || style.outline === '0px none') {
        push(incomplete, 'custom-focus-visible', 'moderate',
          'Custom interactive element has outline:none — verify :focus indicator exists (WCAG 2.4.7)',
          ['wcag247', 'wcag2aa'], el);
      }
    });

    // ================================================================
    // GROUP 10: TEXT & REFLOW
    // ================================================================

    // 37. Text spacing overflow
    document.querySelectorAll('p, li, td, th, span, div, h1, h2, h3, h4, h5, h6').forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.overflow === 'hidden' && style.textOverflow !== 'ellipsis') {
        const hasFixedHeight = style.height !== 'auto' && !style.height.includes('%');
        if (hasFixedHeight && el.scrollHeight > el.clientHeight + 2) {
          push(violations, 'custom-text-spacing-clip', 'moderate',
            'Element has overflow:hidden with fixed height — content may clip with increased text spacing (WCAG 1.4.12)',
            ['wcag1412', 'wcag2aa'], el);
        }
      }
    });

    // 38. Horizontal scroll
    const docW = document.documentElement.scrollWidth;
    const viewW = window.innerWidth;
    if (docW > viewW + 10) {
      push(violations, 'custom-horizontal-scroll', 'moderate',
        `Page content (${docW}px) wider than viewport (${viewW}px) — may need horizontal scrolling (WCAG 1.4.10)`,
        ['wcag1410', 'wcag2aa'], document.documentElement);
    }

    // 39. Animation detection
    const animatedEls = [];
    document.querySelectorAll('*').forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.animationName && style.animationName !== 'none' && style.animationDuration !== '0s') {
        animatedEls.push(el);
      }
    });
    animatedEls.slice(0, 5).forEach(el => {
      push(incomplete, 'custom-animation-motion', 'moderate',
        'CSS animation detected — verify prefers-reduced-motion is respected (WCAG 2.3.3)',
        ['wcag233', 'wcag2aaa'], el);
    });

    // 40. Sensory instructions
    const bodyText = document.body.innerText || '';
    [
      /click (?:the )?(?:red|green|blue|yellow|orange) button/i,
      /(?:the )?(?:round|square|circular) (?:button|icon)/i,
      /see (?:the )?(?:image|figure|chart|graph) (?:below|above|on the right|on the left)/i
    ].forEach(pattern => {
      const match = bodyText.match(pattern);
      if (match) {
        push(incomplete, 'custom-sensory-instructions', 'moderate',
          `Possible sensory-only instruction: "${match[0]}" (WCAG 1.3.3)`,
          ['wcag133', 'wcag2a'], document.body);
      }
    });

    // ================================================================
    // GROUP 11: MEDIA / TIME-BASED (1.2.x) — previously uncovered
    // ================================================================

    // 41. Audio-only / video-only without transcript (1.2.1)
    document.querySelectorAll('audio').forEach(audio => {
      const parent = audio.parentElement;
      const nearbyText = parent ? parent.textContent : '';
      const hasTranscriptLink = /transcript/i.test(nearbyText);
      if (!hasTranscriptLink) {
        push(incomplete, 'custom-audio-no-transcript', 'serious',
          'Audio element found without a nearby transcript link — provide a text transcript (WCAG 1.2.1)',
          ['wcag121', 'wcag2a'], audio);
      }
    });
    document.querySelectorAll('video:not([autoplay])').forEach(video => {
      const hasTrack = video.querySelector('track[kind="descriptions"]');
      const parent = video.parentElement;
      const hasDescLink = parent && /audio description|transcript/i.test(parent.textContent);
      if (!hasTrack && !hasDescLink) {
        push(incomplete, 'custom-video-no-description', 'moderate',
          'Video without audio description track or transcript link (WCAG 1.2.3, 1.2.5)',
          ['wcag123', 'wcag125', 'wcag2a', 'wcag2aa'], video);
      }
    });

    // 42. Live media detection (1.2.4)
    document.querySelectorAll('video[src*="live"], video[src*="stream"], iframe[src*="twitch"], iframe[src*="livestream"]').forEach(el => {
      push(incomplete, 'custom-live-media', 'serious',
        'Live media detected — verify live captions are provided (WCAG 1.2.4)',
        ['wcag124', 'wcag2aa'], el);
    });

    // ================================================================
    // GROUP 12: FLASHING CONTENT (2.3.1, 2.3.2)
    // ================================================================

    // 43. Flash/flicker detection via CSS animation speed
    document.querySelectorAll('*').forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.animationName && style.animationName !== 'none') {
        const duration = parseFloat(style.animationDuration);
        const iterCount = style.animationIterationCount;
        // If animation cycles faster than 333ms (3 per second), it could flash
        if (duration > 0 && duration < 0.334 && iterCount !== '1') {
          push(violations, 'custom-flash-risk', 'critical',
            `Rapid animation (${(duration * 1000).toFixed(0)}ms cycle) may flash >3 times/second — seizure risk (WCAG 2.3.1)`,
            ['wcag231', 'wcag2a'], el);
        }
      }
    });

    // 44. Blinking text
    document.querySelectorAll('blink, [style*="blink"]').forEach(el => {
      push(violations, 'custom-blink-element', 'critical',
        'Blinking content detected — can cause seizures (WCAG 2.3.1)',
        ['wcag231', 'wcag2a'], el);
    });
    document.querySelectorAll('*').forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.textDecoration && style.textDecoration.includes('blink')) {
        push(violations, 'custom-text-blink', 'critical',
          'Text with text-decoration:blink — can cause seizures (WCAG 2.3.1)',
          ['wcag231', 'wcag2a'], el);
      }
    });

    // ================================================================
    // GROUP 13: TIMING & SESSIONS (2.2.x)
    // ================================================================

    // 45. Meta refresh / redirect detection (2.2.1)
    const metaRefresh = document.querySelector('meta[http-equiv="refresh"]');
    if (metaRefresh) {
      const content = metaRefresh.getAttribute('content') || '';
      push(violations, 'custom-meta-refresh', 'serious',
        `Page has meta refresh (${content}) — users may not have enough time to read content (WCAG 2.2.1)`,
        ['wcag221', 'wcag2a'], metaRefresh);
    }

    // 46. Timeout detection — look for countdown patterns
    const timeoutPatterns = document.querySelectorAll('[class*="countdown"], [class*="timer"], [id*="countdown"], [id*="timer"], [class*="timeout"], [id*="timeout"]');
    timeoutPatterns.forEach(el => {
      push(incomplete, 'custom-timeout-detected', 'moderate',
        'Possible timeout/countdown element — verify users can extend or disable time limits (WCAG 2.2.1, 2.2.6)',
        ['wcag221', 'wcag226', 'wcag2a', 'wcag2aaa'], el);
    });

    // 47. Auto-updating content (2.2.2) — tickers, feeds
    const autoUpdate = document.querySelectorAll('[class*="ticker"], [class*="marquee"], [class*="carousel"], [class*="slider"], [class*="slideshow"], marquee');
    autoUpdate.forEach(el => {
      push(violations, 'custom-auto-updating', 'moderate',
        'Auto-updating/moving content detected — provide pause, stop, or hide controls (WCAG 2.2.2)',
        ['wcag222', 'wcag2a'], el);
    });

    // ================================================================
    // GROUP 14: NAVIGATION CONTEXT (2.4.x)
    // ================================================================

    // 48. Location/breadcrumb detection (2.4.8 AAA)
    const hasBreadcrumb = !!document.querySelector('[class*="breadcrumb"], nav[aria-label*="breadcrumb"], [role="navigation"][aria-label*="breadcrumb"], ol.breadcrumb');
    const hasHighlightedNav = document.querySelector('nav .active, nav .current, nav [aria-current="page"]');
    if (!hasBreadcrumb && !hasHighlightedNav) {
      push(incomplete, 'custom-location-missing', 'minor',
        'No breadcrumbs or current-page indicators found — users may not know their location within the site (WCAG 2.4.8)',
        ['wcag248', 'wcag2aaa'], document.body);
    }

    // 49. Link purpose from link text alone (2.4.9 AAA)
    const ambiguousLinks = [];
    links.forEach(a => {
      const text = (a.textContent || '').trim().toLowerCase();
      if (text.length > 0 && text.length <= 15 && /^(more|details|view|open|see|show|visit|go|next|prev|back|download)$/i.test(text)) {
        ambiguousLinks.push(a);
      }
    });
    if (ambiguousLinks.length > 0) {
      ambiguousLinks.slice(0, 5).forEach(a => {
        push(incomplete, 'custom-link-purpose-alone', 'minor',
          `Link text "${(a.textContent || '').trim()}" may not convey purpose on its own (WCAG 2.4.9)`,
          ['wcag249', 'wcag2aaa'], a);
      });
    }

    // 50. Section headings (2.4.10 AAA)
    const sections = document.querySelectorAll('section, article, [role="region"]');
    sections.forEach(section => {
      const heading = section.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
      const ariaLabel = section.getAttribute('aria-label') || section.getAttribute('aria-labelledby');
      if (!heading && !ariaLabel) {
        push(incomplete, 'custom-section-no-heading', 'minor',
          'Content section has no heading — sections should be organized with headings (WCAG 2.4.10)',
          ['wcag2410', 'wcag2aaa'], section);
      }
    });

    // ================================================================
    // GROUP 15: INPUT MODALITIES (2.5.x)
    // ================================================================

    // 51. Motion actuation detection (2.5.4)
    const motionScripts = document.querySelectorAll('script');
    let hasMotionAPI = false;
    motionScripts.forEach(script => {
      const src = (script.textContent || '').toLowerCase();
      if (src.includes('devicemotion') || src.includes('deviceorientation') || src.includes('accelerometer') || src.includes('gyroscope')) {
        hasMotionAPI = true;
      }
    });
    if (hasMotionAPI) {
      push(incomplete, 'custom-motion-actuation', 'moderate',
        'Device motion API detected — ensure motion-triggered functions have UI alternatives (WCAG 2.5.4)',
        ['wcag254', 'wcag2a'], document.body);
    }

    // ================================================================
    // GROUP 16: READABILITY (3.1.x)
    // ================================================================

    // 52. Reading level estimation (3.1.5 AAA) — Flesch-Kincaid approximation
    const mainContent = document.querySelector('main, [role="main"], article, .content, #content');
    if (mainContent) {
      const text = (mainContent.textContent || '').trim();
      if (text.length > 200) {
        const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
        const words = text.split(/\s+/).filter(w => w.length > 0);
        const syllables = words.reduce((count, word) => {
          return count + Math.max(1, word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/i, '').match(/[aeiouy]{1,2}/gi)?.length || 1);
        }, 0);

        if (sentences.length > 0 && words.length > 0) {
          const avgWordsPerSentence = words.length / sentences.length;
          const avgSyllablesPerWord = syllables / words.length;
          const gradeLevel = 0.39 * avgWordsPerSentence + 11.8 * avgSyllablesPerWord - 15.59;

          if (gradeLevel > 9) {
            push(incomplete, 'custom-reading-level', 'minor',
              `Estimated reading level: Grade ${Math.round(gradeLevel)} — WCAG recommends lower secondary education level (Grade 7-9) (WCAG 3.1.5)`,
              ['wcag315', 'wcag2aaa'], mainContent);
          }
        }
      }
    }

    // 53. Abbreviations without expansion (3.1.4 AAA)
    const abbreviations = document.querySelectorAll('abbr');
    abbreviations.forEach(abbr => {
      if (!abbr.getAttribute('title') && !(abbr.textContent || '').includes('(')) {
        push(violations, 'custom-abbr-no-title', 'minor',
          `Abbreviation "${(abbr.textContent || '').trim()}" has no title attribute expansion (WCAG 3.1.4)`,
          ['wcag314', 'wcag2aaa'], abbr);
      }
    });

    // 54. Check for uppercase blocks (potential abbreviation) without <abbr>
    const textContent = (mainContent || document.body).textContent || '';
    const uppercaseMatches = textContent.match(/\b[A-Z]{3,}\b/g);
    if (uppercaseMatches) {
      const uniqueAbbrs = [...new Set(uppercaseMatches)].filter(a => !['THE','AND','FOR','BUT','NOT','YOU','ALL','HER','WAS','ONE','OUR','OUT','ARE','HAS','HIS','HOW','ITS'].includes(a));
      if (uniqueAbbrs.length > 3) {
        push(incomplete, 'custom-possible-abbreviations', 'minor',
          `Found ${uniqueAbbrs.length} possible abbreviations (${uniqueAbbrs.slice(0, 5).join(', ')}...) — consider using <abbr> with title (WCAG 3.1.4)`,
          ['wcag314', 'wcag2aaa'], document.body);
      }
    }

    // ================================================================
    // GROUP 17: PREDICTABLE / ERROR PREVENTION (3.2.x, 3.3.x)
    // ================================================================

    // 55. Context change on request (3.2.5 AAA) — new windows without warning
    links.forEach(a => {
      const target = a.getAttribute('target');
      if (target === '_blank') {
        const text = (a.textContent || '') + (a.getAttribute('aria-label') || '') + (a.getAttribute('title') || '');
        if (!/new (window|tab)/i.test(text) && !a.querySelector('[class*="external"], [aria-hidden]')) {
          push(incomplete, 'custom-new-window-warning', 'minor',
            'Link opens in new window without warning in link text (WCAG 3.2.5)',
            ['wcag325', 'wcag2aaa'], a);
        }
      }
    });

    // 56. Form submission error prevention (3.3.4 AA, 3.3.6 AAA)
    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
      const action = (form.getAttribute('action') || '').toLowerCase();
      const hasConfirmation = form.querySelector('[type="checkbox"][name*="confirm"], [type="checkbox"][name*="agree"], [class*="confirm"]');
      const hasReview = form.querySelector('[class*="review"], [class*="preview"], [class*="summary"]');
      const isImportant = /payment|checkout|order|purchase|delete|remove|subscribe|register|signup/i.test(form.innerHTML);

      if (isImportant && !hasConfirmation && !hasReview) {
        push(incomplete, 'custom-error-prevention', 'moderate',
          'Important form (payment/delete/register) has no confirmation or review step (WCAG 3.3.4)',
          ['wcag334', 'wcag2aa'], form);
      }
    });

    // 57. Help availability (3.3.5 AAA)
    const hasHelpLink = !!document.querySelector('a[href*="help"], a[href*="support"], a[href*="faq"], [class*="help"], [id*="help"]');
    const hasTooltips = document.querySelectorAll('[title], [data-tooltip], [aria-describedby]').length;
    if (!hasHelpLink && hasTooltips < 2 && forms.length > 0) {
      push(incomplete, 'custom-help-missing', 'minor',
        'Forms present but no help links or tooltips found — provide context-sensitive help (WCAG 3.3.5)',
        ['wcag335', 'wcag2aaa'], document.body);
    }

    // ================================================================
    // GROUP 18: IDENTIFY PURPOSE (1.3.6 AAA)
    // ================================================================

    // 58. Landmark regions
    const hasHeader = !!document.querySelector('header, [role="banner"]');
    const hasNav = !!document.querySelector('nav, [role="navigation"]');
    const hasMain = !!document.querySelector('main, [role="main"]');
    const hasFooter = !!document.querySelector('footer, [role="contentinfo"]');
    const missingLandmarks = [];
    if (!hasHeader) missingLandmarks.push('header/banner');
    if (!hasNav) missingLandmarks.push('nav/navigation');
    if (!hasMain) missingLandmarks.push('main');
    if (!hasFooter) missingLandmarks.push('footer/contentinfo');

    if (missingLandmarks.length >= 2) {
      push(incomplete, 'custom-landmarks-missing', 'moderate',
        `Missing landmark regions: ${missingLandmarks.join(', ')} — helps AT users understand page structure (WCAG 1.3.6)`,
        ['wcag136', 'wcag2aaa'], document.body);
    }

    // ================================================================
    // GROUP 19: CONCURRENT INPUT (2.5.6 AAA)
    // ================================================================

    // 59. Touch-only detection
    const touchOnlyHandlers = document.querySelectorAll('[ontouchstart]:not([onclick]), [ontouchend]:not([onclick])');
    touchOnlyHandlers.forEach(el => {
      push(incomplete, 'custom-touch-only', 'minor',
        'Element has touch handler but no mouse/click equivalent — may not work with all input methods (WCAG 2.5.6)',
        ['wcag256', 'wcag2aaa'], el);
    });

    // ================================================================
    // GROUP 20: WAVE-PARITY EXTRAS
    // ================================================================

    // 60. noscript element detected (WAVE: noscript alert)
    document.querySelectorAll('noscript').forEach(el => {
      push(incomplete, 'custom-noscript-present', 'minor',
        'noscript element detected — content inside is only shown when JavaScript is disabled. Verify it is accessible and equivalent to the JS experience',
        ['best-practice'], el);
    });

    // 61. iframe without title (accessibility gap)
    document.querySelectorAll('iframe').forEach(el => {
      const title = (el.getAttribute('title') || '').trim();
      const ariaLabel = (el.getAttribute('aria-label') || '').trim();
      if (!title && !ariaLabel) {
        push(violations, 'custom-iframe-no-title', 'serious',
          'iframe has no title or aria-label — screen reader users cannot identify the embedded content (WCAG 2.4.1, 4.1.2)',
          ['wcag241', 'wcag412', 'wcag2a'], el);
      }
    });

    // 62. Deprecated HTML elements (marquee, blink, center, font, etc.)
    ['marquee', 'blink', 'center', 'font', 'big', 'strike', 'frame', 'frameset'].forEach(tagName => {
      document.querySelectorAll(tagName).forEach(el => {
        push(violations, 'custom-deprecated-element', 'moderate',
          `Deprecated <${tagName}> element — not supported by modern browsers and assistive tech (WCAG 4.1.1)`,
          ['wcag411', 'wcag2a'], el);
      });
    });

    // 63. Plugin/embed detection (Flash, Java, Silverlight — largely obsolete but still appear)
    document.querySelectorAll('object, embed, applet').forEach(el => {
      const type = (el.getAttribute('type') || '').toLowerCase();
      const src = (el.getAttribute('src') || el.getAttribute('data') || '').toLowerCase();
      if (type.includes('flash') || src.endsWith('.swf') ||
          type.includes('java') || el.tagName.toLowerCase() === 'applet' ||
          type.includes('silverlight')) {
        push(violations, 'custom-deprecated-plugin', 'serious',
          `Deprecated plugin content detected (${type || el.tagName.toLowerCase()}) — not accessible in modern browsers`,
          ['wcag411', 'wcag2a'], el);
      } else {
        push(incomplete, 'custom-plugin-detected', 'moderate',
          `Plugin/embed content detected — verify it is accessible`,
          ['best-practice'], el);
      }
    });

    // 64. HTML5 video/audio elements (WAVE: html5_video_audio alert)
    document.querySelectorAll('video, audio').forEach(el => {
      const hasControls = el.hasAttribute('controls');
      if (!hasControls) {
        push(violations, 'custom-media-no-controls', 'serious',
          `<${el.tagName.toLowerCase()}> element has no controls attribute — users cannot pause or adjust playback (WCAG 1.4.2, 2.1.1)`,
          ['wcag142', 'wcag211', 'wcag2a'], el);
      } else {
        push(incomplete, 'custom-media-present', 'minor',
          `<${el.tagName.toLowerCase()}> element detected — verify captions, transcripts, and audio descriptions are provided (WCAG 1.2.1-1.2.5)`,
          ['wcag122', 'wcag2a'], el);
      }
    });

    // 65. Duplicate IDs
    const ids = {};
    document.querySelectorAll('[id]').forEach(el => {
      const id = el.id;
      if (id) { ids[id] = (ids[id] || 0) + 1; }
    });
    Object.entries(ids).forEach(([id, count]) => {
      if (count > 1) {
        push(violations, 'custom-duplicate-id', 'serious',
          `Duplicate ID "${id}" used ${count} times — IDs must be unique for labels and ARIA references to work (WCAG 4.1.1)`,
          ['wcag411', 'wcag2a'], document.getElementById(id));
      }
    });

    return { violations, incomplete };
  });

  return results;
}

// --- Merge All Engine Results ---
function mergeAllEngineResults(axeResults, pa11yResults, lighthouseResults, customResults) {
  // Start with axe + pa11y merge
  const merged = mergeResults(axeResults, pa11yResults);
  const existingSelectors = new Set();

  merged.violations.forEach(rule => {
    (rule.nodes || []).forEach(n => {
      if (n.target) existingSelectors.add(n.target.join(' > '));
    });
  });

  // Add Lighthouse failures not already found
  (lighthouseResults.audits || []).forEach(audit => {
    if (audit.score !== 0) return;
    if (audit.nodes.length === 0) return;

    const existingRule = merged.violations.find(r => r.id === audit.id);
    if (existingRule) {
      existingRule.foundBy = [...(existingRule.foundBy || ['axe-core']), 'lighthouse'];
      return;
    }

    const newNodes = audit.nodes.filter(n => !existingSelectors.has(n.selector)).map(n => ({
      target: [n.selector],
      html: n.html,
      failureSummary: n.explanation || audit.title,
      source: 'lighthouse'
    }));

    if (newNodes.length > 0) {
      merged.violations.push({
        id: `lh-${audit.id}`,
        impact: audit.weight >= 7 ? 'serious' : audit.weight >= 3 ? 'moderate' : 'minor',
        description: audit.title,
        help: audit.title,
        helpUrl: '',
        tags: [],
        nodes: newNodes,
        source: 'lighthouse'
      });
    }
  });

  // Add custom check violations
  const groupedCustomViolations = {};
  (customResults.violations || []).forEach(v => {
    if (!groupedCustomViolations[v.id]) {
      groupedCustomViolations[v.id] = {
        id: v.id,
        impact: v.impact,
        description: v.description,
        help: v.description,
        helpUrl: '',
        tags: v.tags,
        nodes: [],
        source: 'custom'
      };
    }
    if (!existingSelectors.has(v.selector)) {
      groupedCustomViolations[v.id].nodes.push({
        target: [v.selector],
        html: v.html || '',
        failureSummary: v.description,
        source: 'custom'
      });
    }
  });
  Object.values(groupedCustomViolations).forEach(group => {
    if (group.nodes.length > 0) merged.violations.push(group);
  });

  // Add custom check incompletes
  const groupedCustomIncomplete = {};
  (customResults.incomplete || []).forEach(v => {
    if (!groupedCustomIncomplete[v.id]) {
      groupedCustomIncomplete[v.id] = {
        id: v.id,
        impact: v.impact,
        description: v.description,
        help: v.description,
        helpUrl: '',
        tags: v.tags,
        nodes: [],
        source: 'custom'
      };
    }
    groupedCustomIncomplete[v.id].nodes.push({
      target: [v.selector],
      html: v.html || '',
      failureSummary: v.description,
      source: 'custom'
    });
  });
  Object.values(groupedCustomIncomplete).forEach(group => {
    if (group.nodes.length > 0) merged.incomplete.push(group);
  });

  return merged;
}

// --- Scoring (Section 508 / WCAG 2.1 AA compliance focus) ---
// Penalty-based with category caps: one type of issue can't obliterate the score.
// AAA and best-practice violations do NOT affect the compliance score.
// Produces clear, defensible scores for compliance reporting.
function calculateScore(merged) {
  const penaltyByImpact = {
    critical: 12,
    serious: 6,
    moderate: 3,
    minor: 1
  };

  // Cap the damage any single category can do (prevents one bad rule from tanking score)
  const CATEGORY_CAP = 15;

  function isComplianceLevel(rule) {
    const tags = rule.tags || [];
    const hasA_or_AA = tags.some(t => /^wcag(2|21)(a|aa)$/.test(t) || /^wcag\d{3,}$/.test(t));
    const isAAAOnly = tags.some(t => /^wcag(2|21)aaa$/.test(t)) && !hasA_or_AA;
    const isBPOnly = tags.includes('best-practice') && !hasA_or_AA;
    return hasA_or_AA && !isAAAOnly && !isBPOnly;
  }

  // Categorize rules — same category violations share a penalty cap
  function getCategory(rule) {
    const id = rule.id || '';
    if (/contrast/i.test(id)) return 'contrast';
    if (/alt|image/i.test(id)) return 'alt';
    if (/label|form-field/i.test(id) || /H91|F68|H44/.test(id)) return 'label';
    if (/link-name|link/i.test(id) || /H30/.test(id)) return 'link';
    if (/button/i.test(id)) return 'button';
    if (/heading/i.test(id)) return 'heading';
    if (/landmark|region|bypass/i.test(id)) return 'landmark';
    if (/lang|language/i.test(id)) return 'lang';
    if (/duplicate-id/i.test(id)) return 'id';
    if (/touch-target/i.test(id)) return 'touch-target';
    return 'other';
  }

  const categoryPenalties = {};
  let score = 100;

  merged.violations.forEach(rule => {
    if (!isComplianceLevel(rule)) return;
    const category = getCategory(rule);
    const penalty = penaltyByImpact[rule.impact] || 2;
    const nodeCount = rule.nodes ? rule.nodes.length : 1;
    const nodeMultiplier = Math.min(1.3, 1 + (nodeCount - 1) * 0.03);
    const ruleContribution = penalty * nodeMultiplier;

    categoryPenalties[category] = (categoryPenalties[category] || 0) + ruleContribution;
  });

  // Apply capped penalties per category
  Object.values(categoryPenalties).forEach(p => {
    score -= Math.min(p, CATEGORY_CAP);
  });

  // Needs-review: light touch (0.5 per rule, capped at 10 total)
  let needsReviewPenalty = 0;
  merged.incomplete.forEach(rule => {
    if (!isComplianceLevel(rule)) return;
    needsReviewPenalty += 0.5;
  });
  score -= Math.min(needsReviewPenalty, 10);

  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

// --- axe + pa11y Merge (with semantic dedup) ---
function mergeResults(axeResults, pa11yResults) {
  const merged = {
    violations: [...axeResults.violations],
    incomplete: [...axeResults.incomplete],
    passes: [...axeResults.passes],
    inapplicable: [...axeResults.inapplicable]
  };

  const axeSelectors = new Set();
  // Track which categories axe already covered (e.g., contrast, alt, labels)
  const axeCategories = new Set();
  const categoryMap = {
    'color-contrast': 'contrast', 'color-contrast-enhanced': 'contrast',
    'image-alt': 'alt', 'image-redundant-alt': 'alt', 'role-img-alt': 'alt',
    'label': 'label', 'select-name': 'label',
    'link-name': 'link-name', 'button-name': 'button-name',
    'document-title': 'page-title', 'html-has-lang': 'lang',
    'heading-order': 'heading', 'page-has-heading-one': 'heading',
    'landmark-one-main': 'landmark', 'region': 'landmark',
    'duplicate-id': 'duplicate-id', 'duplicate-id-active': 'duplicate-id'
  };

  axeResults.violations.forEach(rule => {
    if (categoryMap[rule.id]) axeCategories.add(categoryMap[rule.id]);
    rule.nodes.forEach(node => {
      if (node.target) axeSelectors.add(node.target.join(' > '));
    });
  });

  // Map pa11y codes to same categories
  function pa11yCategory(code) {
    if (!code) return null;
    if (/1_4_3|1_4_6|G17|G18/.test(code)) return 'contrast';
    if (/H37|H67|F65/.test(code)) return 'alt';
    if (/H44|H65|F68/.test(code)) return 'label';
    if (/H91\.A\.NoContent|H30/.test(code)) return 'link-name';
    if (/H91\.InputButton|H91\.Button/.test(code)) return 'button-name';
    if (/H25/.test(code)) return 'page-title';
    if (/H57/.test(code)) return 'lang';
    return null;
  }

  const pa11yGrouped = {};
  (pa11yResults.issues || []).forEach(issue => {
    const key = issue.code || 'unknown';
    const category = pa11yCategory(issue.code);

    // Skip if axe already covers this category comprehensively
    if (category && axeCategories.has(category)) return;

    if (!pa11yGrouped[key]) {
      pa11yGrouped[key] = {
        id: `pa11y-${key}`, impact: mapPa11yType(issue.type),
        description: issue.message || '', help: issue.message || '', helpUrl: '',
        tags: extractPa11yTags(issue.code), nodes: [], source: 'pa11y'
      };
    }
    const selector = issue.selector || '';
    if (!axeSelectors.has(selector)) {
      pa11yGrouped[key].nodes.push({
        target: [selector], html: issue.context || '',
        failureSummary: issue.message || '', source: 'pa11y'
      });
    }
  });

  Object.values(pa11yGrouped).forEach(group => {
    if (group.nodes.length > 0) merged.violations.push(group);
  });

  return merged;
}

// --- Helpers ---
function countNodes(rules) {
  return rules.reduce((sum, r) => sum + (r.nodes ? r.nodes.length : 0), 0);
}

function mapPa11yType(type) {
  const map = { error: 'serious', warning: 'moderate', notice: 'minor' };
  return map[type] || 'minor';
}

function extractPa11yTags(code) {
  if (!code) return [];
  const tags = [];
  if (/^WCAG2AAA\./.test(code)) tags.push('wcag2aaa');
  else if (/^WCAG2AA\./.test(code)) tags.push('wcag2aa');
  else if (/^WCAG2A\./.test(code)) tags.push('wcag2a');
  const match = code.match(/\.(\d+)_(\d+)_(\d+)\./);
  if (match) tags.push(`wcag${match[1]}${match[2]}${match[3]}`);
  return tags;
}

module.exports = {
  scanPage, calculateScore, scoreGrade, mergeResults, mergeAllEngineResults,
  countNodes, mapPa11yType, extractPa11yTags, runLighthouse, runCustomChecks
};
