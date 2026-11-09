// ============================================================
// JobAgent AI — Backend Client
// Connects extension to local Node.js server via HTTP + WebSocket
// ============================================================

window.BackendClient = (function () {

  const BASE_URL = "http://localhost:51473";
  const WS_URL   = "ws://localhost:51473";
  let   ws       = null;
  let   wsListeners = [];
  let   isConnected = false;
  let   reconnectTimer = null;

  // ── Check if backend is running ──────────────────────────
  async function checkHealth() {
    try {
      const res = await fetch(`${BASE_URL}/health`, {
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) { const d = await res.json(); return d.ok === true; }
      return false;
    } catch (_) { return false; }
  }

  // ── Add job to queue ─────────────────────────────────────
  async function addToQueue(payload) {
    const res = await fetch(`${BASE_URL}/queue/add`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Server error ${res.status}`);
    }
    return await res.json();
  }

  // ── Get queue ────────────────────────────────────────────
  async function getQueue(status = null) {
    const url = status ? `${BASE_URL}/queue?status=${status}` : `${BASE_URL}/queue`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Queue fetch failed: ${res.status}`);
    return await res.json();
  }

  // ── Cancel job ───────────────────────────────────────────
  async function cancelJob(jobId) {
    const res = await fetch(`${BASE_URL}/queue/${jobId}`, { method: "DELETE" });
    return await res.json();
  }

  // ── Approve / reject application ─────────────────────────
  async function approveApp(appId) {
    // Try WebSocket first (faster)
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "APPROVE", appId }));
      return { ok: true };
    }
    // Fallback to REST
    const res = await fetch(`${BASE_URL}/approve/${appId}`, { method: "POST" });
    return await res.json();
  }

  async function rejectApp(appId) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "REJECT", appId }));
      return { ok: true };
    }
    const res = await fetch(`${BASE_URL}/reject/${appId}`, { method: "POST" });
    return await res.json();
  }

  // ── WebSocket connection ──────────────────────────────────
  function connectWebSocket(onMessage, onStatusChange) {
    if (ws && ws.readyState === WebSocket.OPEN) return;

    try {
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        isConnected = true;
        clearTimeout(reconnectTimer);
        console.log("[BackendClient] WS connected");
        onStatusChange?.(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          onMessage?.(msg);
          wsListeners.forEach(fn => fn(msg));
        } catch (e) {}
      };

      ws.onclose = () => {
        isConnected = false;
        onStatusChange?.(false);
        // Auto-reconnect every 5s
        reconnectTimer = setTimeout(() => connectWebSocket(onMessage, onStatusChange), 5000);
      };

      ws.onerror = () => {
        isConnected = false;
        onStatusChange?.(false);
      };

    } catch (e) {
      isConnected = false;
    }
  }

  function addWSListener(fn) { wsListeners.push(fn); }
  function removeWSListener(fn) { wsListeners = wsListeners.filter(f => f !== fn); }

  // ── Sync profile to backend ───────────────────────────────
  async function syncProfile(profile) {
    try {
      await fetch(`${BASE_URL}/profile`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(profile)
      });
    } catch (_) {} // Silent fail — backend optional
  }

  return {
    checkHealth, addToQueue, getQueue, cancelJob,
    approveApp, rejectApp, connectWebSocket,
    addWSListener, removeWSListener, syncProfile,
    get isConnected() { return isConnected; },
    BASE_URL
  };

})();
