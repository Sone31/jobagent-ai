// ============================================================
// JobAgent AI — ATS Platform Handlers
// Dedicated, reliable form-filling for each major platform
// ============================================================

// ── Utility: wait for element to appear ────────────────────
function waitForElement(selector, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);

    const observer = new MutationObserver(() => {
      const found = document.querySelector(selector);
      if (found) {
        observer.disconnect();
        resolve(found);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timeout waiting for: ${selector}`));
    }, timeout);
  });
}

// ── Utility: wait for XPath element ────────────────────────
function waitForXPath(xpath, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const check = () => {
      const result = document.evaluate(
        xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
      );
      return result.singleNodeValue;
    };

    const el = check();
    if (el) return resolve(el);

    const observer = new MutationObserver(() => {
      const found = check();
      if (found) { observer.disconnect(); resolve(found); }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); reject(new Error(`XPath timeout: ${xpath}`)); }, timeout);
  });
}

// ── Utility: sleep ─────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Utility: robust field fill ─────────────────────────────
async function fillInput(el, value) {
  if (!el || !value) return false;

  el.focus();
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  await sleep(80);

  if (el.tagName === "SELECT") {
    return fillSelect(el, value);
  }

  if (el.type === "checkbox" || el.type === "radio") {
    return fillCheckRadio(el, value);
  }

  // Clear existing value
  el.select?.();
  document.execCommand("selectAll", false, null);
  document.execCommand("delete", false, null);

  // Try React/Vue/Angular native setter first
  const proto = el.tagName === "TEXTAREA"
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;

  if (nativeSetter) {
    nativeSetter.call(el, value);
  } else {
    el.value = value;
  }

  // Fire all events frameworks listen for
  ["input", "change", "keydown", "keyup", "keypress", "blur"].forEach(evtName => {
    el.dispatchEvent(new Event(evtName, { bubbles: true, cancelable: true }));
  });

  // For React specifically
  el.dispatchEvent(new InputEvent("input", { bubbles: true, data: value }));

  await sleep(50);

  // Highlight field
  el.style.outline = "2.5px solid #7c3aed";
  el.style.outlineOffset = "2px";
  setTimeout(() => {
    el.style.outline = "";
    el.style.outlineOffset = "";
  }, 2500);

  return true;
}

function fillSelect(el, value) {
  const lv = value.toLowerCase();
  let bestOption = null;
  let bestScore = 0;

  for (const opt of el.options) {
    const ot = opt.text.toLowerCase();
    const ov = opt.value.toLowerCase();
    let score = 0;
    if (ot === lv || ov === lv) score = 100;
    else if (ot.includes(lv) || lv.includes(ot)) score = 70;
    else if (ov.includes(lv) || lv.includes(ov)) score = 60;

    if (score > bestScore) { bestScore = score; bestOption = opt; }
  }

  if (bestOption && bestScore > 0) {
    el.value = bestOption.value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  return false;
}

function fillCheckRadio(el, value) {
  const shouldCheck = ["yes", "true", "1", "agree", "i agree"].includes(
    String(value).toLowerCase()
  );
  if (el.checked !== shouldCheck) {
    el.checked = shouldCheck;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("click", { bubbles: true }));
  }
  return true;
}

// ── Utility: get all fillable fields with smart labelling ──
function getAllFields() {
  const fields = [];
  const seen = new Set();

  const inputs = document.querySelectorAll(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"])' +
    ':not([type="reset"]):not([type="image"]):not([disabled]),' +
    'textarea:not([disabled]), select:not([disabled])'
  );

  inputs.forEach((el) => {
    if (seen.has(el)) return;
    seen.add(el);

    // Get XPath
    let xpath = "";
    if (el.id) {
      xpath = `//*[@id="${el.id}"]`;
    } else {
      const parts = [];
      let node = el;
      while (node && node.tagName && node !== document.body) {
        const tag = node.tagName.toLowerCase();
        const siblings = [...(node.parentNode?.children || [])].filter(c => c.tagName === node.tagName);
        const idx = siblings.indexOf(node) + 1;
        parts.unshift(siblings.length > 1 ? `${tag}[${idx}]` : tag);
        node = node.parentNode;
      }
      xpath = "//" + parts.join("/");
    }

    // Get label (multiple strategies)
    let label = "";

    // 1. aria-label
    label = el.getAttribute("aria-label") || "";

    // 2. label[for]
    if (!label && el.id) {
      const lbl = document.querySelector(`label[for="${el.id}"]`);
      if (lbl) label = lbl.innerText.replace(/\*/g, "").trim();
    }

    // 3. aria-labelledby
    if (!label) {
      const lblId = el.getAttribute("aria-labelledby");
      if (lblId) {
        const lblEl = document.getElementById(lblId);
        if (lblEl) label = lblEl.innerText.trim();
      }
    }

    // 4. Wrap label
    if (!label) {
      let parent = el.parentElement;
      for (let i = 0; i < 4 && parent; i++) {
        if (parent.tagName === "LABEL") {
          label = parent.innerText.replace(/\*/g, "").trim();
          break;
        }
        parent = parent.parentElement;
      }
    }

    // 5. Preceding sibling text
    if (!label) {
      const prev = el.previousElementSibling;
      if (prev) {
        const t = prev.innerText?.trim() || prev.textContent?.trim();
        if (t && t.length < 80) label = t.replace(/\*/g, "").trim();
      }
    }

    // 6. placeholder
    if (!label) label = el.placeholder || "";

    // 7. name attribute
    if (!label) label = el.name || el.id || "";

    const options = el.tagName === "SELECT"
      ? [...el.options].map(o => o.text).filter(Boolean)
      : [];

    if (label || el.name || el.id) {
      fields.push({
        xpath,
        label: label.slice(0, 100),
        placeholder: el.placeholder || "",
        name: el.name || "",
        type: el.type || el.tagName.toLowerCase(),
        value: el.value || "",
        options,
        required: el.required || el.getAttribute("aria-required") === "true"
      });
    }
  });

  return fields;
}

