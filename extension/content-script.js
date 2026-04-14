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

  if (message.action === 'startPicker') {
    startElementPicker()
      .then(selector => sendResponse({ selector }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
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

// --- Element Picker ---
function startElementPicker() {
  return new Promise((resolve) => {
    let pickerOverlay = null;
    let selectedSelector = null;

    function getUniqueSelector(el) {
      if (el.id) return `#${el.id}`;
      const parts = [];
      while (el && el !== document.body) {
        let selector = el.tagName.toLowerCase();
        if (el.id) {
          parts.unshift(`#${el.id}`);
          break;
        }
        if (el.className && typeof el.className === 'string') {
          const classes = el.className.trim().split(/\s+/).filter(c => !c.startsWith('wcag-tester'));
          if (classes.length > 0) {
            selector += '.' + classes.slice(0, 2).join('.');
          }
        }
        const parent = el.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
          if (siblings.length > 1) {
            const index = siblings.indexOf(el) + 1;
            selector += `:nth-of-type(${index})`;
          }
        }
        parts.unshift(selector);
        el = parent;
      }
      return parts.join(' > ');
    }

    function onMouseMove(e) {
      const el = e.target;
      if (el.className && typeof el.className === 'string' && el.className.includes('wcag-tester')) return;

      if (pickerOverlay) pickerOverlay.remove();

      const rect = el.getBoundingClientRect();
      const scrollX = window.scrollX || window.pageXOffset;
      const scrollY = window.scrollY || window.pageYOffset;
      pickerOverlay = document.createElement('div');
      pickerOverlay.className = 'wcag-tester-picker';
      pickerOverlay.style.cssText = `
        position: absolute;
        top: ${rect.top + scrollY}px;
        left: ${rect.left + scrollX}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        border: 2px dashed #3b82f6;
        background: rgba(59, 130, 246, 0.1);
        z-index: 2147483647;
        pointer-events: none;
        box-sizing: border-box;
      `;
      document.body.appendChild(pickerOverlay);
      selectedSelector = getUniqueSelector(el);
    }

    function onClick(e) {
      e.preventDefault();
      e.stopPropagation();
      cleanup();
      resolve(selectedSelector || '');
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        cleanup();
        resolve('');
      }
    }

    function cleanup() {
      document.removeEventListener('mousemove', onMouseMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeyDown, true);
      if (pickerOverlay) pickerOverlay.remove();
      document.querySelectorAll('.wcag-tester-picker').forEach(el => el.remove());
    }

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
  });
}
