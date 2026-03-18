# OpenClaw Gateway API — Virtual Office Integration Guide

> **Based on OpenClaw source code analysis (v2026.3.9)**  
> Written by עידו 🦞 — OpenClaw Expert

---

## Overview

The OpenClaw Gateway exposes a **WebSocket API** (primary) and an **HTTP REST API** (secondary).  
For Virtual Office integration, most operations go through **HTTP `POST /tools/invoke`** — calling agent tools directly.

```
Virtual Office App
      │
      ▼
POST /tools/invoke/:toolName   ← HTTP API (sessions_list, sessions_history)
WebSocket ws://...             ← Real-time events (optional)
```

---

## 1. Authentication

### Auth Modes

OpenClaw Gateway supports three auth modes (resolved from config):

| Mode | How it works |
|------|-------------|
| `none` | No auth required (local-only, localhost) |
| `token` | Bearer token in Authorization header |
| `password` | Basic auth or password param |
| `trusted-proxy` | Trusts upstream proxy headers (Tailscale, nginx) |

**Default behavior:** If a token or password is configured, the gateway requires auth. On localhost without config, it may allow unauthenticated access.

### Using Token Auth (recommended)

Add `Authorization` header to all requests:

```http
Authorization: Bearer YOUR_GATEWAY_TOKEN
```

Or as a query param (less secure):
```
GET /tools/invoke/sessions_list?token=YOUR_GATEWAY_TOKEN
```

### Config Example

```json
// openclaw.json
{
  "gateway": {
    "auth": {
      "token": "your-secret-token-here"
    }
  }
}
```

### Token vs Password Mode

```json
// Token mode (preferred for API clients):
{ "gateway": { "auth": { "token": "abc123" } } }

// Password mode (for human login via UI):
{ "gateway": { "auth": { "password": "mypassword" } } }
```

> **Security note:** Token auth uses timing-safe comparison to prevent timing attacks.  
> Store your token in environment variables, not hardcoded in frontend code.

---

## 2. `sessions_list` — List All Agent Sessions

Returns all known sessions with their current state.

### HTTP Request

```http
POST /tools/invoke/sessions_list
Authorization: Bearer YOUR_TOKEN
Content-Type: application/json

{
  "limit": 20,
  "activeMinutes": 60
}
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | `integer` | Max sessions to return |
| `activeMinutes` | `integer` | Filter: only sessions active in last N minutes |
| `agentId` | `string` | Filter by agent (e.g. `"main"`, `"ido"`) |
| `label` | `string` | Filter by session label |
| `includeLastMessage` | `boolean` | Read last 16KB transcript for message preview (slow, use with `limit`) |
| `includeDerivedTitles` | `boolean` | Read first 8KB for title from first user message |

### Response Shape

```json
{
  "sessions": [
    {
      "key": "agent:main:discord:channel:1481217630344839262",
      "kind": "group",
      "channel": "discord",
      "displayName": "discord:g-1481217630344839259",
      "updatedAt": 1773308845460,
      "sessionId": "fdff3a7a-344e-4d6e-b040-4a5ea5b0b5b7",
      "model": "claude-opus-4-6",
      "contextTokens": 200000,
      "totalTokens": 92224,
      "systemSent": true,
      "abortedLastRun": false,
      "lastChannel": "discord",
      "lastTo": "channel:1481217630344839262",
      "lastAccountId": "default",
      "transcriptPath": "/home/tal/.openclaw/agents/main/sessions/fdff3a7a.jsonl"
    }
    // ...more sessions
  ]
}
```

### Key Fields for Virtual Office

| Field | Type | Description |
|-------|------|-------------|
| `key` | `string` | Unique session identifier. Format: `agent:{agentId}:{channel}:{target}` |
| `updatedAt` | `number` | **Unix timestamp (ms)** of last activity — use this for status mapping |
| `model` | `string` | AI model currently in use |
| `totalTokens` | `number` | Cumulative token count for this session |
| `contextTokens` | `number` | Max context window size |
| `abortedLastRun` | `boolean` | `true` if last run was interrupted (agent may be "stuck") |
| `channel` | `string` | `discord`, `telegram`, `signal`, `webchat`, etc. |
| `kind` | `string` | `group` (channel/group), `dm` (direct message) |

---

## 3. `sessions_send` — Send a Message to an Agent

> ⚠️ **IMPORTANT: Blocked by default via HTTP!**  
> `sessions_send` is in the `DEFAULT_GATEWAY_HTTP_TOOL_DENY` list for security.  
> You **must** explicitly enable it in config.

### Enable in Config

```json
// openclaw.json
{
  "gateway": {
    "tools": {
      "allow": ["sessions_send"]
    }
  }
}
```

This removes `sessions_send` from the HTTP deny list, making it callable via `/tools/invoke`.

### HTTP Request

```http
POST /tools/invoke/sessions_send
Authorization: Bearer YOUR_TOKEN
Content-Type: application/json

