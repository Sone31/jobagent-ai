// ============================================================
// JobAgent AI — Playwright Stealth Agent
// Headless browser automation for job form submission
// ============================================================
const fs   = require("fs");
const path = require("path");

let playwrightExtra = null;
let stealthPlugin   = null;

// Try to load stealth — gracefully degrade if not installed
try {
  playwrightExtra = require("playwright-extra");
  stealthPlugin   = require("puppeteer-extra-plugin-stealth");
  playwrightExtra.use(stealthPlugin());
  console.log("[Playwright] Stealth plugin loaded ✅");
} catch (e) {
  console.warn("[Playwright] Stealth not available, using standard playwright:", e.message);
}

class PlaywrightAgent {
  constructor(wsServer) {
    this.ws      = wsServer;   // WebSocket server to broadcast status
    this.browser = null;
    this.context = null;
    this.running = false;
  }

  // ── Send status update to connected extension clients ─────
  broadcast(type, payload) {
    if (!this.ws) return;
    const msg = JSON.stringify({ type, payload, timestamp: new Date().toISOString() });
    this.ws.clients?.forEach(client => {
      if (client.readyState === 1) client.send(msg);
    });
  }

  // ── Launch or reuse browser ───────────────────────────────
  async getBrowser() {
    if (this.browser) {
      try { await this.browser.version(); return this.browser; } catch (_) { this.browser = null; }
    }

    const dataDir = path.join(__dirname, "../data/browser-profile");
    fs.mkdirSync(dataDir, { recursive: true });

    const launchOpts = {
      headless: false,          // Show browser so user can handle CAPTCHAs
      slowMo: 80,               // Human-like speed
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--window-size=1280,900"
      ]
    };

    if (playwrightExtra) {
      this.browser = await playwrightExtra.chromium.launch(launchOpts);
    } else {
      const { chromium } = require("playwright");
      this.browser = await chromium.launch(launchOpts);
    }

