// Content script — runs axe-core in the page context and handles element highlighting

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'runScan') {
    runAccessibilityScan(message.options)
      .then(results => sendResponse({ results }))
      .catch(err => sendResponse({ error: err.message }));
    return true; // async
  }

  if (message.action === 'highlight') {
    highlightElement(message.selector);
  }

  if (message.action === 'clearHighlight') {
    clearHighlight();
  }
});

async function runAccessibilityScan(options) {
  // axe-core must be injected by background.js via chrome.scripting.executeScript
  // before this function is called (they share the isolated world)
  if (typeof axe === 'undefined') {
    throw new Error('axe-core not loaded. Ensure background.js injects it first.');
  }

  // Build axe options
  const axeOptions = {
    resultTypes: ['violations', 'incomplete', 'passes', 'inapplicable']
  };

  // Set WCAG level filter
  const tags = [];
  if (options.levels.includes('A')) {
    tags.push('wcag2a', 'wcag21a');
  }
  if (options.levels.includes('AA')) {
    tags.push('wcag2aa', 'wcag21aa');
  }
  if (options.levels.includes('AAA')) {
    tags.push('wcag2aaa', 'wcag21aaa');
  }
  if (options.bestPractices) {
    tags.push('best-practice');
  }

  if (tags.length > 0) {
    axeOptions.runOnly = {
      type: 'tag',
      values: tags
    };
  }

  // Determine scan context
  let context = document;
  if (options.selector) {
    const el = document.querySelector(options.selector);
    if (el) {
      context = el;
    }
  }

  const results = await axe.run(context, axeOptions);
  return results;
}

function highlightElement(selector) {
  clearHighlight();

  try {
    const elements = document.querySelectorAll(selector);
    if (elements.length === 0) return;

    elements.forEach(el => {
      const rect = el.getBoundingClientRect();
      const scrollX = window.scrollX || window.pageXOffset;
      const scrollY = window.scrollY || window.pageYOffset;
      const overlay = document.createElement('div');
      overlay.className = 'wcag-tester-highlight';
      overlay.style.cssText = `
        position: absolute;
        top: ${rect.top + scrollY}px;
        left: ${rect.left + scrollX}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        border: 3px solid #e53e3e;
        background: rgba(229, 62, 62, 0.15);
        z-index: 2147483647;
        pointer-events: none;
        box-sizing: border-box;
        transition: all 0.2s ease;
      `;
      document.body.appendChild(overlay);

      // Scroll into view
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  } catch (e) {
    // Invalid selector — ignore
  }
}

function clearHighlight() {
  document.querySelectorAll('.wcag-tester-highlight').forEach(el => el.remove());
}
