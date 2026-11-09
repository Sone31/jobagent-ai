// ============================================================
// JobAgent AI — Local Backend Server
// Express + WebSocket + Playwright + SQLite
// Port: 51473 (unlikely to conflict with other services)
// ============================================================
const express  = require("express");
const cors     = require("cors");
const http     = require("http");
const { WebSocketServer } = require("ws");
const { v4: uuidv4 }      = require("uuid");
const path     = require("path");
const fs       = require("fs");

const db       = require("./lib/database");
const gemini   = require("./lib/gemini-client");
const PlaywrightAgent = require("./lib/playwright-agent");

const app      = express();
const server   = http.createServer(app);
const PORT     = 51473;

// ── Middleware ──────────────────────────────────────────────
app.use(cors({
  origin: ["chrome-extension://*", "http://localhost:*"],
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "X-Api-Key"]
}));
app.use(express.json({ limit: "10mb" }));
app.use("/resumes", express.static(path.join(__dirname, "data/resumes")));

// ── WebSocket Server ────────────────────────────────────────
const wss = new WebSocketServer({ server });
const agent = new PlaywrightAgent(wss);

// Pending approvals map: appId → { resolve, reject }
const pendingApprovals = new Map();

wss.on("connection", (ws, req) => {
  console.log("[WS] Client connected");
  ws.send(JSON.stringify({ type: "CONNECTED", payload: { message: "JobAgent backend connected", version: "2.5.0" } }));

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw);
      console.log("[WS] Received:", msg.type);

      // Handle approval/rejection from extension
      if (msg.type === "APPROVE" && msg.appId) {
        const pending = pendingApprovals.get(msg.appId);
        if (pending) { pending.resolve(true); pendingApprovals.delete(msg.appId); }
      }
      if (msg.type === "REJECT" && msg.appId) {
        const pending = pendingApprovals.get(msg.appId);
        if (pending) { pending.resolve(false); pendingApprovals.delete(msg.appId); }
      }
    } catch (e) { console.error("[WS] Parse error:", e.message); }
  });

  ws.on("close", () => console.log("[WS] Client disconnected"));
  ws.on("error", (e) => console.error("[WS] Error:", e.message));
});

// ── Approval callback for Playwright agent ──────────────────
function waitForApproval(appId, timeoutMs = 1800000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingApprovals.delete(appId);
      resolve(false); // Auto-reject on timeout
    }, timeoutMs);

    pendingApprovals.set(appId, {
      resolve: (val) => { clearTimeout(timer); resolve(val); }
    });
  });
}

// ────────────────────────────────────────────────────────────
// ROUTES
// ────────────────────────────────────────────────────────────

// ── Health check ────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ ok: true, version: "2.5.0", port: PORT, timestamp: new Date().toISOString() });
});

// ── Add job to queue ─────────────────────────────────────────
app.post("/queue/add", async (req, res) => {
  const { url, title, company, platform, jd, matchScore, profile, apiKey, geminiModel } = req.body;
  if (!url) return res.status(400).json({ error: "URL required" });

  const jobId = uuidv4();
  const job = db.addJob({ id: jobId, url, title, company, platform, status: "queued", matchScore, jd });

  res.json({ ok: true, jobId, message: "Job added to queue" });

  // Start processing in background
  setImmediate(async () => {
    try {
      db.updateJobStatus(jobId, "processing");
      await agent.processJob(
        { ...job, id: jobId, jd_text: jd },
        profile,
        apiKey,
        geminiModel || "gemini-3.6-flash",
        waitForApproval
      );
    } catch (err) {
      console.error("[Queue] Processing error:", err);
      db.updateJobStatus(jobId, "error");
      agent.broadcast("STATUS", { jobId, status: "error", message: err.message });
    }
  });
});

// ── Get queue status ─────────────────────────────────────────
app.get("/queue", (req, res) => {
  const { status } = req.query;
  const jobs = db.getQueue(status || null);
  res.json({ ok: true, jobs });
});

// ── Get single job ────────────────────────────────────────────
app.get("/queue/:id", (req, res) => {
  const job = db.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json({ ok: true, job });
});

// ── Cancel a job ──────────────────────────────────────────────
app.delete("/queue/:id", (req, res) => {
  db.updateJobStatus(req.params.id, "cancelled");
  res.json({ ok: true, message: "Job cancelled" });
});

// ── Approve application (REST fallback) ──────────────────────
app.post("/approve/:appId", (req, res) => {
  const pending = pendingApprovals.get(req.params.appId);
  if (pending) {
    db.approveApplication(req.params.appId);
    pending.resolve(true);
    pendingApprovals.delete(req.params.appId);
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: "No pending approval for this app" });
  }
});

// ── Reject application ────────────────────────────────────────
app.post("/reject/:appId", (req, res) => {
  const pending = pendingApprovals.get(req.params.appId);
  if (pending) {
    pending.resolve(false);
    pendingApprovals.delete(req.params.appId);
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: "No pending approval for this app" });
  }
});

// ── Save / get profile ────────────────────────────────────────
app.post("/profile", (req, res) => {
  db.saveProfile(req.body);
  res.json({ ok: true });
});
app.get("/profile", (req, res) => {
  const profile = db.getProfile();
  res.json({ ok: true, profile });
});

// ── Generate tailored resume PDF ──────────────────────────────
app.post("/resume/generate", async (req, res) => {
  const { profile, jobDescription, apiKey, geminiModel, jobId } = req.body;
  if (!profile || !apiKey) return res.status(400).json({ error: "profile and apiKey required" });

  try {
    const pdfGen   = require("./lib/pdf-generator");
    const markdown = await gemini.tailorResumeMarkdown(apiKey, geminiModel || "gemini-3.6-flash", profile, jobDescription || "");
    const pdfDir   = path.join(__dirname, "data/resumes");
    fs.mkdirSync(pdfDir, { recursive: true });
    const filename = `resume_${jobId || Date.now()}.pdf`;
    const pdfPath  = path.join(pdfDir, filename);
    await pdfGen.generatePDF(markdown, profile, pdfPath);
    res.json({ ok: true, filename, path: `/resumes/${filename}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Test AI connection ────────────────────────────────────────
app.post("/test-ai", async (req, res) => {
  const { apiKey, model } = req.body;
  try {
    const result = await gemini.callGemini(apiKey, model || "gemini-3.6-flash", "Say OK", "Reply with exactly: OK", false);
    res.json({ ok: true, response: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// START SERVER
// ────────────────────────────────────────────────────────────
server.listen(PORT, "127.0.0.1", () => {
  console.log(`
╔════════════════════════════════════════╗
║     JobAgent AI — Local Backend        ║
║     http://localhost:${PORT}           ║
║     WebSocket: ws://localhost:${PORT}  ║
╚════════════════════════════════════════╝
`);
});

// Graceful shutdown
process.on("SIGINT",  async () => { await agent.close(); process.exit(0); });
process.on("SIGTERM", async () => { await agent.close(); process.exit(0); });
