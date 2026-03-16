# 🏗️ Virtual Office — Architecture

> עדכון אחרון: 2026-03-16 | נכתב על ידי דנה 💜

---

## System Overview

Virtual Office is a **real-time, isometric agent monitoring dashboard** for OpenClaw teams.
It consists of three layers:

```
┌────────────────────────────────────────────────────────────┐
│                     Browser (Client)                       │
│                                                            │
│  ┌──────────────────────┐  ┌──────────────────────────┐   │
│  │   Isometric Canvas   │  │    Dashboard View (📊)    │   │
│  │   (React + HTML5)    │  │    Agent cards grid       │   │
│  └──────────┬───────────┘  └──────────────────────────┘   │
│             │ WebSocket (ws://)  + REST (/api/*)           │
└─────────────┼──────────────────────────────────────────────┘
              │
┌─────────────▼──────────────────────────────────────────────┐
│                  Backend Server (Node.js)                   │
│                                                             │
│  ┌─────────────┐  ┌────────────┐  ┌────────────────────┐  │
│  │ status-     │  │ WebSocket  │  │  REST Routes       │  │
│  │ poller.ts   │  │ handler.ts │  │  /api/agents       │  │
│  │ (2s poll)   │→ │ broadcast  │  │  /api/health       │  │
│  └──────┬──────┘  └────────────┘  │  /api/proxy/*      │  │
│         │                         │  /api/seating      │  │
│         │                         │  /api/transcribe   │  │
│         │                         └────────────────────┘  │
└─────────┼───────────────────────────────────────────────────┘
          │ HTTP REST
┌─────────▼──────────────────────────────────────────────────┐
│               OpenClaw Gateway (:18789)                    │
│                                                            │
│   POST /tools/invoke/sessions_list   — agent discovery     │
│   POST /tools/invoke/sessions_send   — send to agent       │
│   POST /tools/invoke/sessions_history — chat history       │
└────────────────────────────────────────────────────────────┘
```

---

## Component Breakdown

### Frontend — `src/App.tsx`

Single-file React app (~3000 lines). Responsible for all rendering and UI.

#### Key Components

| Component | Description |
|-----------|-------------|
| `App` | Root component. Manages state: agentDefs, selectedId, dashboardMode, editMode |
| `DashboardView` | 📊 Grid of AgentCard components. Sorted by status (working → idle → offline) |
| `AgentCard` | Single agent card: emoji avatar, status badge, task, token usage, model |
| `SettingsScreen` | Gateway token + URL configuration on first launch |
| `ChatInput` | Bidirectional chat panel — send messages, poll for replies |
| `InfoBox` | Reusable labeled info box used in the detail panel |

#### Canvas Rendering Pipeline

Every animation frame (`requestAnimationFrame`):

```
frame()
  ├── Resize canvas (DPR-aware, only if changed)
  ├── cleanBubbles() — expire old chat bubbles
  ├── Lerp agents toward target positions (smooth movement)
  ├── Compute auto-scale + apply CSS transform
  └── drawScene()
        ├── Background fill
        ├── Zone labels (Lounge / Work Zone / Bug Zone)
        ├── Floor tilemap (isometric diamonds, textured)
        ├── Walls (top + left + corner + windows)
        ├── Depth-sorted drawables:
        │     ├── Sofas, coffee table, coffee machine
        │     ├── Cubicle desks (with agent name tags)
        │     ├── Bug zone workstations
        │     ├── Decorations (Amir's pixel art sprites)
        │     └── Agents (sprite or generic fallback)
        └── Edit mode overlay (grid, placement preview)
```

#### State Management

All state lives in React `useState` + `useRef`. No external store.

| State | Type | Purpose |
|-------|------|---------|
| `agentDefs` | `AgentDef[]` | Source of truth for all agent data |
| `dashboardMode` | `boolean` | Toggle between office and dashboard views |
| `selectedId` | `string \| null` | Currently selected agent (detail panel) |
| `editMode` | `boolean` | Office decorator mode |
| `decorations` | `DecorationWithId[]` | Furniture/deco placements (persisted to localStorage) |
| `notifications` | `OfficeNotification[]` | Toast notifications for agent state changes |

