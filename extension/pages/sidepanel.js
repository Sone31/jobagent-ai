// ============================================================
// JobAgent AI v3.1 — Sidepanel
// Clean rewrite: fixes profile save, resume parse, auto-fill
// ============================================================

// ══════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════
const S = {
  profile:  null,
  settings: {
    geminiKey:"", geminiModel:"gemini-3.6-flash",
    groqKey:"",   groqModel:"llama-4-maverick-17b-128e-instruct",
    orKey:"",     orModel:"meta-llama/llama-3.3-70b-instruct:free",
    confirmBeforeSubmit:true, highlightFields:true,
    skipLow:false, autoScroll:true
  },
  page:        null,   // current page context
  fields:      [],     // last scanned fields
  fills:       [],     // last AI fills
  applications:[],     // tracker
  busy:        false,
  backendOnline:false,
  diffAppId:   null,
  lastScore:   null
};

// ══════════════════════════════════════════════════
// STORAGE — simple wrappers, never fail silently
// ══════════════════════════════════════════════════
async function dbSet(key, val) {
  return new Promise(r => chrome.storage.local.set({ [key]: val }, r));
}
async function dbGet(key) {
  return new Promise(r => chrome.storage.local.get([key], res => r(res[key])));
}
async function dbClear() {
  return new Promise(r => chrome.storage.local.clear(r));
}

// ══════════════════════════════════════════════════
// BOOT — load everything from storage
// ══════════════════════════════════════════════════
async function boot() {
  const [profile, settings, apps] = await Promise.all([
    dbGet("profile"), dbGet("settings"), dbGet("applications")
  ]);

  if (profile)   { S.profile = profile; fillProfileForm(profile); }
  if (settings)  { S.settings = { ...S.settings, ...settings }; applySettingsUI(); }
  if (apps)      { S.applications = apps; }

  renderTrackerStats();
  renderTrackerList();
  updateProviderStatus();
  getPage().catch(() => {});
}

// ══════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════
function toast(msg, type = "default", ms = 3500) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "on" + (type !== "default" ? ` t-${type.slice(0,2)}` : "");
  setTimeout(() => { el.className = ""; }, ms);
}

function setStatus(msg, type = "info", show = true) {
  const el = document.getElementById("apply-status");
  if (!show) { el.style.display = "none"; return; }
  el.className = `alert a-${type}`;
  el.innerHTML = msg;
  el.style.display = "block";
}

function setProgress(pct, label) {
  document.getElementById("prog-card").style.display = "block";
  document.getElementById("prog-bar").style.width = pct + "%";
  document.getElementById("prog-pct").textContent  = pct + "%";
  document.getElementById("prog-label").textContent = label;
}
function hideProgress() { document.getElementById("prog-card").style.display = "none"; }

function esc(s) {
  return String(s || "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function fmtDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso), now = new Date();
    const diff = Math.floor((now - d) / 86400000);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    if (diff < 7)  return `${diff}d ago`;
    return d.toLocaleDateString("en-AU", { day:"numeric", month:"short" });
  } catch { return ""; }
}