{
  "sessionKey": "agent:main:discord:channel:1481217630344839262",
  "message": "שלום! מה הסטטוס שלך?",
  "timeoutSeconds": 30
}
```

**Or by label:**
```json
{
  "label": "main",
  "message": "שלום!",
  "timeoutSeconds": 30
}
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionKey` | `string` | One of these | Full session key |
| `label` | `string` | One of these | Session label (e.g. `"main"`, `"ido"`) |
| `agentId` | `string` | No | Disambiguate label across agents |
| `message` | `string` | **Yes** | Message text to send |
| `timeoutSeconds` | `number` | No | Wait timeout (0 = fire-and-forget, default 30) |

### Response Shape

```json
// Sync response (timeoutSeconds > 0):
{
  "runId": "uuid-...",
  "status": "ok",
  "reply": "ה-agent responded with this text",
  "sessionKey": "agent:main:discord:channel:...",
  "delivery": { "status": "pending", "mode": "announce" }
}

// Fire-and-forget (timeoutSeconds = 0):
{
  "runId": "uuid-...",
  "status": "accepted",
  "sessionKey": "agent:main:discord:channel:..."
}

// Timeout:
{
  "runId": "uuid-...",
  "status": "timeout",
  "sessionKey": "agent:main:discord:channel:..."
}

// Error:
{
  "status": "error",
  "error": "No session found with label: xyz"
}
```

### Status Values

| `status` | Meaning |
|----------|---------|
| `ok` | Agent responded within timeout |
| `accepted` | Queued (fire-and-forget mode) |
| `timeout` | Agent didn't respond in time |
| `error` | Something went wrong |
| `forbidden` | Access denied (agent-to-agent policy) |

---

## 4. `sessions_history` — Get Session Chat History

Returns the message history for a session.

### HTTP Request

```http
POST /tools/invoke/sessions_history
Authorization: Bearer YOUR_TOKEN
Content-Type: application/json

{
  "sessionKey": "agent:main:discord:channel:1481217630344839262",
  "limit": 50
}
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `sessionKey` | `string` | Target session key |
| `limit` | `number` | Max messages (default 200) |
| `includeTools` | `boolean` | Include tool call messages (default false) |

> **Note:** Internally this calls `sessions.get` on the gateway, which reads from the JSONL transcript file.

### Response Shape

```json
{
  "messages": [
    {
      "role": "user",
      "content": "היי, מה קורה?",
      "timestamp": 1773262329209
    },
    {
      "role": "assistant",
      "content": "הכל טוב! מה אפשר לעזור?",
      "timestamp": 1773262335000
    }
  ]
}
```

---

## 5. Status Mapping — `updatedAt` to Agent Status

Use the `updatedAt` field (Unix timestamp in ms) to derive agent presence status for the Virtual Office map:

```javascript
function getAgentStatus(session) {
  const now = Date.now();
  const idleMs = now - session.updatedAt;

  // Agent had an error/crash
  if (session.abortedLastRun) return "error";

  // Active: updated in last 2 minutes
  if (idleMs < 2 * 60 * 1000) return "active";

  // Idle: updated in last 30 minutes
  if (idleMs < 30 * 60 * 1000) return "idle";

  // Offline: last seen > 30 minutes ago
  return "offline";
}
```