#### Agent Data Model

```typescript
interface AgentDef {
  id: string          // e.g. "omer", "noa"
  name: string        // Display name (Hebrew)
  role: string        // Role description
  emoji: string       // Agent emoji
  color: string       // Brand color (hex)
  frames: number      // Sprite animation frames
  state: AgentState   // active | working | idle | offline | error
  task: string        // Current task (last message preview)
  cubicleIndex: number // Fixed desk assignment
  lastUpdated?: number // Timestamp of last activity (ms)
  sessionKey?: string  // Full Gateway session key
  model?: string       // LLM model name
  tokenUsage?: number  // Cumulative token count
}
```

#### Zone Logic

Agents move between zones based on their state:

```
working / active  →  💻 Work Zone  (cubicle desk)
idle / offline    →  ☕ Lounge     (sofa area)
error             →  🐛 Bug Zone   (red desks)
```

Movement is animated via lerp (linear interpolation) at 3% per frame.

---

### Backend — `server/src/`

Express + WebSocket server. Polls the Gateway and relays data to browsers.

#### File Structure

```
server/src/
├── index.ts                  # Entry point — Express app, routes, WS init
├── config/
│   └── agents.ts             # AGENT_REGISTRY: known agents + metadata
├── routes/
│   ├── api.ts                # GET /api/health, GET /api/agents, GET /api/agents/:id
│   ├── proxy.ts              # POST /api/proxy/sessions, /send, /history
│   ├── seating.ts            # GET/POST/DELETE /api/seating
│   └── transcribe.ts         # POST /api/transcribe — whisper.cpp voice transcription
├── services/
│   ├── gateway-client.ts     # HTTP client for OpenClaw Gateway + circuit breaker
│   └── status-poller.ts      # Polls Gateway every 2s, updates agent state
└── ws/
    └── handler.ts            # WebSocket server — broadcast state to all clients
```

#### REST API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Gateway connectivity + uptime + WS client count |
| `GET` | `/api/agents` | All agents with current state and zone |
| `GET` | `/api/agents/:id` | Single agent details |
| `POST` | `/api/proxy/sessions` | Proxy → `sessions_list` (discovery + status) |
| `POST` | `/api/proxy/send` | Proxy → `sessions_send` (chat message to agent) |
| `POST` | `/api/proxy/history` | Proxy → `sessions_history` (chat history) |
| `GET` | `/api/seating` | Persistent seat assignments |
| `POST` | `/api/seating` | Save seat assignment `{ agentId, room, col, row }` |
| `DELETE` | `/api/seating/:id` | Remove seat assignment |
| `POST` | `/api/transcribe` | Transcribe audio via whisper.cpp |

#### GET /api/health — Response

```json
{
  "status": "ok",
  "uptime": 3600,
  "wsClients": 2,
  "gateway": {
    "connected": true,
    "latencyMs": 12,
    "circuit": "closed"
  },
  "poller": {
    "lastPollAt": 1773262329209,
    "pollCount": 1800,
    "errorCount": 0
  }
}
```

#### GET /api/agents — Response

```json
{
  "count": 13,
  "agents": [
    {
      "id": "omer",
      "name": "עומר",
      "emoji": "👨‍💻",
      "role": "Tech Lead",
      "state": "working",
      "zone": "work",
      "task": "code review: virtual-office-poc",
      "lastActivity": 1773262329209,
      "model": "claude-opus-4-6",
      "tokenUsage": 143369,
      "sessionKey": "agent:omer:discord:channel:..."
    }
  ]
}
```

#### WebSocket Events

The server broadcasts a full state snapshot to all connected clients on every poll cycle:

