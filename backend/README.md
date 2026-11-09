# JobAgent AI — Local Backend

Local Node.js server that powers headless auto-apply via Playwright.

## Setup (One Time)

```bash
cd jobagent-backend
chmod +x setup.sh
./setup.sh
```

## Start Server

```bash
node server.js
```

Server runs on **http://localhost:51473**

## What it does

- **Playwright** opens a real browser (non-headless so you can handle CAPTCHAs)
- **SQLite** stores job queue and application history locally
- **WebSocket** sends live status updates to the extension sidebar
- **Gemini AI** fills fields, generates tailored resume PDF, writes cover letter
- **Diff Review** sends all filled data to extension for your approval before submitting

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | /health | Check if server is running |
| POST | /queue/add | Add job to auto-apply queue |
| GET | /queue | Get all queued jobs |
| DELETE | /queue/:id | Cancel a job |
| POST | /approve/:appId | Approve application (submit) |
| POST | /reject/:appId | Reject application (cancel) |
| POST | /resume/generate | Generate tailored PDF resume |
| POST | /profile | Save profile to SQLite |
| GET | /profile | Load profile from SQLite |

## How the Queue Flow Works

```
Extension: "Add to Queue" clicked
     ↓
POST /queue/add (job URL + profile + API key)
     ↓
Playwright opens browser → navigates to job URL
     ↓
Clicks Apply button
     ↓
Gemini generates tailored resume PDF
     ↓
Playwright scans form fields
     ↓
Gemini matches fields to profile
     ↓
WebSocket → Extension shows Diff Review modal
     ↓
User clicks Approve
     ↓
Playwright fills form + uploads resume PDF
     ↓
Playwright clicks Submit
     ↓
WebSocket → Extension shows "Submitted!" ✅
```

## Privacy

- API key only stored in chrome.storage.local
- Passed securely to backend via POST body (localhost only)
- Never logged or transmitted externally
- All data stays on your machine