// ============================================================
// PLATFORM HANDLERS
// ============================================================

// ── LinkedIn Easy Apply ────────────────────────────────────
const LinkedInHandler = {
  name: "LinkedIn Easy Apply",

  detect() {
    return window.location.hostname.includes("linkedin.com");
  },

  async clickApply() {
    const selectors = [
      ".jobs-apply-button--top-card",
      ".jobs-apply-button",
      "button.jobs-apply-button",
      "[data-control-name='jobdetails_topcard_inapply']",
      "button[aria-label*='Easy Apply']",
      "button[aria-label*='Apply']"
    ];

    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn && !btn.disabled) {
        btn.click();
        await sleep(1500);
        return true;
      }
    }
    return false;
  },

  async getFields() {
    // Wait for Easy Apply modal to open
    try {
      await waitForElement(".jobs-easy-apply-modal, .artdeco-modal", 5000);
      await sleep(500);
    } catch (_) {}

    return getAllFields();
  },

  async fillFields(fills) {
    const results = [];

    for (const fill of fills) {
      try {
        // Find element by xpath
        const xpathResult = document.evaluate(
          fill.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
        );
        const el = xpathResult.singleNodeValue;

        if (el) {
          const ok = await fillInput(el, fill.value);
          results.push({ xpath: fill.xpath, success: ok, value: fill.value });
        } else {
          results.push({ xpath: fill.xpath, success: false, reason: "Element not found" });
        }

        await sleep(120); // Small delay between fields
      } catch (err) {
        results.push({ xpath: fill.xpath, success: false, reason: err.message });
      }
    }

    return results;
  },

  async clickNext() {
    const selectors = [
      "button[aria-label='Continue to next step']",
      "button[aria-label='Review your application']",
      "button[aria-label='Submit application']",
      ".artdeco-button--primary",
      "footer button.artdeco-button--primary"
    ];

    for (const sel of selectors) {
      const btns = document.querySelectorAll(sel);
      for (const btn of btns) {
        if (!btn.disabled && btn.offsetParent !== null) {
          btn.click();
          await sleep(1500);
          return { success: true, text: btn.innerText.trim() };
        }
      }
    }
    return { success: false };
  },

  getJobContext() {
    const title = document.querySelector(
      ".job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, h1"
    )?.innerText?.trim() || "";

    const company = document.querySelector(
      ".job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name"
    )?.innerText?.trim() || "";

    const description = document.querySelector(
      ".jobs-description__content, .jobs-description-content"
    )?.innerText?.trim().slice(0, 2000) || "";

    const location = document.querySelector(
      ".job-details-jobs-unified-top-card__primary-description-container"
    )?.innerText?.trim() || "";

    return { title, company, description, location, url: window.location.href };
  }
};

