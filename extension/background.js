// Service worker — message relay between DevTools panel and content script

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'runScan') {
    // Forward scan request to the content script in the inspected tab
    chrome.tabs.sendMessage(message.tabId, {
      action: 'runScan',
      options: message.options
    }, (response) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse(response);
      }
    });
    return true; // Keep channel open for async response
  }

  if (message.action === 'highlight') {
    chrome.tabs.sendMessage(message.tabId, {
      action: 'highlight',
      selector: message.selector
    });
  }

  if (message.action === 'clearHighlight') {
    chrome.tabs.sendMessage(message.tabId, {
      action: 'clearHighlight'
    });
  }

  if (message.action === 'startPicker') {
    chrome.tabs.sendMessage(message.tabId, {
      action: 'startPicker'
    }, (response) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse(response);
      }
    });
    return true;
  }

  if (message.action === 'injectAxe') {
    // Inject axe-core into the page if not already present
    chrome.scripting.executeScript({
      target: { tabId: message.tabId },
      files: ['lib/axe.min.js']
    }).then(() => {
      sendResponse({ success: true });
    }).catch((err) => {
      sendResponse({ error: err.message });
    });
    return true;
  }
});