// ══════════════════════════════════════════════════
// PAGE MESSAGING — always ping first to confirm
// ══════════════════════════════════════════════════
function msg(action, payload = {}, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${action}`)), timeout);
    chrome.runtime.sendMessage({ type: "FROM_SIDEPANEL", action, payload }, res => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (res?.error) return reject(new Error(res.error));
      resolve(res || {});
    });
  });
}

async function ping() {
  try { await msg("PING", {}, 3000); return true; }
  catch { return false; }
}

// ══════════════════════════════════════════════════
// PAGE CONTEXT
// ══════════════════════════════════════════════════
async function getPage() {
  const ok = await ping();
  if (!ok) {
    document.getElementById("pg-title").textContent = "No page connected";
    document.getElementById("pg-url").textContent   = "Navigate to a job listing";
    return null;
  }
  const res = await msg("GET_PAGE_TEXT");
  if (res?.context) {
    S.page = res.context;
    updatePageUI(res.context);
  }
  return res?.context || null;
}

const PLATFORMS = [
  { re:/linkedin\.com/,   name:"LinkedIn",    col:"#0077b5" },
  { re:/seek\.com/,       name:"Seek",        col:"#e60278" },
  { re:/indeed\.com/,     name:"Indeed",      col:"#003a9b" },
  { re:/glassdoor\.com/,  name:"Glassdoor",   col:"#0caa41" },
  { re:/myworkdayjobs|wd\d\.myworkday/, name:"Workday",   col:"#cc3300" },
  { re:/greenhouse\.io/,  name:"Greenhouse",  col:"#3d9c49" },
  { re:/lever\.co/,       name:"Lever",       col:"#6633cc" },
  { re:/ashbyhq\.com/,    name:"Ashby",       col:"#8b5cf6" },
];

function detectPlatform(url) {
  for (const p of PLATFORMS) { if (p.re.test(url || "")) return p; }
  return null;
}

function platformName(url) {
  const p = detectPlatform(url);
  return p ? p.name : "Other";
}

function updatePageUI(ctx) {
  const title = ctx.title || "Unknown";
  const url   = ctx.url   || "";
  document.getElementById("pg-title").textContent = title.slice(0, 52);
  try { document.getElementById("pg-url").textContent = new URL(url).hostname; } catch { }

  const p = detectPlatform(url);
  const pt = document.getElementById("pg-platform");
  const hp = document.getElementById("hplatform");
  const hs = document.getElementById("hsub");
  if (p) {
    pt.textContent = hp.textContent = p.name;
    pt.style.background = hp.style.background = p.col;
    pt.style.display = hp.style.display = "inline-block";
    hs.textContent = `Detected: ${p.name}`;
  } else {
    pt.style.display = hp.style.display = "none";
    hs.textContent = "Auto-fill job applications";
  }
}

// ══════════════════════════════════════════════════
// AI SETTINGS
// ══════════════════════════════════════════════════
function aiSettings() {
  return {
    geminiKey:   S.settings.geminiKey,
    geminiModel: S.settings.geminiModel,
    groqKey:     S.settings.groqKey,
    groqModel:   S.settings.groqModel,
    orKey:       S.settings.orKey,
    orModel:     S.settings.orModel,
    // normalise for ai-client.js
    openrouterKey:   S.settings.orKey,
    openrouterModel: S.settings.orModel
  };
}

function hasKey() {
  return !!(S.settings.geminiKey || S.settings.groqKey || S.settings.orKey);
}

// ══════════════════════════════════════════════════
// CORE: SCAN & AUTO-FILL (the main flow)
// ══════════════════════════════════════════════════
async function doScanAndFill() {
  if (S.busy) return;

  // Guards
  if (!hasKey()) {
    setStatus("⚠️ Add an API key in <strong>Settings</strong> tab first.", "warn");
    return;
  }
  if (!S.profile?.fullName || !S.profile?.email) {
    setStatus("⚠️ Complete your <strong>Profile</strong> tab first (at least name + email).", "warn");
    return;
  }

  S.busy = true;
  setStatus("", "info", false);
  hideProgress();

  try {
    // ── Step 0: Confirm content script is alive ────────────
    setProgress(5, "Connecting to page...");
    const alive = await ping();
    if (!alive) {
      setStatus("❌ Cannot reach this page. Refresh the page and try again.", "err");
      return;
    }

    // ── Step 1: Get page context ───────────────────────────
    setProgress(12, "Reading job description...");
    const ctxRes = await msg("GET_PAGE_TEXT");
    S.page = ctxRes?.context || null;
    if (S.page) updatePageUI(S.page);

    // ── Step 2: Scan fields ────────────────────────────────
    setProgress(22, "Scanning form fields...");
    const scanRes = await msg("SCAN_PAGE");
    S.fields = scanRes?.fields || [];

    // If no fields found, try clicking Apply first
    if (S.fields.length === 0) {
      setProgress(28, "No fields found — clicking Apply button...");
      await msg("CLICK_APPLY", {}, 5000).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));

      const scan2 = await msg("SCAN_PAGE");
      S.fields = scan2?.fields || [];
    }

    if (S.fields.length === 0) {
      setStatus(`⚠️ No form fields found on this page.<br><br>
        <strong>Try:</strong><br>
        1. Click the <strong>Apply</strong> or <strong>Easy Apply</strong> button on the job listing first<br>
        2. Wait for the form to open<br>
        3. Click <strong>Scan &amp; Auto-Fill</strong> again`, "warn");
      return;
    }

    // Toast on page
    msg("SHOW_TOAST", { message: `Found ${S.fields.length} fields — AI filling...`, type: "info" }).catch(() => {});

    // ── Step 3: AI decides fills ───────────────────────────
    setProgress(45, `AI matching ${S.fields.length} fields to your profile...`);

    let fills = [];
    try {
      fills = await AIClient.aiDecideFields(
        aiSettings(), S.profile, S.fields,
        S.page, []
      );
    } catch (aiErr) {
      setStatus(`❌ AI error: ${aiErr.message}`, "err");
      return;
    }

    // Filter fills
    const validFills = (S.settings.skipLow
      ? fills.filter(f => f.confidence !== "low")
      : fills
    ).filter(f => f.value && String(f.value) !== "null" && String(f.value).trim() !== "");

    S.fills = validFills;

    if (validFills.length === 0) {
      setStatus("🤔 AI couldn't match your profile to these fields. Make sure your profile has your name, email, work title, and experience filled in.", "warn");
      return;
    }

    // ── Step 4: Fill fields ────────────────────────────────
    setProgress(68, `Filling ${validFills.length} fields...`);
    const fillRes = await msg("FILL_FIELDS", {
      fills: validFills.map(f => ({ xpath: f.xpath, value: f.value, fieldName: f.fieldName }))
    });
    const results = fillRes?.results || [];
    const ok = results.filter(r => r.success).length;

    // ── Step 5: Auto-generate cover letter if there are text areas ──
    const hasTextArea = S.fields.some(f => f.type === "textarea");
    const hasClField  = S.fields.some(f =>
      /cover.?letter|covering.?letter/i.test(f.label || "")
    );

    setProgress(80, "Generating cover letter...");
    let clText = "";
    if (hasClField && S.page?.jobDesc) {
      try {
        const jobCtx = `${S.page.title || ""} at ${S.page.company || ""}. ${S.page.jobDesc?.slice(0, 1500) || ""}`;
        clText = await AIClient.aiCoverLetter(aiSettings(), S.profile, jobCtx);
        // Show cover letter
        document.getElementById("cl-card").style.display = "block";
        document.getElementById("cl-out").value = clText;

        // Try to fill CL field
        const clField = S.fields.find(f => /cover.?letter/i.test(f.label || ""));
        if (clField) {
          await msg("FILL_FIELDS", { fills: [{ xpath: clField.xpath, value: clText }] });
        }
      } catch (clErr) {
        console.warn("[JobAgent] CL failed:", clErr.message);
      }
    }

    // ── Step 6: Auto match score ───────────────────────────
    setProgress(90, "Calculating match score...");
    if (S.page?.jobDesc && S.page.jobDesc.length > 80) {
      try {
        const score = await AIClient.aiMatchScore(
          aiSettings(), S.profile,
          S.page.jobDesc, S.page.title || "", S.page.company || ""
        );
        S.lastScore = score.matchScore;
        // Show score in status
        const col = score.matchScore >= 75 ? "🟢" : score.matchScore >= 50 ? "🟡" : "🔴";
        setProgress(100, `Done! Match: ${col} ${score.matchScore}%`);
      } catch { setProgress(100, "Done!"); }
    } else {
      setProgress(100, "Done!");
    }

    // ── Step 7: Show results ───────────────────────────────
    renderFieldList(S.fields, validFills, results);

    const msg2 = `✅ Filled <strong>${ok} of ${validFills.length} fields</strong>.`
      + (S.lastScore ? ` Match score: <strong>${S.lastScore}%</strong>.` : "")
      + (ok < validFills.length ? " Some fields may need manual input." : "")
      + "<br><br>Review the form, then click <strong>Next Step</strong> when ready.";
    setStatus(msg2, "ok");

    // Page toast
    msg("SHOW_TOAST", { message: `Filled ${ok}/${validFills.length} fields!`, type: "success" }).catch(() => {});
    toast(`✅ Filled ${ok} fields!`, "ok");

    // Auto-log to tracker
    autoLog();

  } catch (err) {
    console.error("[JobAgent] Fill error:", err);
    setStatus(`❌ ${err.message}`, "err");
    toast("Auto-fill failed", "er");
  } finally {
    S.busy = false;
  }
}

// ══════════════════════════════════════════════════
// COVER LETTER (standalone)
// ══════════════════════════════════════════════════
async function doCoverLetter() {
  if (!hasKey())            { toast("Add API key in Settings", "wa"); return; }
  if (!S.profile?.fullName) { toast("Complete Profile first", "wa"); return; }

  setStatus("✍️ Generating cover letter...", "info");
  try {
    const page = S.page || await getPage();
    const jobCtx = `${page?.title || "Unknown"} at ${page?.company || "Unknown"}. ${(page?.jobDesc || "").slice(0, 1500)}`;
    const cl = await AIClient.aiCoverLetter(aiSettings(), S.profile, jobCtx);
    document.getElementById("cl-card").style.display = "block";
    document.getElementById("cl-out").value = cl;
    setStatus("✅ Cover letter generated!", "ok");
    toast("Cover letter ready!", "ok");
  } catch (e) {
    setStatus(`❌ ${e.message}`, "err");
  }
}

// ══════════════════════════════════════════════════
// MATCH SCORE (standalone)
// ══════════════════════════════════════════════════
async function doMatchScore() {
  if (!hasKey())            { toast("Add API key in Settings", "wa"); return; }
  if (!S.profile?.fullName) { toast("Complete Profile first", "wa"); return; }

  setStatus("🎯 Calculating match score...", "info");
  try {
    const page = S.page || await getPage();
    if (!page?.jobDesc) { setStatus("⚠️ No job description found on this page.", "warn"); return; }
    const r = await AIClient.aiMatchScore(
      aiSettings(), S.profile, page.jobDesc, page.title || "", page.company || ""
    );
    S.lastScore = r.matchScore;
    const col = r.matchScore >= 75 ? "🟢" : r.matchScore >= 50 ? "🟡" : "🔴";
    setStatus(`${col} <strong>Match: ${r.matchScore}% — ${r.verdict}</strong><br>
      ${(r.strengths||[]).slice(0,2).map(s=>`✅ ${s}`).join("<br>")}
      ${(r.gaps||[]).slice(0,2).map(g=>`⚠️ ${g}`).join("<br>")}
      <br>💡 ${r.recommendation||""}`, "ok");
  } catch (e) {
    setStatus(`❌ ${e.message}`, "err");
  }
}

// ══════════════════════════════════════════════════
// RENDER FIELD LIST
// ══════════════════════════════════════════════════
function renderFieldList(fields, fills, results = []) {
  const card  = document.getElementById("fcard");
  const list  = document.getElementById("flist");
  const count = document.getElementById("fcount");
  card.style.display = "block";
  count.textContent  = `${fields.length} found · ${fills.length} filled`;
  list.innerHTML = "";

  const fillMap = {}, resMap = {};
  fills.forEach(f   => { fillMap[f.xpath] = f; });
  results.forEach(r => { resMap[r.xpath]  = r; });

  fields.slice(0, 25).forEach(field => {
    const fill  = fillMap[field.xpath];
    const res   = resMap[field.xpath];
    const label = (field.label || field.name || "Unknown").slice(0, 36);
    const el = document.createElement("div");
    el.className = "fi";
    if (fill) {
      const ok = res ? res.success : true;
      el.innerHTML = `<span class="fb ${ok?"fb-ok":"fb-ry"}">${ok?"✓ Filled":"⚠ Retry"}</span>
        <span style="flex:1">${esc(label)}</span>
        <span style="color:var(--g400);font-size:10px">${esc(String(fill.value).slice(0,18))}</span>`;
    } else {
      el.innerHTML = `<span class="fb fb-sk">— Skip</span><span style="flex:1">${esc(label)}</span>`;
    }
    list.appendChild(el);
  });

  if (fields.length > 25) {
    const m = document.createElement("div");
    m.style.cssText = "font-size:11px;color:var(--g400);padding:4px 7px";
    m.textContent = `+ ${fields.length - 25} more fields...`;
    list.appendChild(m);
  }
}

// ══════════════════════════════════════════════════
// PROFILE FORM
// ══════════════════════════════════════════════════
function fillProfileForm(p) {
  if (!p) return;
  const f = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
  f("p-name",       p.fullName);
  f("p-email",      p.email);
  f("p-phone",      p.phone);
  f("p-location",   p.location);
  f("p-linkedin",   p.linkedinUrl);
  f("p-portfolio",  p.portfolioUrl);
  f("p-title",      p.currentTitle);
  f("p-years",      p.yearsExperience);
  f("p-salary",     p.salaryExpectation);
  f("p-notice",     p.noticePeriod);
  f("p-visa",       p.visaStatus);
  f("p-worktype",   p.workPreference);
  f("p-skills",     Array.isArray(p.skills) ? p.skills.join(", ") : p.skills || "");
  f("p-summary",    p.summary);
  f("p-degree",     p.education?.[0]?.degree || "");
  f("p-institution",p.education?.[0]?.institution || "");
  f("p-gradyear",   p.education?.[0]?.year || "");
  f("p-certs",      Array.isArray(p.certifications) ? p.certifications.join(", ") : p.certifications || "");
  f("p-why",        p.whyThisJob);
  f("p-strength",   p.greatestStrength);
  f("p-authorized", p.authorizedToWork);
}

function readProfileForm() {
  const g = id => document.getElementById(id)?.value?.trim() || "";
  return {
    fullName:        g("p-name"),
    email:           g("p-email"),
    phone:           g("p-phone"),
    location:        g("p-location"),
    linkedinUrl:     g("p-linkedin"),
    portfolioUrl:    g("p-portfolio"),
    currentTitle:    g("p-title"),
    yearsExperience: g("p-years"),
    salaryExpectation: g("p-salary"),
    noticePeriod:    g("p-notice"),
    visaStatus:      g("p-visa"),
    workPreference:  g("p-worktype"),
    skills:          g("p-skills").split(",").map(s => s.trim()).filter(Boolean),
    summary:         g("p-summary"),
    education: [{
      degree:      g("p-degree"),
      institution: g("p-institution"),
      year:        g("p-gradyear")
    }],
    certifications:  g("p-certs").split(",").map(s => s.trim()).filter(Boolean),
    whyThisJob:      g("p-why"),
    greatestStrength:g("p-strength"),
    authorizedToWork:g("p-authorized")
  };
}

async function saveProfile() {
  const profile = readProfileForm();
  if (!profile.fullName) { toast("Please enter your full name", "wa"); return; }
  if (!profile.email)    { toast("Please enter your email", "wa"); return; }
  S.profile = profile;
  await dbSet("profile", profile);
  toast("✅ Profile saved!", "ok");

  // Sync to backend if online
  if (S.backendOnline) BackendClient.syncProfile(profile).catch(() => {});
}

// ══════════════════════════════════════════════════
// RESUME UPLOAD & PARSE
// ══════════════════════════════════════════════════
async function handleResume(file) {
  if (!hasKey()) { toast("Add API key in Settings first!", "wa"); return; }

  const statusEl = document.getElementById("upload-status");
  statusEl.style.display = "block";
  statusEl.className = "alert a-info";
  statusEl.textContent = `📄 Reading ${file.name}...`;

  try {
    const text = await ResumeParser.extractResumeText(file);
    if (!text || text.length < 50) throw new Error("Could not read text from file. Try a .txt version of your resume.");

    statusEl.textContent = "🤖 AI parsing your resume...";
    const parsed = await AIClient.aiParseResume(aiSettings(), text);

    // Merge with existing profile
    S.profile = { ...(S.profile || {}), ...parsed };
    fillProfileForm(S.profile);
    await dbSet("profile", S.profile);

    const fields = Object.keys(parsed).filter(k => {
      const v = parsed[k];
      return v && (typeof v === "string" ? v.length > 0 : Array.isArray(v) ? v.length > 0 : true);
    }).length;

    statusEl.className = "alert a-ok";
    statusEl.textContent = `✅ Parsed ${fields} fields from ${file.name}. Review below and Save.`;
    toast("Resume parsed!", "ok");

  } catch (e) {
    statusEl.className = "alert a-err";
    statusEl.textContent = `❌ ${e.message}`;
  }
}

// ══════════════════════════════════════════════════
// SETTINGS UI
// ══════════════════════════════════════════════════
function applySettingsUI() {
  const sv = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };
  sv("s-gemini-key",   S.settings.geminiKey);
  sv("s-gemini-model", S.settings.geminiModel);
  sv("s-groq-key",     S.settings.groqKey);
  sv("s-groq-model",   S.settings.groqModel);
  sv("s-or-key",       S.settings.orKey);
  sv("s-or-model",     S.settings.orModel);

  const sw = (id, v) => { const el = document.getElementById(id); if (el) el.className = "tsw" + (v ? " on" : ""); };
  sw("sw-confirm",   S.settings.confirmBeforeSubmit);
  sw("sw-highlight", S.settings.highlightFields);
  sw("sw-skip",      S.settings.skipLow);
  sw("sw-scroll",    S.settings.autoScroll);
  updateProviderStatus();
}

function saveSettings() {
  S.settings.geminiKey   = document.getElementById("s-gemini-key")?.value?.trim() || "";
  S.settings.geminiModel = document.getElementById("s-gemini-model")?.value || "gemini-3.6-flash";
  S.settings.groqKey     = document.getElementById("s-groq-key")?.value?.trim() || "";
  S.settings.groqModel   = document.getElementById("s-groq-model")?.value || "llama-4-maverick-17b-128e-instruct";
  S.settings.orKey       = document.getElementById("s-or-key")?.value?.trim() || "";
  S.settings.orModel     = document.getElementById("s-or-model")?.value || "meta-llama/llama-3.3-70b-instruct:free";
  // normalise
  S.settings.openrouterKey   = S.settings.orKey;
  S.settings.openrouterModel = S.settings.orModel;
  dbSet("settings", S.settings);
  updateProviderStatus();
}

function updateProviderStatus() {
  const set = (id, key, tested) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (!key)           { el.textContent = "Not set";   el.className = "pstat pstat-no"; }
    else if (tested==="ok") { el.textContent = "✅ Connected"; el.className = "pstat pstat-ok"; }
    else if (tested==="err"){ el.textContent = "❌ Failed";    el.className = "pstat pstat-err"; }
    else                { el.textContent = "Key saved"; el.className = "pstat pstat-no"; }
  };
  set("st-gemini", S.settings.geminiKey,   S._geminiTest);
  set("st-groq",   S.settings.groqKey,     S._groqTest);
  set("st-or",     S.settings.orKey,       S._orTest);
}

// ══════════════════════════════════════════════════
// TRACKER
// ══════════════════════════════════════════════════
let tFilter = "all";
let tSearch = "";

const STATUS_CLASS = { Applied:"s-ap", Viewed:"s-vi", Interview:"s-in", Offer:"s-of", Rejected:"s-re", Withdrawn:"s-wi" };
const STATUS_ICON  = { Applied:"📤", Viewed:"👀", Interview:"🎤", Offer:"🎉", Rejected:"❌", Withdrawn:"↩️" };

function addApp(app) {
  const entry = {
    id:        Date.now().toString() + Math.random().toString(36).slice(2,6),
    title:     app.title     || "Unknown Role",
    company:   app.company   || "Unknown Company",
    url:       app.url       || "",
    platform:  app.platform  || "Other",
    status:    app.status    || "Applied",
    matchScore:app.matchScore || null,
    salary:    app.salary    || "",
    notes:     app.notes     || "",
    appliedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  S.applications.unshift(entry);
  dbSet("applications", S.applications);
  renderTrackerStats();
  renderTrackerList();
  toast(`Logged: ${entry.title}`, "ok");
  return entry;
}

function updateApp(id, updates) {
  const i = S.applications.findIndex(a => a.id === id);
  if (i === -1) return;
  S.applications[i] = { ...S.applications[i], ...updates, updatedAt: new Date().toISOString() };
  dbSet("applications", S.applications);
  renderTrackerStats();
  renderTrackerList();
}

function deleteApp(id) {
  S.applications = S.applications.filter(a => a.id !== id);
  dbSet("applications", S.applications);
  renderTrackerStats();
  renderTrackerList();
  toast("Removed", "default");
}

function renderTrackerStats() {
  const c = { Applied:0, Viewed:0, Interview:0, Offer:0 };
  S.applications.forEach(a => { if (c[a.status] !== undefined) c[a.status]++; });
  document.getElementById("st-ap").textContent = c.Applied;
  document.getElementById("st-vi").textContent = c.Viewed;
  document.getElementById("st-in").textContent = c.Interview;
  document.getElementById("st-of").textContent = c.Offer;
}

function renderTrackerList() {
  const q = tSearch.toLowerCase();
  const filtered = S.applications.filter(a => {
    const filt = tFilter === "all" || a.status === tFilter;
    const srch = !q || a.title.toLowerCase().includes(q) || a.company.toLowerCase().includes(q);
    return filt && srch;
  });

  const list = document.getElementById("tlist");

  if (filtered.length === 0) {
    list.innerHTML = `<div class="te"><div class="te-i">📋</div>
      <div class="te-t">${tSearch ? "No results" : "No applications yet"}</div>
      <div class="te-s">${tSearch ? `No match for "${esc(tSearch)}"` : 'Use <strong>+ Add</strong> to log a job,<br>or auto-fill — it logs automatically.'}</div></div>`;
    return;
  }

  list.innerHTML = "";
  filtered.forEach(app => {
    const logo = (app.company || "?")[0].toUpperCase();
    const card = document.createElement("div");
    card.className = "jc";
    card.dataset.id = app.id;

    const mb = app.matchScore
      ? `<span class="mb" style="background:${app.matchScore>=75?"var(--gl)":app.matchScore>=50?"var(--bl)":"var(--yl)"};color:${app.matchScore>=75?"var(--g)":app.matchScore>=50?"var(--b)":"var(--y)"}">${app.matchScore}%</span>`
      : "";

    card.innerHTML = `
      <div class="jch" data-id="${app.id}">
        <div class="jcl">${logo}</div>
        <div class="jci">
          <div class="jct">${esc(app.title)}</div>
          <div class="jcc">${esc(app.company)}</div>
          <div class="jcm"><span>${fmtDate(app.appliedAt)}</span>${app.platform?`<span>· ${esc(app.platform)}</span>`:""}</div>
        </div>
        <div class="jcr">
          <span class="sb ${STATUS_CLASS[app.status]||"s-ap"}">${STATUS_ICON[app.status]||""} ${app.status}</span>
          ${mb}
        </div>
      </div>
      <div class="jcb" id="jcb-${app.id}">
        <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
          <span style="font-size:10.5px;color:var(--g500);width:60px">Status</span>
          <select class="sselect" onchange="window._updateStatus('${app.id}',this.value)">
            ${["Applied","Viewed","Interview","Offer","Rejected","Withdrawn"].map(s=>`<option${s===app.status?" selected":""}>${s}</option>`).join("")}
          </select>
        </div>
        ${app.url?`<div style="margin-top:7px;font-size:11px"><a href="${esc(app.url)}" target="_blank" style="color:var(--p)">🔗 Open job listing</a></div>`:""}
        <textarea class="nnotes" placeholder="Notes..." onblur="window._saveNotes('${app.id}',this.value)">${esc(app.notes||"")}</textarea>
        <div class="jba">
          ${app.url?`<button class="jbb p" onclick="window.open('${esc(app.url)}','_blank')">🔗 Open</button>`:""}
          <button class="jbb" onclick="navigator.clipboard.writeText('${esc(app.title)} @ ${esc(app.company)}').then(()=>window._toast('Copied!'))">📋 Copy</button>
          <button class="jbb r" onclick="window._deleteApp('${app.id}')">🗑️ Delete</button>
        </div>
      </div>`;

    card.querySelector(".jch").addEventListener("click", () => {
      const body = document.getElementById(`jcb-${app.id}`);
      body.classList.toggle("on");
    });

    list.appendChild(card);
  });
}

window._updateStatus = (id, status) => { updateApp(id, { status }); toast(`Status → ${status}`, "ok"); };
window._saveNotes    = (id, notes)  => { updateApp(id, { notes }); };
window._deleteApp    = (id)         => { if (confirm("Delete?")) deleteApp(id); };
window._toast        = (m)          => toast(m, "ok");

function autoLog() {
  if (!S.page?.url) return;
  const title   = S.page.title   || S.page.h1 || "Unknown";
  const company = S.page.company || S.page.h2 || "";
  const url     = S.page.url;

  // Deduplicate
  const already = S.applications.find(a =>
    a.url === url ||
    (a.title.toLowerCase() === title.toLowerCase() && a.company.toLowerCase() === company.toLowerCase()
     && Date.now() - new Date(a.appliedAt).getTime() < 300000)
  );
  if (already) return;

  addApp({ title, company, url, platform: platformName(url), status: "Applied", matchScore: S.lastScore });
}

function exportCSV() {
  if (!S.applications.length) { toast("No applications to export", "wa"); return; }
  const hdrs = ["Title","Company","Platform","Status","Match%","Salary","Date Applied","URL","Notes"];
  const rows = S.applications.map(a => [
    a.title, a.company, a.platform, a.status,
    a.matchScore || "", a.salary || "",
    new Date(a.appliedAt).toLocaleDateString("en-AU"),
    a.url || "", (a.notes || "").replace(/\n/g," ")
  ].map(v => `"${String(v).replace(/"/g,'""')}"`));
  const csv  = [hdrs.join(","), ...rows.map(r => r.join(","))].join("\n");
  const blob = new Blob([csv], { type:"text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = "jobagent-tracker.csv"; a.click();
  URL.revokeObjectURL(url);
  toast(`Exported ${S.applications.length} applications`, "ok");
}

// ══════════════════════════════════════════════════
// QUEUE / BACKEND
// ══════════════════════════════════════════════════
async function checkBackend() {
  S.backendOnline = await BackendClient.checkHealth();
  const dot = document.getElementById("bdot");
  const txt = document.getElementById("bst");
  const sub = document.getElementById("bss");
  const setup = document.getElementById("backend-setup");
  const qBtn = document.getElementById("btn-queue-now");

  if (S.backendOnline) {
    dot.className = "bdot on";
    txt.textContent = "✅ Backend connected";
    txt.style.color = "var(--g)";
    sub.textContent = "ws://localhost:51473 · Playwright ready";
    setup.style.display = "none";
    if (qBtn) qBtn.disabled = false;
  } else {
    dot.className = "bdot";
    txt.textContent = "⚠️ Backend offline";
    txt.style.color = "var(--y)";
    sub.textContent = "Run: node server.js in jobagent-backend/";
    setup.style.display = "block";
    if (qBtn) qBtn.disabled = true;
  }
}

function handleBackendMsg(msg2) {
  const { type, payload } = msg2;
  if (type === "CONNECTED") { S.backendOnline = true; checkBackend(); refreshQueue(); }

  if (type === "STATUS") {
    const bar = document.getElementById("lbar");
    const txt = document.getElementById("lbar-txt");
    if (bar && txt) {
      bar.style.display = "flex";
      txt.textContent = payload?.message || payload?.status || "";
      if (["submitted","error","rejected","cancelled"].includes(payload?.status)) {
        setTimeout(() => { bar.style.display = "none"; }, 4000);
      }
    }
    if (payload?.status === "submitted") toast("🎉 Submitted!", "ok");
    if (payload?.status === "error")     toast("❌ Error — see Queue tab", "er");
    refreshQueue();
  }

  if (type === "CAPTCHA") {
    const b = document.getElementById("captcha-banner");
    if (b) b.style.display = "block";
    toast("🔒 CAPTCHA! Solve in the browser window", "wa", 8000);
  }

  if (type === "DIFF_REVIEW") {
    S.diffAppId = payload?.appId;
    showDiffModal(payload);
    toast("⏳ Review & approve before submitting", "wa", 6000);
  }
}

async function addToQueue() {
  if (!S.backendOnline) { toast("Start the backend first", "wa"); return; }
  if (!S.profile?.fullName) { toast("Complete Profile first", "wa"); return; }
  if (!hasKey()) { toast("Add API key in Settings", "wa"); return; }

  const page = S.page || await getPage().catch(() => null);
  if (!page?.url) { toast("Navigate to a job listing first", "wa"); return; }

  try {
    const result = await BackendClient.addToQueue({
      url:        page.url,
      title:      page.title   || "Unknown",
      company:    page.company || "",
      platform:   platformName(page.url),
      jd:         page.jobDesc || "",
      matchScore: S.lastScore,
      profile:    S.profile,
      apiKey:     S.settings.geminiKey || S.settings.groqKey || S.settings.orKey,
      geminiModel:S.settings.geminiModel
    });
    toast(`📬 Added to queue!`, "ok");
    setTimeout(refreshQueue, 600);
  } catch (e) {
    toast("Queue failed: " + e.message, "er");
  }
}

async function refreshQueue() {
  if (!S.backendOnline) return;
  try {
    const data = await BackendClient.getQueue();
    const jobs = data.jobs || [];
    const list = document.getElementById("qlist");
    document.getElementById("qcount").textContent = `${jobs.length} job${jobs.length !== 1 ? "s" : ""}`;

    if (jobs.length === 0) {
      list.innerHTML = `<div class="te" style="padding:18px"><div class="te-s">No jobs queued yet</div></div>`;
      return;
    }

    const ICONS = { queued:"📬", processing:"⚙️", submitted:"✅", error:"❌", awaiting_approval:"⏳", rejected:"✕", cancelled:"—" };
    list.innerHTML = jobs.map(j => `
      <div class="qi">
        <div class="qil">${(j.company||"?")[0].toUpperCase()}</div>
        <div class="qii">
          <div class="qit">${esc(j.title||"Unknown")}</div>
          <div class="qic">${esc(j.company||"")} · ${fmtDate(j.created_at)}</div>
        </div>
        <span class="qist qs-${j.status||"queued"}">${ICONS[j.status]||"📬"} ${j.status}</span>
        ${["queued","processing","awaiting_approval"].includes(j.status)
          ? `<button class="qcx" onclick="window._cancelJob('${j.id}')">✕</button>` : ""}
      </div>`).join("");
  } catch {}
}

window._cancelJob = async (id) => {
  await BackendClient.cancelJob(id);
  toast("Cancelled", "default");
  refreshQueue();
};

function showDiffModal(data) {
  const { jobTitle, company, fills, coverLetter, fillCount, fieldCount } = data || {};
  document.getElementById("dm-sub").textContent = `${jobTitle||"??"} @ ${company||"??"} — ${fillCount||0} of ${fieldCount||0} fields`;

  const flist = document.getElementById("dm-fields");
  flist.innerHTML = (fills || []).map(f => {
    const v   = String(f.value || "").toLowerCase();
    const prof = [S.profile?.fullName, S.profile?.email, S.profile?.phone]
      .filter(Boolean).some(x => v.includes(x.toLowerCase()));
    return `<div class="dfr">
      <div class="dfl">${esc((f.fieldName||"").slice(0,16))}</div>
      <div class="dfv ${prof?"dv-p":"dv-ai"}">${esc(String(f.value||"").slice(0,80))}</div>
    </div>`;
  }).join("");

  const clSection = document.getElementById("dm-cl");
  const clText    = document.getElementById("dm-cl-text");
  if (coverLetter) { clSection.style.display = "block"; clText.textContent = coverLetter.slice(0, 500); }
  else clSection.style.display = "none";

  document.getElementById("dm").classList.add("on");
  switchTab("queue");
}

// ══════════════════════════════════════════════════
// TAB SWITCHING
// ══════════════════════════════════════════════════
function switchTab(name) {
  document.querySelectorAll(".tb").forEach(b => b.classList.toggle("on", b.dataset.tab === name));
  document.querySelectorAll(".pane").forEach(p => p.classList.toggle("on", p.id === name + "-pane"));
}

// ══════════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", async () => {
  await boot();

  // ── Tabs ──────────────────────────────────────
  document.querySelectorAll(".tb").forEach(btn =>
    btn.addEventListener("click", () => {
      switchTab(btn.dataset.tab);
      if (btn.dataset.tab === "tracker") { renderTrackerStats(); renderTrackerList(); }
      if (btn.dataset.tab === "queue")   checkBackend();
      if (btn.dataset.tab === "apply")   getPage().catch(() => {});
    })
  );

  // ── APPLY TAB ─────────────────────────────────
  document.getElementById("btn-main").addEventListener("click", doScanAndFill);

  document.getElementById("btn-apply").addEventListener("click", async () => {
    setStatus("Clicking Apply button...", "info");
    const r = await msg("CLICK_APPLY", {}, 6000).catch(e => ({ success: false, error: e.message }));
    if (r.success) {
      setStatus(`✅ Clicked "${r.text}" — form should now be open. Click Scan & Auto-Fill.`, "ok");
      setTimeout(() => getPage().catch(() => {}), 1500);
    } else setStatus("⚠️ Apply button not found. Try scrolling to it and clicking manually.", "warn");
  });

  document.getElementById("btn-next").addEventListener("click", async () => {
    setStatus("Clicking Next Step...", "info");
    const r = await msg("CLICK_NEXT", {}, 6000).catch(e => ({ success: false }));
    if (r.success) {
      const label = r.isSubmit ? "Submitted!" : "Moved to next step — re-scanning...";
      setStatus(`✅ ${label}`, "ok");
      if (!r.isSubmit) setTimeout(() => doScanAndFill(), 2000);
    } else setStatus("⚠️ No Next/Continue button found. Check the form.", "warn");
  });

  document.getElementById("btn-cl").addEventListener("click",    doCoverLetter);
  document.getElementById("btn-score").addEventListener("click",  doMatchScore);
  document.getElementById("btn-queue-apply").addEventListener("click", addToQueue);

  document.getElementById("btn-copy-cl").addEventListener("click", () => {
    const t = document.getElementById("cl-out").value;
    navigator.clipboard.writeText(t).then(() => toast("Copied!", "ok"));
  });

  // ── PROFILE TAB ───────────────────────────────
  const uz = document.getElementById("uz");
  const rf = document.getElementById("rf");
  uz.addEventListener("click", () => rf.click());
  rf.addEventListener("change", e => { if (e.target.files[0]) handleResume(e.target.files[0]); });
  uz.addEventListener("dragover", e => { e.preventDefault(); uz.classList.add("drag"); });
  uz.addEventListener("dragleave", () => uz.classList.remove("drag"));
  uz.addEventListener("drop", e => {
    e.preventDefault(); uz.classList.remove("drag");
    if (e.dataTransfer.files[0]) handleResume(e.dataTransfer.files[0]);
  });

  // ONE save handler — no duplicates
  document.getElementById("btn-save-profile").addEventListener("click", saveProfile);

  // ── TRACKER TAB ───────────────────────────────
  document.getElementById("tsearch").addEventListener("input", e => {
    tSearch = e.target.value.trim();
    renderTrackerList();
  });

  document.querySelectorAll(".fc").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".fc").forEach(b => b.classList.remove("on"));
      btn.classList.add("on");
      tFilter = btn.dataset.f;
      renderTrackerList();
    });
  });

  document.getElementById("btn-add-job").addEventListener("click", () => {
    // Pre-fill from page
    if (S.page) {
      document.getElementById("aj-title").value   = S.page.title || "";
      document.getElementById("aj-company").value = S.page.company || "";
      document.getElementById("aj-url").value     = S.page.url || "";
      const p = detectPlatform(S.page.url || "");
      if (p) {
        const sel = document.getElementById("aj-platform");
        for (const o of sel.options) { if (o.value === p.name) { sel.value = p.name; break; } }
      }
    }
    document.getElementById("ajm").classList.add("on");
  });

  document.getElementById("ajm-close").addEventListener("click", () =>
    document.getElementById("ajm").classList.remove("on")
  );
  document.getElementById("ajm").addEventListener("click", e => {
    if (e.target === document.getElementById("ajm")) document.getElementById("ajm").classList.remove("on");
  });

  document.getElementById("btn-save-job").addEventListener("click", () => {
    const t = document.getElementById("aj-title").value.trim();
    const c = document.getElementById("aj-company").value.trim();
    if (!t || !c) { toast("Title and company required", "wa"); return; }
    addApp({
      title: t, company: c,
      url:      document.getElementById("aj-url").value.trim(),
      platform: document.getElementById("aj-platform").value,
      status:   document.getElementById("aj-status").value,
      matchScore: parseInt(document.getElementById("aj-score").value) || null,
      salary:   document.getElementById("aj-salary").value.trim(),
      notes:    document.getElementById("aj-notes").value.trim()
    });
    document.getElementById("ajm").classList.remove("on");
    ["aj-title","aj-company","aj-url","aj-score","aj-salary","aj-notes"]
      .forEach(id => { document.getElementById(id).value = ""; });
    switchTab("tracker");
  });

  document.getElementById("btn-export-csv").addEventListener("click", exportCSV);

  // ── QUEUE TAB ─────────────────────────────────
  document.getElementById("btn-chk-backend").addEventListener("click", async () => {
    await checkBackend();
    if (S.backendOnline) refreshQueue();
    toast(S.backendOnline ? "Backend connected" : "Backend offline", S.backendOnline ? "ok" : "wa");
  });

  document.getElementById("btn-queue-now").addEventListener("click", addToQueue);
  document.getElementById("btn-q-refresh").addEventListener("click", refreshQueue);
  document.getElementById("btn-q-clear").addEventListener("click", refreshQueue);

  document.getElementById("dm-approve").addEventListener("click", async () => {
    if (!S.diffAppId) return;
    document.getElementById("dm").classList.remove("on");
    await BackendClient.approveApp(S.diffAppId).catch(() => {});
    toast("✅ Approved — submitting...", "ok");
    S.diffAppId = null;
    document.getElementById("captcha-banner").style.display = "none";
    refreshQueue();
  });

  document.getElementById("dm-reject").addEventListener("click", async () => {
    if (!S.diffAppId) return;
    document.getElementById("dm").classList.remove("on");
    await BackendClient.rejectApp(S.diffAppId).catch(() => {});
    toast("Rejected", "default");
    S.diffAppId = null;
    refreshQueue();
  });

  // Backend init
  checkBackend().then(online => {
    if (online) {
      BackendClient.connectWebSocket(handleBackendMsg, connected => {
        S.backendOnline = connected;
        if (connected) refreshQueue();
      });
    }
  });
  setInterval(async () => {
    const was = S.backendOnline;
    await checkBackend();
    if (!was && S.backendOnline) {
      BackendClient.connectWebSocket(handleBackendMsg, c => { S.backendOnline = c; if (c) refreshQueue(); });
    }
  }, 12000);

  // ── SETTINGS TAB ─────────────────────────────
  ["s-gemini-key","s-gemini-model","s-groq-key","s-groq-model","s-or-key","s-or-model"]
    .forEach(id => document.getElementById(id)?.addEventListener("change", saveSettings));

  document.getElementById("eye-gemini")?.addEventListener("click", () => {
    const el = document.getElementById("s-gemini-key");
    el.type = el.type === "password" ? "text" : "password";
  });

  document.querySelectorAll(".tsw").forEach(btn => {
    btn.addEventListener("click", () => {
      btn.classList.toggle("on");
      const map = { "sw-confirm":"confirmBeforeSubmit", "sw-highlight":"highlightFields", "sw-skip":"skipLow", "sw-scroll":"autoScroll" };
      if (map[btn.id]) { S.settings[map[btn.id]] = btn.classList.contains("on"); dbSet("settings", S.settings); }
    });
  });

  document.getElementById("btn-test-ai").addEventListener("click", async () => {
    saveSettings();
    const res = document.getElementById("ai-test-result");
    res.style.display = "block";
    res.className = "alert a-info";
    res.textContent = "Testing...";

    const rows = [];
    const tests = [
      { name:"Gemini",      settings:{ geminiKey: S.settings.geminiKey, geminiModel: S.settings.geminiModel, groqKey:"", orKey:"", openrouterKey:"", openrouterModel:"" }, id:"_geminiTest" },
      { name:"Groq",        settings:{ groqKey:   S.settings.groqKey,   groqModel:   S.settings.groqModel,   geminiKey:"", orKey:"", openrouterKey:"", openrouterModel:"" }, id:"_groqTest" },
      { name:"OpenRouter",  settings:{ openrouterKey: S.settings.orKey, openrouterModel: S.settings.orModel, geminiKey:"", groqKey:"" }, id:"_orTest" }
    ];

    let anyOk = false;
    for (const t of tests) {
      const key = t.name === "Gemini" ? S.settings.geminiKey : t.name === "Groq" ? S.settings.groqKey : S.settings.orKey;
      if (!key) { rows.push(`⬜ ${t.name}: No key`); continue; }
      try {
        await AIClient.callAI(t.settings, "Say OK", "Reply with: OK", false);
        rows.push(`✅ ${t.name}: Connected`);
        S[t.id] = "ok"; anyOk = true;
      } catch (e) {
        rows.push(`❌ ${t.name}: ${e.message.slice(0,55)}`);
        S[t.id] = "err";
      }
    }

    updateProviderStatus();
    res.className = `alert ${anyOk ? "a-ok" : "a-err"}`;
    res.innerHTML = rows.map(r => `<div>${r}</div>`).join("");
    toast(anyOk ? "✅ Connected!" : "❌ All failed", anyOk ? "ok" : "er");
  });

  document.getElementById("btn-export-profile").addEventListener("click", () => {
    if (!S.profile) { toast("No profile to export", "wa"); return; }
    const blob = new Blob([JSON.stringify(S.profile, null, 2)], { type:"application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "jobagent-profile.json"; a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById("btn-clear-all").addEventListener("click", async () => {
    if (confirm("Clear ALL saved data? This cannot be undone.")) {
      await dbClear();
      toast("Cleared", "default");
      setTimeout(() => location.reload(), 500);
    }
  });

  // ── Page navigation listener ──────────────────
  chrome.runtime.onMessage.addListener(m => {
    if (m.type === "TO_SIDEPANEL" && m.action === "PAGE_READY") {
      S.page = null;
      getPage().catch(() => {});
    }
  });

});