// ── Workday ────────────────────────────────────────────────
const WorkdayHandler = {
  name: "Workday",

  detect() {
    return window.location.href.includes("myworkdayjobs") ||
           window.location.href.includes("wd3.myworkday") ||
           window.location.href.includes("wd5.myworkday") ||
           document.querySelector("[data-automation-id='biPageSection']") !== null;
  },

  async getFields() {
    await sleep(1000); // Workday loads slowly

    const fields = [];
    const seen = new Set();

    // Workday-specific selectors
    const inputs = document.querySelectorAll(
      "[data-automation-id='textInput'], " +
      "[data-automation-id='selectWidget'], " +
      "[data-automation-id='radioButton'], " +
      "[data-automation-id='checkboxPanel'], " +
      "input[class*='css-'], textarea[class*='css-'], " +
      "input:not([type='hidden']):not([disabled]), " +
      "textarea:not([disabled])"
    );

    inputs.forEach(el => {
      if (seen.has(el)) return;
      seen.add(el);

      // Workday label strategy — look for data-automation-id on label
      let label = "";
      const automationId = el.getAttribute("data-automation-id") || "";

      // Try label by automation id
      const labelEl = document.querySelector(`[for="${el.id}"], label[data-automation-id*="label"]`);
      if (labelEl) label = labelEl.innerText.trim();

      // Walk up to find section header
      if (!label) {
        let parent = el.parentElement;
        for (let i = 0; i < 6 && parent; i++) {
          const header = parent.querySelector("label, [data-automation-id*='label'], h3, h4");
          if (header && header !== el) {
            label = header.innerText.replace(/\*/g, "").trim();
            if (label) break;
          }
          parent = parent.parentElement;
        }
      }

      if (!label) label = el.placeholder || el.name || automationId || "";

      const xpath = el.id ? `//*[@id="${el.id}"]` : `//*[@data-automation-id="${automationId}"]`;

      fields.push({
        xpath: el.id ? `//*[@id="${el.id}"]` : `//input[@placeholder="${el.placeholder || ""}"]`,
        label: label.slice(0, 100),
        placeholder: el.placeholder || "",
        name: el.name || "",
        type: el.type || "text",
        value: el.value || "",
        options: el.tagName === "SELECT" ? [...el.options].map(o => o.text) : [],
        automationId
      });
    });

    return fields;
  },

  async fillFields(fills) {
    const results = [];

    for (const fill of fills) {
      try {
        let el = null;

        // Try xpath first
        try {
          const xr = document.evaluate(fill.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          el = xr.singleNodeValue;
        } catch (_) {}

        // Fallback: search by label text in Workday structure
        if (!el && fill.fieldName) {
          const allInputs = document.querySelectorAll("input:not([type='hidden']), textarea");
          for (const input of allInputs) {
            let parent = input.parentElement;
            for (let i = 0; i < 5 && parent; i++) {
              if (parent.innerText?.toLowerCase().includes(fill.fieldName.toLowerCase())) {
                el = input;
                break;
              }
              parent = parent.parentElement;
            }
            if (el) break;
          }
        }

        if (el) {
          const ok = await fillInput(el, fill.value);
          results.push({ xpath: fill.xpath, success: ok });
        } else {
          results.push({ xpath: fill.xpath, success: false, reason: "Not found in Workday DOM" });
        }

        await sleep(200); // Workday needs more time
      } catch (err) {
        results.push({ xpath: fill.xpath, success: false, reason: err.message });
      }
    }

    return results;
  },

  async clickNext() {
    const selectors = [
      "button[data-automation-id='bottom-navigation-next-button']",
      "button[data-automation-id='pageFooter'] button",
      "button[aria-label*='Next']",
      "button[aria-label*='Save and Continue']",
      "button[type='button'][class*='primary']"
    ];

    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn && !btn.disabled) {
        btn.click();
        await sleep(2000);
        return { success: true, text: btn.innerText.trim() };
      }
    }
    return { success: false };
  },

  getJobContext() {
    const title = document.querySelector("h2, h1, [data-automation-id='jobPostingTitle']")
      ?.innerText?.trim() || document.title || "";
    const description = document.querySelector(
      "[data-automation-id='jobPostingDescription'], .job-description, article"
    )?.innerText?.trim().slice(0, 2000) || "";
    return { title, company: "", description, url: window.location.href };
  }
};

