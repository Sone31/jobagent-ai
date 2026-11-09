// ============================================================
// JobAgent AI — Job Match Score Overlay
// Injects a live match badge directly onto job listing pages
// ============================================================

(function () {
  if (window.__jobAgentOverlayInjected) return;
  window.__jobAgentOverlayInjected = true;

  const OVERLAY_ID  = "__jobagent_match_overlay";
  const STYLE_ID    = "__jobagent_overlay_styles";
  let   currentUrl  = "";
  let   isScoring   = false;

  // ── Inject CSS once ────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${OVERLAY_ID} {
        position: fixed;
        bottom: 80px;
        right: 20px;
        z-index: 2147483646;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        animation: __ja_slideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
        user-select: none;
      }
      @keyframes __ja_slideIn {
        from { transform: translateX(120px); opacity: 0; }
        to   { transform: translateX(0);     opacity: 1; }
      }
      #${OVERLAY_ID} .ja-card {
        background: #ffffff;
        border-radius: 14px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.1);
        overflow: hidden;
        width: 220px;
        border: 1px solid #e5e7eb;
      }
      #${OVERLAY_ID} .ja-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px 8px;
        background: linear-gradient(135deg, #5b21b6, #7c3aed);
        color: white;
      }
      #${OVERLAY_ID} .ja-brand {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.3px;
        display: flex;
        align-items: center;
        gap: 5px;
      }
      #${OVERLAY_ID} .ja-close {
        background: rgba(255,255,255,0.2);
        border: none;
        color: white;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        cursor: pointer;
        font-size: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        padding: 0;
      }
      #${OVERLAY_ID} .ja-close:hover { background: rgba(255,255,255,0.35); }
      #${OVERLAY_ID} .ja-body { padding: 12px; }

      /* Score ring */
      #${OVERLAY_ID} .ja-score-row {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 10px;
      }
      #${OVERLAY_ID} .ja-ring-wrap {
        position: relative;
        width: 58px;
        height: 58px;
        flex-shrink: 0;
      }
      #${OVERLAY_ID} .ja-ring-wrap svg { transform: rotate(-90deg); }
      #${OVERLAY_ID} .ja-ring-bg  { fill: none; stroke: #f3f4f6; stroke-width: 5; }
      #${OVERLAY_ID} .ja-ring-fg  {
        fill: none; stroke-width: 5; stroke-linecap: round;
        transition: stroke-dashoffset 1s ease, stroke 0.5s ease;
      }
      #${OVERLAY_ID} .ja-ring-text {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
      }
      #${OVERLAY_ID} .ja-pct {
        font-size: 15px;
        font-weight: 800;
        line-height: 1;
      }
      #${OVERLAY_ID} .ja-pct-sym {
        font-size: 9px;
        font-weight: 600;
        color: #6b7280;
        margin-top: 1px;
      }
      #${OVERLAY_ID} .ja-verdict {
        font-size: 13px;
        font-weight: 700;
        color: #1f2937;
        margin-bottom: 2px;
      }
      #${OVERLAY_ID} .ja-verdict-sub {
        font-size: 10px;
        color: #6b7280;
        line-height: 1.4;
      }

      /* Strengths / Gaps */
      #${OVERLAY_ID} .ja-section-title {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        color: #9ca3af;
        margin-bottom: 4px;
      }
      #${OVERLAY_ID} .ja-pill-wrap {
        display: flex;
        flex-wrap: wrap;
        gap: 3px;
        margin-bottom: 8px;
      }
      #${OVERLAY_ID} .ja-pill {
        font-size: 9.5px;
        padding: 2px 7px;
        border-radius: 99px;
        font-weight: 500;
      }
      #${OVERLAY_ID} .ja-pill-green { background: #dcfce7; color: #15803d; }
      #${OVERLAY_ID} .ja-pill-red   { background: #fee2e2; color: #b91c1c; }
      #${OVERLAY_ID} .ja-pill-gray  { background: #f3f4f6; color: #6b7280; }

      /* Recommendation */
      #${OVERLAY_ID} .ja-reco {
        background: #ede9fe;
        border-radius: 7px;
        padding: 7px 9px;
        font-size: 10.5px;
        color: #5b21b6;
        line-height: 1.45;
        margin-bottom: 10px;
      }

      /* Apply button */
      #${OVERLAY_ID} .ja-apply-btn {
        width: 100%;
        background: #7c3aed;
        color: white;
        border: none;
        border-radius: 8px;
        padding: 8px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        transition: background 0.15s;
        font-family: inherit;
      }
      #${OVERLAY_ID} .ja-apply-btn:hover { background: #5b21b6; }

      /* Loading state */
      #${OVERLAY_ID} .ja-loading {
        padding: 16px 12px;
        display: flex;
        align-items: center;
        gap: 10px;
        color: #6b7280;
        font-size: 11.5px;
      }
      #${OVERLAY_ID} .ja-spinner {
        width: 18px; height: 18px;
        border: 2px solid #e5e7eb;
        border-top-color: #7c3aed;
        border-radius: 50%;
        animation: __ja_spin 0.7s linear infinite;
        flex-shrink: 0;
      }
      @keyframes __ja_spin { to { transform: rotate(360deg); } }

      /* Error state */
      #${OVERLAY_ID} .ja-error {
        padding: 12px;
        font-size: 11px;
        color: #dc2626;
        background: #fee2e2;
        border-radius: 8px;
        margin: 8px;
        text-align: center;
      }

      /* Collapsed mini pill */
      #${OVERLAY_ID}.ja-collapsed .ja-card {
        width: auto;
        border-radius: 20px;
      }
      #${OVERLAY_ID} .ja-mini {
        display: none;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        cursor: pointer;
        background: linear-gradient(135deg, #5b21b6, #7c3aed);
        border-radius: 20px;
        color: white;
        font-size: 12px;
        font-weight: 700;
      }
      #${OVERLAY_ID}.ja-collapsed .ja-mini { display: flex; }
      #${OVERLAY_ID}.ja-collapsed .ja-card > *:not(.ja-mini) { display: none; }
    `;
    document.head.appendChild(style);
  }

  // ── Score colour helper ─────────────────────────────────────
  function scoreColor(pct) {
    if (pct >= 80) return { stroke:"#16a34a", text:"#15803d", bg:"#dcfce7" };
    if (pct >= 60) return { stroke:"#2563eb", text:"#1d4ed8", bg:"#dbeafe" };
    if (pct >= 40) return { stroke:"#d97706", text:"#b45309", bg:"#fef3c7" };
    return { stroke:"#dc2626", text:"#b91c1c", bg:"#fee2e2" };
  }

  // ── Create / update overlay ─────────────────────────────────
  function showOverlay(state = "loading", data = {}) {
    injectStyles();

    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = OVERLAY_ID;
      document.body.appendChild(overlay);
    }

    if (state === "loading") {
      overlay.innerHTML = `
        <div class="ja-card">
          <div class="ja-header">
            <div class="ja-brand">🤖 JobAgent AI</div>
            <button class="ja-close" onclick="document.getElementById('${OVERLAY_ID}').remove()">✕</button>
          </div>
          <div class="ja-loading">
            <div class="ja-spinner"></div>
            Calculating match score...
          </div>
        </div>`;
      return;
    }

    if (state === "error") {
      overlay.innerHTML = `
        <div class="ja-card">
          <div class="ja-header">
            <div class="ja-brand">🤖 JobAgent AI</div>
            <button class="ja-close" onclick="document.getElementById('${OVERLAY_ID}').remove()">✕</button>
          </div>
          <div class="ja-error">⚠️ ${data.message || "Could not calculate score"}</div>
        </div>`;
      return;
    }

    if (state === "result") {
      const { matchScore, verdict, strengths = [], gaps = [], recommendation = "" } = data;
      const col = scoreColor(matchScore);
      const circumference = 2 * Math.PI * 22; // r=22
      const offset = circumference * (1 - matchScore / 100);

      const strengthPills = strengths.slice(0, 3).map(s =>
        `<span class="ja-pill ja-pill-green">✓ ${escStr(s.slice(0, 22))}</span>`
      ).join("");

      const gapPills = gaps.slice(0, 2).map(g =>
        `<span class="ja-pill ja-pill-red">✗ ${escStr(g.slice(0, 22))}</span>`
      ).join("");

      overlay.innerHTML = `
        <div class="ja-card">
          <div class="ja-header">
            <div class="ja-brand">🤖 JobAgent AI</div>
            <button class="ja-close" onclick="document.getElementById('${OVERLAY_ID}').remove()">✕</button>
          </div>
          <div class="ja-body">
            <div class="ja-score-row">
              <div class="ja-ring-wrap">
                <svg width="58" height="58" viewBox="0 0 58 58">
                  <circle class="ja-ring-bg" cx="29" cy="29" r="22"/>
                  <circle class="ja-ring-fg" cx="29" cy="29" r="22"
                    stroke="${col.stroke}"
                    stroke-dasharray="${circumference}"
                    stroke-dashoffset="${offset}"
                  />
                </svg>
                <div class="ja-ring-text">
                  <span class="ja-pct" style="color:${col.text}">${matchScore}</span>
                  <span class="ja-pct-sym">%</span>
                </div>
              </div>
              <div>
                <div class="ja-verdict">${verdict}</div>
                <div class="ja-verdict-sub">${matchScore >= 75 ? "Strong match! Apply now." : matchScore >= 50 ? "Decent fit. Apply with tailoring." : "Some gaps. Review before applying."}</div>
              </div>
            </div>

            ${strengths.length > 0 ? `
            <div class="ja-section-title">✅ Your Strengths</div>
            <div class="ja-pill-wrap">${strengthPills}</div>` : ""}

            ${gaps.length > 0 ? `
            <div class="ja-section-title">⚠️ Gaps</div>
            <div class="ja-pill-wrap">${gapPills}</div>` : ""}

            ${recommendation ? `<div class="ja-reco">💡 ${escStr(recommendation)}</div>` : ""}

            <button class="ja-apply-btn" onclick="window.__jobAgentTriggerApply()">
              ⚡ Auto-Fill & Apply
            </button>
          </div>
        </div>
        <div class="ja-mini" onclick="document.getElementById('${OVERLAY_ID}').classList.remove('ja-collapsed')">
          <span style="color:${col.text};background:${col.bg};padding:1px 7px;border-radius:10px;font-size:11px">${matchScore}%</span>
          JobAgent AI
        </div>`;

      // Click "Auto-Fill & Apply" opens the sidebar
      window.__jobAgentTriggerApply = () => {
        chrome.runtime.sendMessage({
          type: "FROM_CONTENT",
          action: "TRIGGER_AUTOFILL"
        });
      };
    }
  }

  function removeOverlay() {
    document.getElementById(OVERLAY_ID)?.remove();
  }

  function escStr(s) {
    return String(s||"")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  // ── Extract job context from current page ───────────────────
  function getJobContext() {
    const hostname = window.location.hostname;

    // LinkedIn
    if (hostname.includes("linkedin.com")) {
      const title = document.querySelector(
        ".job-details-jobs-unified-top-card__job-title h1, .jobs-unified-top-card__job-title, h1"
      )?.innerText?.trim() || document.title;
      const company = document.querySelector(
        ".job-details-jobs-unified-top-card__company-name a, .jobs-unified-top-card__company-name"
      )?.innerText?.trim() || "";
      const description = document.querySelector(
        ".jobs-description__content, .jobs-description-content, #job-details"
      )?.innerText?.trim().slice(0, 2500) || "";
      return { title, company, description };
    }

    // Indeed
    if (hostname.includes("indeed.com")) {
      const title = document.querySelector(".jobsearch-JobInfoHeader-title, h1")?.innerText?.trim() || document.title;
      const company = document.querySelector("[data-testid='inlineHeader-companyName'] a")?.innerText?.trim() || "";
      const description = document.querySelector("#jobDescriptionText, .jobsearch-jobDescriptionText")?.innerText?.trim().slice(0, 2500) || "";
      return { title, company, description };
    }

    // Seek
    if (hostname.includes("seek.com")) {
      const title = document.querySelector("[data-automation='job-detail-title'], h1")?.innerText?.trim() || document.title;
      const company = document.querySelector("[data-automation='advertiser-name']")?.innerText?.trim() || "";
      const description = document.querySelector("[data-automation='jobAdDetails'], .jobAdDetails")?.innerText?.trim().slice(0, 2500) || "";
      return { title, company, description };
    }

    // Glassdoor
    if (hostname.includes("glassdoor.com")) {
      const title = document.querySelector("[data-test='job-title'], h1")?.innerText?.trim() || document.title;
      const company = document.querySelector("[data-test='employer-name']")?.innerText?.trim() || "";
      const description = document.querySelector("[data-test='jobDescriptionContent'], .jobDescriptionContent")?.innerText?.trim().slice(0, 2500) || "";
      return { title, company, description };
    }

    // Generic fallback
    const title = document.querySelector("h1")?.innerText?.trim() || document.title;
    const description = document.body.innerText.slice(0, 2500);
    return { title, company: "", description };
  }

  // ── Check if current page is a job listing ──────────────────
  function isJobListingPage() {
    const url = window.location.href;
    const patterns = [
      /linkedin\.com\/jobs\/view\//,
      /linkedin\.com\/jobs\/collections\//,
      /indeed\.com\/viewjob/,
      /indeed\.com\/m\/viewjob/,
      /seek\.com\.au\/job\//,
      /seek\.com\.nz\/job\//,
      /glassdoor\.com\/job-listing\//,
      /glassdoor\.com\/Job\//,
      /jobs\.lever\.co\//,
      /boards\.greenhouse\.io\//,
      /myworkdayjobs\.com\//,
      /wd\d+\.myworkday\.com\//,
      /ashbyhq\.com\/.*\/posting\//,
    ];
    return patterns.some(p => p.test(url));
  }

  // ── Main: request score from sidepanel ─────────────────────
  async function requestMatchScore() {
    if (isScoring) return;
    if (!isJobListingPage()) return;

    const ctx = getJobContext();
    if (!ctx.description || ctx.description.length < 100) return;

    isScoring = true;
    showOverlay("loading");

    // Send job context to background → sidepanel calculates score
    chrome.runtime.sendMessage({
      type: "FROM_CONTENT",
      action: "REQUEST_MATCH_SCORE",
      payload: {
        title:       ctx.title,
        company:     ctx.company,
        description: ctx.description,
        url:         window.location.href
      }
    });
  }

  // ── Listen for score result from background ─────────────────
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== "TO_CONTENT") return;

    if (message.action === "MATCH_SCORE_RESULT") {
      isScoring = false;
      if (message.payload?.error) {
        showOverlay("error", { message: message.payload.error });
      } else {
        showOverlay("result", message.payload);
      }
    }

    if (message.action === "REMOVE_OVERLAY") {
      removeOverlay();
      isScoring = false;
    }

    if (message.action === "SHOW_OVERLAY_LOADING") {
      showOverlay("loading");
      isScoring = true;
    }
  });

  // ── Watch for URL changes (SPA navigation) ─────────────────
  let navTimer = null;
  function onUrlChange() {
    const newUrl = window.location.href;
    if (newUrl === currentUrl) return;
    currentUrl = newUrl;
    isScoring = false;
    removeOverlay();

    // Debounce — wait for page content to load
    clearTimeout(navTimer);
    navTimer = setTimeout(() => {
      if (isJobListingPage()) {
        requestMatchScore();
      }
    }, 2500);
  }

  // Observe URL changes in SPAs (LinkedIn, Indeed etc.)
  const urlObserver = new MutationObserver(onUrlChange);
  urlObserver.observe(document.body, { childList: true, subtree: true });

  // Also catch history API changes
  const originalPushState = history.pushState;
  history.pushState = function(...args) {
    originalPushState.apply(this, args);
    setTimeout(onUrlChange, 100);
  };
  window.addEventListener("popstate", () => setTimeout(onUrlChange, 100));

  // Initial check on page load
  setTimeout(() => {
    currentUrl = window.location.href;
    if (isJobListingPage()) requestMatchScore();
  }, 2000);

})();
