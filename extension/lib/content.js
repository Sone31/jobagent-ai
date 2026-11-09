// ============================================================
// JobAgent AI v3.1 — Content Script
// Injected into every page. Handles scanning + filling forms.
// ============================================================
(function () {
  if (window.__jobAgentV31) return;
  window.__jobAgentV31 = true;

  // ── Helpers ────────────────────────────────────────────────

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function getXPath(el) {
    if (el.id) return `//*[@id="${el.id}"]`;
    const parts = [];
    let node = el;
    while (node && node.tagName && node !== document.body) {
      const tag  = node.tagName.toLowerCase();
      const sibs = [...(node.parentNode?.children || [])].filter(c => c.tagName === node.tagName);
      const idx  = sibs.indexOf(node) + 1;
      parts.unshift(sibs.length > 1 ? `${tag}[${idx}]` : tag);
      node = node.parentNode;
    }
    return "//" + parts.join("/");
  }

  function getLabel(el) {
    // 1. aria-label
    let t = (el.getAttribute("aria-label") || "").trim();
    if (t) return t;
    // 2. label[for]
    if (el.id) {
      const l = document.querySelector(`label[for="${el.id}"]`);
      if (l) return l.innerText.replace(/\*/g, "").trim();
    }
    // 3. aria-labelledby
    const lblId = el.getAttribute("aria-labelledby");
    if (lblId) {
      const l = document.getElementById(lblId);
      if (l) return l.innerText.trim();
    }
    // 4. Parent label
    let p = el.parentElement;
    for (let i = 0; i < 5 && p; i++) {
      if (p.tagName === "LABEL") return p.innerText.replace(/\*/g, "").trim();
      p = p.parentElement;
    }
    // 5. Previous sibling text
    const prev = el.previousElementSibling;
    if (prev) {
      const t2 = (prev.innerText || prev.textContent || "").trim();
      if (t2 && t2.length < 120) return t2.replace(/\*/g, "").trim();
    }
    // 6. Placeholder / name
    return el.placeholder || el.name || "";
  }

  function getAllFields() {
    const fields = [];
    const seen   = new Set();
    const sel    = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([disabled]),textarea:not([disabled]),select:not([disabled])';

    document.querySelectorAll(sel).forEach((el, i) => {
      if (seen.has(el)) return;
      seen.add(el);
      const label = getLabel(el);
      if (!label && !el.name && !el.id) return;
      const options = el.tagName === "SELECT" ? [...el.options].map(o => o.text).filter(Boolean) : [];
      fields.push({
        xpath:   getXPath(el),
        label:   label.slice(0, 120),
        name:    el.name   || "",
        type:    el.type   || el.tagName.toLowerCase(),
        value:   el.value  || "",
        options,
        required: el.required || el.getAttribute("aria-required") === "true"
      });
    });
    return fields;
  }

  async function fillField(xpath, value) {
    try {
      const xr = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      const el = xr.singleNodeValue;
      if (!el) return false;

      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.focus();
      await sleep(60);

      if (el.tagName === "SELECT") {
        const lv = String(value).toLowerCase();
        let best = null, bestScore = 0;
        for (const opt of el.options) {
          const ot = opt.text.toLowerCase(), ov = opt.value.toLowerCase();
          let sc = 0;
          if (ot === lv || ov === lv) sc = 100;
          else if (ot.includes(lv) || lv.includes(ot)) sc = 70;
          if (sc > bestScore) { bestScore = sc; best = opt; }
        }
        if (best && bestScore > 0) {
          el.value = best.value;
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new Event("input",  { bubbles: true }));
        }
      } else if (el.type === "checkbox" || el.type === "radio") {
        const should = ["yes","true","1"].includes(String(value).toLowerCase());
        if (el.checked !== should) {
          el.click();
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      } else {
        // React / Angular / Vue safe fill
        const proto  = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (setter) setter.call(el, value);
        else el.value = value;
        ["input","change","keyup","blur"].forEach(e =>
          el.dispatchEvent(new Event(e, { bubbles: true, cancelable: true }))
        );
        el.dispatchEvent(new InputEvent("input", { bubbles: true, data: String(value) }));
      }

      // Purple highlight
      const prev = el.style.outline;
      el.style.outline = "2.5px solid #7c3aed";
      el.style.outlineOffset = "2px";
      setTimeout(() => { el.style.outline = prev; el.style.outlineOffset = ""; }, 2500);
      return true;
    } catch (e) {
      return false;
    }
  }

  function getJobContext() {
    const url  = location.href;
    const h    = location.hostname;
    let title = "", company = "", jobDesc = "";

    if (h.includes("linkedin.com")) {
      title   = document.querySelector(".job-details-jobs-unified-top-card__job-title h1, h1")?.innerText?.trim() || document.title;
      company = document.querySelector(".job-details-jobs-unified-top-card__company-name a, .jobs-unified-top-card__company-name")?.innerText?.trim() || "";
      jobDesc = document.querySelector(".jobs-description__content, #job-details, .jobs-description-content")?.innerText?.trim().slice(0, 3000) || "";
    } else if (h.includes("seek.com")) {
      title   = document.querySelector("[data-automation='job-detail-title'], h1")?.innerText?.trim() || document.title;
      company = document.querySelector("[data-automation='advertiser-name']")?.innerText?.trim() || "";
      jobDesc = document.querySelector("[data-automation='jobAdDetails']")?.innerText?.trim().slice(0, 3000) || "";
    } else if (h.includes("indeed.com")) {
      title   = document.querySelector(".jobsearch-JobInfoHeader-title, h1")?.innerText?.trim() || document.title;
      company = document.querySelector("[data-testid='inlineHeader-companyName'] a")?.innerText?.trim() || "";
      jobDesc = document.querySelector("#jobDescriptionText, .jobsearch-jobDescriptionText")?.innerText?.trim().slice(0, 3000) || "";
    } else if (h.includes("glassdoor.com")) {
      title   = document.querySelector("[data-test='job-title'], h1")?.innerText?.trim() || document.title;
      company = document.querySelector("[data-test='employer-name']")?.innerText?.trim() || "";
      jobDesc = document.querySelector("[data-test='jobDescriptionContent']")?.innerText?.trim().slice(0, 3000) || "";
    } else {
      title   = document.querySelector("h1")?.innerText?.trim() || document.title;
      company = document.querySelector("h2")?.innerText?.trim() || "";
      jobDesc = document.body.innerText.slice(0, 3000);
    }

    return { url, title, company, jobDesc };
  }

  async function clickApply() {
    const selectors = [
      ".jobs-apply-button--top-card",
      ".jobs-apply-button",
      "button[aria-label*='Easy Apply']",
      "button[aria-label*='Apply']",
      "[data-automation='job-detail-apply']",
      ".indeed-apply-button",
      "#indeedApplyButton",
      "[data-automation='apply-button']",
      "a[data-automation='job-detail-apply']",
      "button:not([disabled])"
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && !el.disabled && el.offsetParent !== null) {
        const text = (el.innerText || el.textContent || "").toLowerCase();
        if (text.includes("apply") || sel.includes("apply")) {
          el.click();
          await sleep(1800);
          return { success: true, text: el.innerText?.trim() };
        }
      }
    }
    return { success: false };
  }

  async function clickNext() {
    const candidates = [
      "button[aria-label='Continue to next step']",
      "button[aria-label='Review your application']",
      "button[aria-label='Submit application']",
      "button[aria-label*='Next']",
      "button[aria-label*='Continue']",
      ".artdeco-button--primary",
      "[data-automation='navigate-next']",
      "button[type='submit']",
      "input[type='submit']",
      "#form-action-continue"
    ];
    for (const sel of candidates) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        if (!el.disabled && el.offsetParent !== null) {
          const text = (el.innerText || el.value || "").toLowerCase();
          const isSubmit = /submit|send application|apply|complete/i.test(text);
          el.click();
          await sleep(1800);
          return { success: true, text: el.innerText?.trim() || "", isSubmit };
        }
      }
    }
    return { success: false };
  }

  function showPageToast(message, type = "info") {
    const existing = document.getElementById("__ja_toast");
    if (existing) existing.remove();
    const colors = { info:"#7c3aed", success:"#16a34a", error:"#dc2626", warning:"#d97706" };
    const t = document.createElement("div");
    t.id = "__ja_toast";
    t.style.cssText = `position:fixed;bottom:20px;right:20px;background:${colors[type]||colors.info};color:#fff;padding:10px 16px;border-radius:10px;font-family:-apple-system,sans-serif;font-size:13px;font-weight:500;z-index:2147483647;box-shadow:0 4px 16px rgba(0,0,0,.25);max-width:300px;line-height:1.4;animation:__ja_in .3s ease`;
    const style = document.createElement("style");
    style.textContent = `@keyframes __ja_in{from{transform:translateX(120px);opacity:0}to{transform:translateX(0);opacity:1}}`;
    document.head.appendChild(style);
    t.textContent = `🤖 ${message}`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4500);
  }

  // ── Message listener ───────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type !== "FROM_SIDEPANEL") return;

    (async () => {
      try {
        switch (msg.action) {

          case "PING":
            sendResponse({ ok: true, url: location.href, title: document.title });
            break;

          case "GET_PAGE_TEXT": {
            const ctx = getJobContext();
            sendResponse({ ok: true, context: ctx });
            break;
          }

          case "SCAN_PAGE": {
            const fields  = getAllFields();
            const context = getJobContext();
            sendResponse({ ok: true, fields, context });
            break;
          }

          case "FILL_FIELDS": {
            const fills   = msg.payload?.fills || [];
            const results = [];
            for (const f of fills) {
              const ok = await fillField(f.xpath, f.value);
              results.push({ xpath: f.xpath, success: ok });
              await sleep(100);
            }
            sendResponse({ ok: true, results });
            break;
          }

          case "CLICK_APPLY": {
            const r = await clickApply();
            sendResponse(r);
            break;
          }

          case "CLICK_NEXT": {
            const r = await clickNext();
            sendResponse(r);
            break;
          }

          case "SHOW_TOAST": {
            showPageToast(msg.payload?.message, msg.payload?.type);
            sendResponse({ ok: true });
            break;
          }

          case "FILL_ANSWER": {
            const ok = await fillField(msg.payload?.xpath, msg.payload?.value);
            sendResponse({ ok, success: ok });
            break;
          }

          case "SCAN_QUESTIONS": {
            const questions = [];
            const seen = new Set();
            document.querySelectorAll("textarea:not([disabled]),input[type='text']:not([disabled])").forEach(el => {
              if (seen.has(el)) return; seen.add(el);
              const label = getLabel(el);
              if (!label) return;
              if (el.tagName !== "TEXTAREA" && label.length < 20 && !label.includes("?")) return;
              if (/^(full ?name|first|last|email|phone|mobile|address|city|zip|url|website|linkedin|portfolio|salary)/i.test(label)) return;
              questions.push({ xpath: getXPath(el), label: label.slice(0, 200), category: "generic" });
            });
            sendResponse({ ok: true, questions });
            break;
          }

          default:
            sendResponse({ ok: false, error: `Unknown action: ${msg.action}` });
        }
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true; // keep channel open
  });

  // Notify background that page is ready
  chrome.runtime.sendMessage({
    type: "FROM_CONTENT", action: "PAGE_READY",
    payload: { url: location.href, title: document.title }
  }).catch(() => {});

})();