```typescript
// Event sent by server → all clients
{
  type: "agents_update",
  agents: AgentStatus[],
  timestamp: number
}

// Client → server (optional ping)
{ type: "ping" }

// Server → client (pong)
{ type: "pong", serverTime: number }
```

#### Circuit Breaker (gateway-client.ts)

Protects against Gateway downtime:

```
CLOSED → normal operation (requests pass through)
   ↓ (5 consecutive failures)
OPEN → requests blocked, return cached data
   ↓ (after 30s cooldown)
HALF-OPEN → one test request
   ↓ (success)
CLOSED → normal operation resumed
```

---

### Dashboard Mode — `DashboardView`

Toggle between **isometric office** and **dashboard grid** via the 📊 button.

```
┌──────────────────────────────────────────────────────┐
│  📊 Dashboard — Team Status                           │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ 👨‍💻 עומר  │  │ 🎨 נועה   │  │ 🗄️ איתי  │           │
│  │ 🔵 עובד  │  │ 🔵 עובד  │  │ 🟡 ממתין │           │
│  │ code rev │  │ UI fixes │  │ —        │           │
│  │ 143k tok │  │ 98k tok  │  │ 122k tok │           │
│  │ opus-4-6 │  │ opus-4-6 │  │ opus-4-6 │           │
│  └──────────┘  └──────────┘  └──────────┘           │
└──────────────────────────────────────────────────────┘
```

**Sort order:** working → active → idle → error → offline

**Responsive grid:**
- Desktop (>1024px): 3 columns
- Tablet (768–1024px): 2 columns
- Mobile (<768px): 1 column

---

## Data Flow

### Agent Discovery (first poll)

```
Browser loads
    → Frontend connects to ws://backend
    → Backend status-poller starts (2s interval)
    → Gateway /tools/invoke/sessions_list
    → Parse sessions → group by agentId → build AgentDef[]
    → WS broadcast → Frontend updates canvas + Dashboard
```

### Real-time Status Updates

```
Every 2 seconds:
    status-poller.ts
        → GET /tools/invoke/sessions_list (activeMinutes: 120)
        → Compare updatedAt with previous poll
        → Detect state transitions (working/idle/offline/error)
        → WS broadcast { type: "agents_update", agents: [...] }
        → Frontend: update agentDefs → re-render canvas
        → Frontend: toast notification if agent finished task
```

### Chat Message Flow

```
User types in ChatInput
    → POST /api/proxy/send { sessionKey, message }
    → Backend → POST /tools/invoke/sessions_send
    → Agent receives message, processes, responds
    → Frontend polls /api/proxy/history every 3s
    → New assistant message appears in chat panel
    → addChatBubble() → speech bubble above agent on canvas
```

---

## Deployment

### Development

```bash
npm run dev         # Frontend: http://localhost:3000
cd server && npm run dev  # Backend: http://localhost:3001
```

### Production

```bash
npm run build       # → dist/
cd server && npm run build  # → server/dist/

# Serve via systemd (see SERVICE_SETUP.md)
sudo systemctl start virtual-office
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GATEWAY_URL` | ✅ | — | OpenClaw Gateway URL |
| `GATEWAY_TOKEN` | ✅ | — | Auth token |
| `PORT` | — | `3001` | Backend port |
| `STATIC_DIR` | — | `../dist` | Frontend build path |
| `WHISPER_BIN` | — | — | whisper.cpp binary path |
| `WHISPER_MODEL` | — | — | Whisper model path |

---

## Security Considerations

See `docs/SECURITY-AUDIT.md` for full audit.

Key points:
- Gateway token stored in `server/.env` (never in frontend code)
- `sessions_send` requires explicit `gateway.tools.allow` config
- All Gateway calls proxied through backend — token never exposed to browser
- Circuit breaker prevents request storms on Gateway downtime

---

*See also: [GATEWAY-API.md](./GATEWAY-API.md) | [DASHBOARD.md](./DASHBOARD.md)*