### Recommended Thresholds

| Status | `updatedAt` age | Display |
|--------|-----------------|---------|
| 🟢 `active` | < 2 minutes | Green dot, animated |
| 🟡 `idle` | 2–30 minutes | Yellow dot |
| 🔴 `offline` | > 30 minutes | Grey dot |
| ⚠️ `error` | `abortedLastRun: true` | Red warning |

### Token Usage as Work Indicator

```javascript
// Agents actively processing will have higher contextTokens
const isThinking = session.totalTokens > 0 && 
                   (Date.now() - session.updatedAt) < 30_000;
```

---

## 6. Rate Limits & Best Practices

### Polling Intervals

```javascript
// Recommended polling intervals for Virtual Office:
const POLL_INTERVALS = {
  active: 10_000,    // 10s when users are watching
  background: 60_000 // 60s when app is backgrounded
};
```

> The gateway has built-in rate limiting for auth failures. Too many failed auth attempts will trigger a cooldown.

### Batching Requests

Instead of polling each agent separately, use `sessions_list` with filters:

```javascript
// ✅ Good — one call, all agents
const { sessions } = await fetch('/tools/invoke/sessions_list', {
  method: 'POST',
  body: JSON.stringify({ limit: 50 })
});

// ❌ Bad — one call per agent
for (const agentId of agentIds) {
  await fetch(`/tools/invoke/sessions_list`, {
    body: JSON.stringify({ agentId })
  });
}
```

### Error Handling

```javascript
async function callGatewayTool(toolName, params) {
  const res = await fetch(`/tools/invoke/${toolName}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GATEWAY_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(params)
  });

  // 404 = tool not available (check gateway.tools.allow config)
  if (res.status === 404) {
    throw new Error(`Tool ${toolName} not available. Check gateway.tools.allow config.`);
  }

  // 401 = auth failed
  if (res.status === 401) {
    throw new Error('Gateway auth failed. Check your token.');
  }

  // 429 = rate limited
  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After');
    throw new Error(`Rate limited. Retry after ${retryAfter}s`);
  }

  const data = await res.json();
  
  // Gateway tool errors come back as 200 with ok: false
  if (!data.ok) {
    throw new Error(data.error?.message ?? 'Gateway error');
  }

  return data;
}
```

---

## 7. Troubleshooting

### `sessions_send` blocked — Tool not available (404)

**Problem:** `POST /tools/invoke/sessions_send` returns 404 with "Tool not available".

**Cause:** `sessions_send` is blocked by default via HTTP for security (prevents remote session injection).

**Fix:** Add to `openclaw.json`:
```json
{
  "gateway": {
    "tools": {
      "allow": ["sessions_send"]
    }
  }
}
```
Then restart: `openclaw gateway restart`

---

### `params` vs `args` — Parameter format issues

**Problem:** Tool returns error about invalid params.

**Cause:** The HTTP endpoint accepts params as the **request body** (JSON), not as a nested `args` object.

```javascript
// ✅ Correct
fetch('/tools/invoke/sessions_list', {
  method: 'POST',
  body: JSON.stringify({ limit: 20, agentId: "main" })
})

// ❌ Wrong
fetch('/tools/invoke/sessions_list', {
  method: 'POST',
  body: JSON.stringify({ args: { limit: 20 } })  // don't wrap in args
})
```

---

### Session key format confusion

Session keys follow the pattern: `agent:{agentId}:{channel}:{target}`

```
agent:main:discord:channel:1481217630344839262
      ^^^^  ^^^^^^^  ^^^^^^^  ^^^^^^^^^^^^^^^^^^
      agent channel  type     channel/group ID
