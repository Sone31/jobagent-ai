// ============================================================
// JobAgent AI — Background Service Worker v2.1
// Handles message routing + match score calculation
// ============================================================

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// ── Message router ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── Content → Sidepanel ────────────────────────────────────
  if (message.type === "FROM_CONTENT") {

    // Page ready notification → forward to sidepanel
    if (message.action === "PAGE_READY" || message.action === "TRIGGER_AUTOFILL") {
      chrome.runtime.sendMessage({ ...message, type: "TO_SIDEPANEL" }).catch(() => {});
    }

    // Match score requested by overlay → forward to sidepanel to calculate
    if (message.action === "REQUEST_MATCH_SCORE") {
      const tabId = sender.tab?.id;
      // Forward request to sidepanel with the tab id so it can respond back
      chrome.runtime.sendMessage({
        type: "TO_SIDEPANEL",
        action: "CALCULATE_MATCH_SCORE",
        payload: { ...message.payload, tabId }
      }).catch(() => {
        // Sidepanel not open — send error back to content script
        if (tabId) {
          chrome.tabs.sendMessage(tabId, {
            type: "TO_CONTENT",
            action: "MATCH_SCORE_RESULT",
            payload: { error: "Open the JobAgent AI sidebar to enable match scoring" }
          }).catch(() => {});
        }
      });
    }

    sendResponse({ ok: true });
    return true;
  }

  // ── Sidepanel → Content ────────────────────────────────────
  if (message.type === "FROM_SIDEPANEL") {
    // Forward to active tab content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
          sendResponse(response || { status: "no_response" });
        });
      } else {
        sendResponse({ error: "No active tab found" });
      }
    });
    return true;
  }

  // ── Sidepanel → Content (score result) ────────────────────
  if (message.type === "SCORE_RESULT_TO_TAB") {
    const { tabId, payload } = message;
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        type: "TO_CONTENT",
        action: "MATCH_SCORE_RESULT",
        payload
      }).catch(() => {});
    }
    sendResponse({ ok: true });
    return true;
  }

});

// ── Inject content script on navigation ─────────────────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url && !tab.url.startsWith("chrome://")) {
    chrome.scripting.executeScript({
      target: { tabId },
      files: ["lib/ats-handlers.js", "lib/content.js"]
    }).catch(() => {});

    // Inject match overlay on job pages
    const jobPatterns = [
      /linkedin\.com\/jobs\//,
      /indeed\.com\/viewjob/,
      /seek\.com\.au\/job\//,
      /seek\.com\.nz\/job\//,
      /glassdoor\.com\/job/,
      /lever\.co\//,
      /greenhouse\.io\//,
      /myworkdayjobs\.com\//,
      /ashbyhq\.com\//
    ];

    if (jobPatterns.some(p => p.test(tab.url || ""))) {
      chrome.scripting.executeScript({
        target: { tabId },
        files: ["lib/match-overlay.js"]
      }).catch(() => {});
    }
  }
});