// ── Greenhouse ─────────────────────────────────────────────
const GreenhouseHandler = {
  name: "Greenhouse",

  detect() {
    return window.location.href.includes("greenhouse.io") ||
           window.location.href.includes("boards.greenhouse.io") ||
           document.querySelector("#application-form, .application-form") !== null;
  },

  async getFields() {
    await sleep(500);
    return getAllFields();
  },

  async fillFields(fills) {
    return await genericFillFields(fills);
  },

  async clickNext() {
    const btn = document.querySelector(
      "input[type='submit'], button[type='submit'], #submit_app, .submit-app"
    );
    if (btn && !btn.disabled) {
      // Don't auto-submit — confirm with user
      return { success: false, requiresConfirm: true, text: btn.innerText || "Submit" };
    }
    return { success: false };
  },

  getJobContext() {
    const title = document.querySelector(".app-title, h1, .job-title")?.innerText?.trim() || "";
    const company = document.querySelector(".company-name, .employer")?.innerText?.trim() || "";
    const description = document.querySelector(
      "#job_description, .job-description, .content"
    )?.innerText?.trim().slice(0, 2000) || "";
    return { title, company, description, url: window.location.href };
  }
};

// ── Lever ──────────────────────────────────────────────────
const LeverHandler = {
  name: "Lever",

  detect() {
    return window.location.href.includes("jobs.lever.co") ||
           window.location.href.includes("lever.co/");
  },

  async getFields() {
    await sleep(500);
    return getAllFields();
  },

  async fillFields(fills) {
    return await genericFillFields(fills);
  },

  async clickNext() {
    const btn = document.querySelector(
      ".template-btn-submit, [data-qa='btn-submit-application'], button[type='submit']"
    );
    if (btn && !btn.disabled) {
      return { success: false, requiresConfirm: true, text: btn.innerText || "Submit" };
    }
    return { success: false };
  },

  getJobContext() {
    const title = document.querySelector(".posting-headline h2, h2")?.innerText?.trim() || "";
    const company = document.querySelector(".main-header-logo img")?.alt?.trim() || "";
    const description = document.querySelector(
      ".posting-description, .section-wrapper"
    )?.innerText?.trim().slice(0, 2000) || "";
    return { title, company, description, url: window.location.href };
  }
};

// ── Seek (Australia) ───────────────────────────────────────
const SeekHandler = {
  name: "Seek",

  detect() {
    return window.location.hostname.includes("seek.com.au") ||
           window.location.hostname.includes("seek.co.nz");
  },

  async clickApply() {
    const selectors = [
      "a[data-automation='job-detail-apply']",
      "button[data-automation='job-detail-apply']",
      "[data-automation='apply-button']",
      "a[href*='apply']"
    ];
    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn) { btn.click(); await sleep(1500); return true; }
    }
    return false;
  },

  async getFields() {
    await sleep(800);
    return getAllFields();
  },

  async fillFields(fills) {
    return await genericFillFields(fills);
  },

  async clickNext() {
    const selectors = [
      "button[data-automation='navigate-next']",
      "button[type='submit']",
      "button[data-automation='review-application']"
    ];
    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn && !btn.disabled) {
        btn.click();
        await sleep(1500);
        return { success: true, text: btn.innerText.trim() };
      }
    }
    return { success: false };
  },

  getJobContext() {
    const title = document.querySelector("[data-automation='job-detail-title'], h1")
      ?.innerText?.trim() || "";
    const company = document.querySelector("[data-automation='advertiser-name']")
      ?.innerText?.trim() || "";
    const description = document.querySelector("[data-automation='jobAdDetails'], .jobAdDetails")
      ?.innerText?.trim().slice(0, 2000) || "";
    return { title, company, description, url: window.location.href };
  }
};