    return this.browser;
  }

  // ── Main: process a queued job application ────────────────
  async processJob(job, profile, apiKey, geminiModel, approvalCallback) {
    const db       = require("./database");
    const gemini   = require("./gemini-client");
    const pdfGen   = require("./pdf-generator");
    const { v4: uuidv4 } = require("uuid");
    const appId    = uuidv4();

    this.broadcast("STATUS", { jobId: job.id, appId, status: "starting", message: "🚀 Starting application..." });

    let page = null;
    try {
      // ── Step 1: Launch browser & navigate ─────────────────
      this.broadcast("STATUS", { jobId: job.id, status: "navigating", message: "🌐 Opening job page..." });
      const browser = await this.getBrowser();
      this.context  = this.context || await browser.newContext({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        viewport:  { width: 1280, height: 900 },
        locale:    "en-AU"
      });
      page = await this.context.newPage();

      // Anti-detection: remove webdriver flag
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
        window.chrome = { runtime: {} };
      });

      await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2000);

      // ── Step 2: Detect & click Apply button ───────────────
      this.broadcast("STATUS", { jobId: job.id, status: "applying", message: "👆 Clicking Apply..." });
      await this._clickApplyButton(page);
      await page.waitForTimeout(2000);

      // ── Step 3: Generate tailored resume PDF ──────────────
      this.broadcast("STATUS", { jobId: job.id, status: "resume", message: "📄 Generating tailored resume..." });
      let resumePath = null;
      try {
        const markdown = await gemini.tailorResumeMarkdown(apiKey, geminiModel, profile, job.jd_text || "");
        const pdfDir   = path.join(__dirname, "../data/resumes");
        fs.mkdirSync(pdfDir, { recursive: true });
        resumePath = path.join(pdfDir, `resume_${job.id}.pdf`);
        await pdfGen.generatePDF(markdown, profile, resumePath);
      } catch (pdfErr) {
        console.warn("[Agent] PDF generation failed:", pdfErr.message);
      }

      // ── Step 4: Scan form fields ──────────────────────────
      this.broadcast("STATUS", { jobId: job.id, status: "scanning", message: "🔍 Scanning form fields..." });
      const fields = await this._extractFields(page);
      this.broadcast("STATUS", { jobId: job.id, status: "ai_fill", message: `🤖 AI matching ${fields.length} fields...` });

      // ── Step 5: AI decides what to fill ───────────────────
      const fills  = await gemini.decideFieldFills(apiKey, geminiModel, profile, fields, job.jd_text || "");
      const validFills = fills.filter(f => f.value && f.value !== "null");

      // ── Step 6: Generate cover letter ─────────────────────
      let coverLetter = "";
      try {
        coverLetter = await gemini.generateCoverLetter(apiKey, geminiModel, profile, job.jd_text || "", job.title, job.company);
      } catch (clErr) { console.warn("[Agent] Cover letter failed:", clErr.message); }

      // ── Step 7: Save application + build diff ─────────────
      const diffData = {
        fills:       validFills,
        coverLetter,
        resumePath,
        fieldCount:  fields.length,
        fillCount:   validFills.length
      };

      db.createApplication({
        id: appId, jobId: job.id, profile,
        filledFields: validFills, resumePath, coverLetter, diffData
      });

      // ── Step 8: Send diff to extension for approval ───────
      this.broadcast("DIFF_REVIEW", {
        jobId:      job.id,
        appId,
        jobTitle:   job.title,
        company:    job.company,
        fills:      validFills,
        coverLetter,
        resumePath: resumePath ? path.basename(resumePath) : null,
        fieldCount: fields.length,
        fillCount:  validFills.length
      });

      this.broadcast("STATUS", { jobId: job.id, status: "awaiting_approval", message: "⏳ Waiting for your approval..." });

      // ── Step 9: Wait for user approval (30 min timeout) ───
      const approved = await approvalCallback(appId, 1800000);
      if (!approved) {
        this.broadcast("STATUS", { jobId: job.id, status: "rejected", message: "❌ Application rejected by user" });
        db.updateJobStatus(job.id, "rejected");
        await page.close();
        return { success: false, reason: "User rejected" };
      }

      // ── Step 10: Fill fields ───────────────────────────────
      this.broadcast("STATUS", { jobId: job.id, status: "filling", message: `✍️ Filling ${validFills.length} fields...` });
      let fillCount = 0;
      for (const fill of validFills) {
        try {
          await this._fillField(page, fill);
          fillCount++;
          await page.waitForTimeout(150 + Math.random() * 200);
        } catch (e) { console.warn("[Agent] Fill error:", fill.fieldName, e.message); }
      }

      // Upload resume PDF if found
      if (resumePath) {
        await this._uploadResume(page, resumePath);
      }

      // Fill cover letter text areas
      if (coverLetter) {
        await this._fillCoverLetterField(page, coverLetter);
      }

      this.broadcast("STATUS", { jobId: job.id, status: "filled", message: `✅ Filled ${fillCount} fields. Ready to submit.` });

      // ── Step 11: Check for CAPTCHA ─────────────────────────
      const hasCaptcha = await this._detectCaptcha(page);
      if (hasCaptcha) {
        this.broadcast("CAPTCHA", { jobId: job.id, message: "🔒 CAPTCHA detected! Please solve it in the browser window, then click Continue in the extension." });
        // Wait for user to solve (10 min)
        await page.waitForTimeout(600000).catch(() => {});
      }

      // ── Step 12: Handle multi-step pagination ─────────────
      let stepCount = 0;
      while (stepCount < 10) {
        const nextBtn = await this._findNextButton(page);
        if (!nextBtn) break;

        const btnText = await nextBtn.innerText().catch(() => "");
        const isSubmit = /submit|send|apply|complete/i.test(btnText);

        if (isSubmit) {
          this.broadcast("STATUS", { jobId: job.id, status: "submitting", message: "📤 Submitting application..." });
          await nextBtn.click();
          await page.waitForTimeout(3000);
          break;
        } else {
          this.broadcast("STATUS", { jobId: job.id, status: "next_step", message: `⏭️ Moving to step ${stepCount + 2}...` });
          await nextBtn.click();
          await page.waitForTimeout(2500);
          // Re-scan and fill new fields
          const newFields = await this._extractFields(page);
          if (newFields.length > 0) {
            const newFills = await gemini.decideFieldFills(apiKey, geminiModel, profile, newFields, job.jd_text || "");
            for (const fill of newFills.filter(f => f.value)) {
              try { await this._fillField(page, fill); await page.waitForTimeout(120); } catch (_) {}
            }
          }
        }
        stepCount++;
      }

      // ── Step 13: Mark submitted ────────────────────────────
      db.markSubmitted(appId);
      db.updateJobStatus(job.id, "submitted");
      this.broadcast("STATUS", { jobId: job.id, appId, status: "submitted", message: "🎉 Application submitted!" });

      await page.waitForTimeout(2000);
      await page.close();
      return { success: true, appId, fillCount };

    } catch (err) {
      console.error("[Agent] Error:", err);
      db.updateJobStatus(job.id, "error");
      this.broadcast("STATUS", { jobId: job.id, status: "error", message: `❌ Error: ${err.message}` });
      if (page) await page.close().catch(() => {});
      return { success: false, error: err.message };
    }
  }

  // ── Click Apply button ────────────────────────────────────
  async _clickApplyButton(page) {
    const selectors = [
      ".jobs-apply-button", "button[aria-label*='Easy Apply']",
      "button[aria-label*='Apply']", "[data-automation='job-detail-apply']",
      ".indeed-apply-button", "#indeedApplyButton", "a[href*='/apply']",
      "button:has-text('Apply')", "button:has-text('Easy Apply')"
    ];
    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (el && await el.isVisible()) { await el.click(); return true; }
      } catch (_) {}
    }
    return false;
  }

  // ── Extract form fields from page ─────────────────────────
  async _extractFields(page) {
    return await page.evaluate(() => {
      const fields = [];
      const seen   = new Set();
      const inputs = document.querySelectorAll(
        "input:not([type='hidden']):not([type='submit']):not([type='button']):not([disabled])," +
        "textarea:not([disabled]), select:not([disabled])"
      );

      inputs.forEach((el, i) => {
        if (seen.has(el)) return;
        seen.add(el);

        let label = el.getAttribute("aria-label") || "";
        if (!label && el.id) {
          const lbl = document.querySelector(`label[for="${el.id}"]`);
          if (lbl) label = lbl.innerText.replace(/\*/g, "").trim();
        }
        if (!label) label = el.placeholder || el.name || "";

        const xpath = el.id ? `//*[@id="${el.id}"]` :
          `(//${el.tagName.toLowerCase()})[${i + 1}]`;

        const options = el.tagName === "SELECT"
          ? [...el.options].map(o => o.text)
          : [];

        if (label) {
          fields.push({
            xpath, label: label.slice(0, 100),
            name: el.name || "", type: el.type || el.tagName.toLowerCase(),
            value: el.value || "", options, required: el.required || false
          });
        }
      });
      return fields;
    });
  }

  // ── Fill a single field ───────────────────────────────────
  async _fillField(page, fill) {
    const { xpath, value } = fill;
    try {
      const el = page.locator(`xpath=${xpath}`).first();
      if (!await el.isVisible().catch(() => false)) return false;

      const tagName = await el.evaluate(e => e.tagName).catch(() => "INPUT");
      const type    = await el.getAttribute("type").catch(() => "text");

      if (tagName === "SELECT") {
        await el.selectOption({ label: value }).catch(() =>
          el.selectOption({ value }).catch(() => {})
        );
      } else if (type === "checkbox" || type === "radio") {
        const shouldCheck = ["yes","true","1"].includes(String(value).toLowerCase());
        if (shouldCheck) await el.check().catch(() => {});
      } else {
        await el.click();
        await el.fill("").catch(() => {});
        await el.fill(String(value));
        await el.dispatchEvent("input");
        await el.dispatchEvent("change");
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  // ── Upload resume PDF ─────────────────────────────────────
  async _uploadResume(page, resumePath) {
    try {
      const fileInputs = await page.$$("input[type='file']");
      if (fileInputs.length > 0) {
        await fileInputs[0].setInputFiles(resumePath);
        console.log("[Agent] Resume uploaded:", path.basename(resumePath));
        return true;
      }
    } catch (e) { console.warn("[Agent] Resume upload failed:", e.message); }
    return false;
  }

  // ── Fill cover letter field ───────────────────────────────
  async _fillCoverLetterField(page, coverLetter) {
    const selectors = [
      "textarea[name*='cover']", "textarea[name*='letter']",
      "textarea[aria-label*='cover']", "textarea[aria-label*='letter']",
      "textarea[placeholder*='cover']", "textarea[placeholder*='letter']"
    ];
    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (el && await el.isVisible()) {
          await el.fill(coverLetter);
          return true;
        }
      } catch (_) {}
    }
    return false;
  }

  // ── Detect CAPTCHA ────────────────────────────────────────
  async _detectCaptcha(page) {
    const captchaSelectors = [
      "iframe[src*='recaptcha']", "iframe[src*='hcaptcha']",
      ".g-recaptcha", ".h-captcha", "#captcha",
      "[class*='captcha']", "[id*='captcha']"
    ];
    for (const sel of captchaSelectors) {
      const el = await page.$(sel).catch(() => null);
      if (el) return true;
    }
    // Check title
    const title = await page.title().catch(() => "");
    return /captcha|robot|human|verify/i.test(title);
  }

  // ── Find Next/Submit button ───────────────────────────────
  async _findNextButton(page) {
    const selectors = [
      "button[aria-label*='Continue']", "button[aria-label*='Next']",
      "button[aria-label*='Submit']", "button[aria-label*='Review']",
      ".artdeco-button--primary", "button[type='submit']",
      "button:has-text('Next')", "button:has-text('Continue')",
      "button:has-text('Submit')", "button:has-text('Review')",
      "button:has-text('Apply')", "input[type='submit']"
    ];
    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (el && await el.isVisible() && !await el.isDisabled()) return el;
      } catch (_) {}
    }
    return null;
  }

  // ── Close browser ─────────────────────────────────────────
  async close() {
    if (this.browser) { await this.browser.close().catch(() => {}); this.browser = null; }
  }
}

module.exports = PlaywrightAgent;
