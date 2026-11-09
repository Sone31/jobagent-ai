// ============================================================
// JobAgent AI — SQLite Database Layer
// ============================================================
const path    = require("path");
const fs      = require("fs");

let db = null;

function getDB() {
  if (db) return db;

  try {
    const Database = require("better-sqlite3");
    const dbPath   = path.join(__dirname, "../data/jobagent.db");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    // Create tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id          TEXT PRIMARY KEY,
        url         TEXT NOT NULL,
        title       TEXT,
        company     TEXT,
        platform    TEXT,
        status      TEXT DEFAULT 'queued',
        match_score INTEGER,
        jd_text     TEXT,
        notes       TEXT,
        created_at  TEXT DEFAULT (datetime('now')),
        updated_at  TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS applications (
        id          TEXT PRIMARY KEY,
        job_id      TEXT REFERENCES jobs(id),
        profile     TEXT,
        filled_fields TEXT,
        resume_path TEXT,
        cover_letter TEXT,
        diff_data   TEXT,
        approved    INTEGER DEFAULT 0,
        submitted   INTEGER DEFAULT 0,
        error       TEXT,
        created_at  TEXT DEFAULT (datetime('now')),
        updated_at  TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS profiles (
        id          TEXT PRIMARY KEY DEFAULT 'default',
        data        TEXT NOT NULL,
        updated_at  TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC);
    `);

    console.log("[DB] SQLite ready:", dbPath);
    return db;
  } catch (err) {
    console.warn("[DB] SQLite not available:", err.message);
    // Return a mock DB for graceful degradation
    return createMockDB();
  }
}

// In-memory fallback if better-sqlite3 not installed yet
function createMockDB() {
  const store = { jobs: [], applications: [], profiles: [] };
  return {
    prepare: (sql) => ({
      run:  (...args) => ({ lastInsertRowid: Date.now() }),
      get:  (...args) => null,
      all:  (...args) => []
    }),
    exec: () => {},
    pragma: () => {},
    _mock: true,
    _store: store
  };
}

// ── Job operations ─────────────────────────────────────────
function addJob(job) {
  const d = getDB();
  d.prepare(`
    INSERT OR REPLACE INTO jobs (id, url, title, company, platform, status, match_score, jd_text, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(job.id, job.url, job.title, job.company, job.platform,
         job.status || "queued", job.matchScore || null, job.jd || "", job.notes || "");
  return job;
}

function updateJobStatus(id, status, extra = {}) {
  const d = getDB();
  d.prepare(`
    UPDATE jobs SET status=?, updated_at=datetime('now')
    ${extra.error ? ", error=?" : ""}
    WHERE id=?
  `).run(status, ...(extra.error ? [extra.error] : []), id);
}

function getJob(id) {
  return getDB().prepare("SELECT * FROM jobs WHERE id=?").get(id);
}

function getQueue(status = null) {
  if (status) {
    return getDB().prepare("SELECT * FROM jobs WHERE status=? ORDER BY created_at ASC").all(status);
  }
  return getDB().prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100").all();
}

// ── Application operations ─────────────────────────────────
function createApplication(app) {
  const d = getDB();
  d.prepare(`
    INSERT INTO applications (id, job_id, profile, filled_fields, resume_path, cover_letter, diff_data)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(app.id, app.jobId,
         JSON.stringify(app.profile || {}),
         JSON.stringify(app.filledFields || []),
         app.resumePath || "",
         app.coverLetter || "",
         JSON.stringify(app.diffData || {}));
}

function approveApplication(appId) {
  getDB().prepare("UPDATE applications SET approved=1, updated_at=datetime('now') WHERE id=?").run(appId);
}

function markSubmitted(appId, error = null) {
  getDB().prepare("UPDATE applications SET submitted=1, error=?, updated_at=datetime('now') WHERE id=?")
    .run(error, appId);
}

// ── Profile operations ─────────────────────────────────────
function saveProfile(data) {
  getDB().prepare(`
    INSERT OR REPLACE INTO profiles (id, data, updated_at) VALUES ('default', ?, datetime('now'))
  `).run(JSON.stringify(data));
}

function getProfile() {
  const row = getDB().prepare("SELECT data FROM profiles WHERE id='default'").get();
  return row ? JSON.parse(row.data) : null;
}

module.exports = { addJob, updateJobStatus, getJob, getQueue, createApplication, approveApplication, markSubmitted, saveProfile, getProfile };