// ── Indeed ─────────────────────────────────────────────────
const IndeedHandler = {
  name: "Indeed",

  detect() {
    return window.location.hostname.includes("indeed.com") ||
           window.location.hostname.includes("indeed.com.au");
  },

  async getFields() {
    await sleep(600);
    return getAllFields();
  },

  async fillFields(fills) {
    return await genericFillFields(fills);
  },

  async clickNext() {
    const selectors = [
      "button[aria-label='Continue']",
      "#form-action-continue",
      "button.ia-continueButton",
      "button[type='submit']"
    ];
    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn && !btn.disabled) {
        btn.click();
        await sleep(1500);
        return { success: true, text: btn.innerText.trim() };
      }
    }
    return { success: false };
  },

  getJobContext() {
    const title = document.querySelector(".jobsearch-JobInfoHeader-title, h1")
      ?.innerText?.trim() || "";
    const company = document.querySelector("[data-testid='inlineHeader-companyName'] a, .icl-u-lg-mr--sm")
      ?.innerText?.trim() || "";
    const description = document.querySelector(
      "#jobDescriptionText, .jobsearch-jobDescriptionText"
    )?.innerText?.trim().slice(0, 2000) || "";
    return { title, company, description, url: window.location.href };
  }
};

// ── Generic handler (fallback for all other sites) ─────────
const GenericHandler = {
  name: "Generic",
  detect() { return true; },
  async getFields() { await sleep(300); return getAllFields(); },
  async fillFields(fills) { return await genericFillFields(fills); },
  async clickNext() {
    const candidates = [
      ...document.querySelectorAll("button[type='submit'], input[type='submit'], button")
    ].filter(b => {
      const text = (b.innerText || b.value || "").toLowerCase();
      return !b.disabled && b.offsetParent !== null &&
        (text.includes("next") || text.includes("continue") ||
         text.includes("submit") || text.includes("apply") ||
         text.includes("proceed") || text.includes("save"));
    });
    if (candidates.length > 0) {
      return { success: false, requiresConfirm: true, text: candidates[0].innerText.trim() };
    }
    return { success: false };
  },
  getJobContext() {
    const h1 = document.querySelector("h1")?.innerText?.trim() || "";
    const h2 = document.querySelector("h2")?.innerText?.trim() || "";
    const description = document.body.innerText.slice(0, 2000);
    return { title: h1 || h2, company: "", description, url: window.location.href };
  }
};

// ── Generic fill helper ─────────────────────────────────────
async function genericFillFields(fills) {
  const results = [];
  for (const fill of fills) {
    try {
      let el = null;

      // Try XPath
      try {
        const xr = document.evaluate(
          fill.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
        );
        el = xr.singleNodeValue;
      } catch (_) {}

      if (el) {
        const ok = await fillInput(el, fill.value);
        results.push({ xpath: fill.xpath, success: ok });
      } else {
        results.push({ xpath: fill.xpath, success: false, reason: "Element not found" });
      }

      await sleep(100);
    } catch (err) {
      results.push({ xpath: fill.xpath, success: false, reason: err.message });
    }
  }
  return results;
}

// ── Handler detector ────────────────────────────────────────
function getHandler() {
  const handlers = [
    LinkedInHandler,
    WorkdayHandler,
    GreenhouseHandler,
    LeverHandler,
    SeekHandler,
    IndeedHandler,
    GenericHandler
  ];

  for (const handler of handlers) {
    if (handler.detect()) {
      console.log(`[JobAgent] Using handler: ${handler.name}`);
      return handler;
    }
  }

  return GenericHandler;
}

// Export
window.ATSHandlers = {
  getHandler,
  getAllFields,
  fillInput,
  LinkedInHandler,
  WorkdayHandler,
  GreenhouseHandler,
  LeverHandler,
  SeekHandler,
  IndeedHandler,
  GenericHandler,
  sleep
};