```

Use the exact key from `sessions_list` when calling `sessions_send`.

---

### `abortedLastRun: true` — Agent appears stuck

**Problem:** An agent shows `abortedLastRun: true`.

**Meaning:** The last AI run was interrupted (gateway restart, timeout, or error).

**Fix options:**
1. The agent will self-heal on next message
2. Send a ping message via `sessions_send`
3. Reset the session: call `sessions.reset` via the gateway WebSocket

---

### CORS issues in browser

If calling the Gateway from a browser app, ensure CORS is configured:

```json
{
  "gateway": {
    "controlUi": {
      "origins": ["http://localhost:3000", "https://your-app.vercel.app"]
    }
  }
}
```

---

### Authentication fails despite correct token

Check:
1. Token has no extra whitespace/newlines
2. Using `Bearer ` prefix (with space): `Authorization: Bearer abc123`
3. Token matches exactly what's in `openclaw.json` (case-sensitive)
4. If rate-limited from failed attempts, wait for cooldown

---

## Quick Reference

```bash
# List all sessions
curl -X POST http://localhost:PORT/tools/invoke/sessions_list \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"limit": 50}'

# Send message to agent (requires gateway.tools.allow: ["sessions_send"])
curl -X POST http://localhost:PORT/tools/invoke/sessions_send \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label": "main", "message": "ping", "timeoutSeconds": 10}'

# Get session history
curl -X POST http://localhost:PORT/tools/invoke/sessions_history \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sessionKey": "agent:main:discord:channel:123", "limit": 20}'
```

---

## 8. Virtual Office Backend API

The Virtual Office backend exposes its own REST API on top of the Gateway proxy.
These endpoints are used by the frontend and are distinct from Gateway tool calls.

### GET /api/health

```bash
curl http://localhost:3001/api/health
```

```json
{
  "status": "ok",
  "uptime": 3600,
  "wsClients": 2,
  "gateway": { "connected": true, "latencyMs": 12, "circuit": "closed" },
  "poller": { "lastPollAt": 1773262329209, "pollCount": 1800, "errorCount": 0 }
}
```

### GET /api/agents

Returns all discovered agents with current state.

```bash
curl http://localhost:3001/api/agents
```

```json
{
  "count": 13,
  "agents": [
    {
      "id": "omer",
      "name": "עומר",
      "emoji": "👨‍💻",
      "state": "working",
      "zone": "work",
      "task": "code review",
      "model": "claude-opus-4-6",
      "tokenUsage": 143369,
      "sessionKey": "agent:omer:discord:channel:..."
    }
  ]
}
```

### GET /api/seating

Returns persistent seat assignments (survives server restarts).

```bash
curl http://localhost:3001/api/seating
```

```json
{
  "ok": true,
  "assignments": {
    "omer": { "room": "work", "col": 5, "row": 1 },
    "noa":  { "room": "work", "col": 8, "row": 1 }
  }
}
```

### POST /api/seating

Assign an agent to a specific seat. Requires `X-Gateway-Token` header.

```bash
curl -X POST http://localhost:3001/api/seating \
  -H "X-Gateway-Token: YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"agentId": "omer", "room": "work", "col": 5, "row": 1}'
```

**Valid rooms:** `work`, `lounge`, `meeting`, `reception`, `coffee`  
**col/row:** integers 0–50

### DELETE /api/seating/:agentId

Remove a seat assignment (agent returns to default zone). Requires `X-Gateway-Token`.

```bash
curl -X DELETE http://localhost:3001/api/seating/omer \
  -H "X-Gateway-Token: YOUR_TOKEN"
```

### POST /api/transcribe

Transcribe an audio file via whisper.cpp. Requires `WHISPER_BIN` + `WHISPER_MODEL` in `.env`.

```bash
curl -X POST http://localhost:3001/api/transcribe \
  -F "audio=@recording.webm"
```

```json
{ "text": "מה הסטטוס של הפרויקט?" }
```

**Limits:** 25MB max file size. Internally converts to WAV 16kHz mono via ffmpeg.

---

*תיעוד זה נכתב על ידי עידו 🦞 מתוך ניתוח קוד המקור של OpenClaw v2026.3.9*  
*עדכון 2026-03-16: הוספת Backend API routes — דנה 💜*
