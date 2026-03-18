# 📊 Dashboard Mode — Documentation

> עדכון אחרון: 2026-03-16 | נכתב על ידי דנה 💜

---

## Overview

Dashboard Mode is an alternative view to the isometric office that displays all agents as a **responsive card grid**.
It is designed for quick team status monitoring — especially useful when you have many agents and want data at a glance.

Toggle it via the **📊 button** in the top toolbar (next to ⚙️ settings and 🔊 sound).

---

## UI Layout

```
┌─────────────────────────────────────────────────────────────┐
│  ⚙️  🔊  📊  🎨 עיצוב משרד                  [notifications]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  📊 Dashboard — Team Status                                 │
│                                                             │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐   │
│  │  ██ 👨‍💻 עומר   │  │  ██ 🎨 נועה   │  │  ██ 🗄️ איתי   │  │
│  │  Tech Lead    │  │  Frontend/UX  │  │  Backend/API  │  │
│  │  🔵 עובד      │  │  🔵 עובד      │  │  🟡 ממתין     │  │
│  │               │  │               │  │               │  │
│  │  משימה:       │  │  משימה:       │  │  משימה:       │  │
│  │  code review  │  │  isometric UI │  │  —            │  │
│  │               │  │               │  │               │  │
│  │  פעיל לפני:   │  │  פעיל לפני:   │  │  פעיל לפני:   │  │
│  │  עכשיו        │  │  לפני 3 דקות  │  │  לפני 25 דקות │  │
│  │  טוקנים: 143k │  │  טוקנים: 98k  │  │  טוקנים: 122k │  │
│  │  מודל:        │  │  מודל:        │  │  מודל:        │  │
│  │  claude-opus  │  │  claude-opus  │  │  claude-opus  │  │
│  └───────────────┘  └───────────────┘  └───────────────┘   │
│                                                             │
│  ┌───────────────┐  ┌───────────────┐  ...                 │
│  │  ██ ⚙️ גיל    │  │  ██ 🔍 מיכל   │                      │
│  │  ...          │  │  ...          │                      │
└─────────────────────────────────────────────────────────────┘
```

---

## Card Structure

Each agent card (`AgentCard` component) displays:

| Field | Source | Description |
|-------|--------|-------------|
| **Emoji avatar** | `AgentDef.emoji` | Large emoji in colored box |
| **Name** | `AgentDef.name` | Hebrew agent name |
| **Role** | `AgentDef.role` | e.g. "Tech Lead", "Frontend/UX" |
| **Status badge** | `AgentDef.state` | Color-coded: 🔵 עובד / 🟢 פעיל / 🟡 ממתין / ⚫ לא מחובר / 🔴 שגיאה |
| **Current task** | `AgentDef.task` | Last message preview (max 60 chars) |
| **Last active** | `AgentDef.lastUpdated` | Time since last activity (relative) |
| **Token usage** | `AgentDef.tokenUsage` | Cumulative tokens (e.g. "143k") |
| **Model** | `AgentDef.model` | LLM model name (e.g. "claude-opus-4-6") |

---

## Sorting

Cards are sorted by status priority (most active first):

```
1. working  🔵 — actively processing
2. active   🟢 — recently active
3. idle     🟡 — inactive < 30 min
4. error    🔴 — aborted last run
5. offline  ⚫ — inactive > 30 min
```

---

## Responsive Layout

| Breakpoint | Columns |
|------------|---------|
| Desktop (`>1024px`) | 3 |
| Tablet (`768–1024px`) | 2 |
| Mobile (`<768px`) | 1 |

---

## Implementation

### Toggle State

```typescript
// In App component:
const [dashboardMode, setDashboardMode] = useState(false)

// Toggle button:
<button onClick={() => setDashboardMode(m => !m)}>📊</button>

// Conditional render:
{dashboardMode && (
  <DashboardView
    agents={agentDefs}
    breakpoint={breakpoint}
    selectedId={selectedId}
    onSelectAgent={(id) => setSelectedId(prev => prev === id ? null : id)}
  />
)}
```

### DashboardView Component

```typescript
function DashboardView({ agents, breakpoint, selectedId, onSelectAgent }) {
  const sortOrder = { working: 0, active: 1, idle: 2, error: 3, offline: 4 }
  const sorted = [...agents].sort((a, b) => sortOrder[a.state] - sortOrder[b.state])
  const cols = breakpoint === 'desktop' ? 3 : breakpoint === 'tablet' ? 2 : 1

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#1a1a2e', overflowY: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 16 }}>
        {sorted.map(agent => (
          <AgentCard key={agent.id} agent={agent} isSelected={selectedId === agent.id} onClick={...} />
        ))}
      </div>
    </div>
  )
}
```

### Data Requirements

`DashboardView` reads from `AgentDef[]` — the same data source as the isometric canvas.

`model` and `tokenUsage` are populated from Gateway `sessions_list` response:

```typescript
// In status-poller.ts / agentDefFromSession():
def.model = session.model ?? undefined
def.tokenUsage = session.totalTokens ?? undefined
```

These fields are `undefined` in **demo mode** (no Gateway token) and will display as `"—"`.

---

## Visual Style

Dashboard uses the same **pixel art aesthetic** as the rest of the app:

- `border-radius: 0` everywhere (no rounded corners)
- `"Press Start 2P"` font
- Pixel-style box shadows: `inset -2px -2px 0 #0a0a1a, inset 2px 2px 0 #2a2a4a`
- Status color corner dot (top-right of each card)
- Background: `#1a1a2e` (same as canvas background)
- Cards: `#16162b` with colored border on selection

---

## Interaction

- **Click a card** → opens the detail panel (same as clicking an agent on the canvas)
- **Click again / click ✕** → deselects
- **Dashboard + detail panel** work together — you can chat with an agent from within Dashboard Mode

---

*See also: [ARCHITECTURE.md](./ARCHITECTURE.md) | [GATEWAY-API.md](./GATEWAY-API.md)*
