import { useRef, useEffect, useState, useCallback } from 'react'

// ── Types ──
type AgentState = 'active' | 'idle' | 'working' | 'offline' | 'error'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  ts: number
  source?: string // channel source: 'discord', 'telegram', 'webchat', etc.
}

// Filter out internal/system messages that shouldn't appear in chat UI
const INTERNAL_MSG_PATTERNS = [
  /agent-to-agent announce/i,
  /ANNOUNCE_SKIP/i,
  /HEARTBEAT_OK/i,
  /^NO_REPLY$/i,
  /^\[Inter-session message\]/,
  /^\[.*announce.*step\]/i,
]
function isVisibleMessage(msg: ChatMessage): boolean {
  return !INTERNAL_MSG_PATTERNS.some(p => p.test(msg.text.trim()))
}

function deduplicateMessages(msgs: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>()
  return msgs.filter(m => {
    // Deduplicate by ID
    if (seen.has(m.id)) return false
    seen.add(m.id)
    // Also deduplicate by exact text+role within 5s window
    const key = `${m.role}:${m.text}`
    const duplicate = msgs.some(other =>
      other !== m && other.role === m.role && other.text === m.text &&
      Math.abs(other.ts - m.ts) < 5000 && seen.has(other.id) === false
    )
    return true
  })
}

interface AgentDef {
  id: string
  name: string
  role: string
  emoji: string
  color: string
  frames: number
  state: AgentState
  task: string
  cubicleIndex: number // permanent cubicle slot (0-11)
  lastUpdated?: number // timestamp ms
  sessionKey?: string // full Gateway session key for messaging
  model?: string      // LLM model name (from session data)
  tokenUsage?: number // total tokens used (from session data)
}

interface AgentRuntime {
  def: AgentDef
  x: number
  y: number
  tx: number
  ty: number
  zone: Zone
}

type Zone = 'work' | 'lounge' | 'bugs'

// ── Isometric constants ──
const TILE_W = 64
const TILE_H = 32
const BASE_MAP_COLS = 20
const BASE_MAP_ROWS = 16
const SPRITE_SIZE = 32
const SPRITE_DISPLAY = 64 // 2x scale

// Dynamic grid — expands with agent count (supports up to 50+)
let MAP_COLS = BASE_MAP_COLS
let MAP_ROWS = BASE_MAP_ROWS

/**
 * HORIZONTAL ZONE LAYOUT (top to bottom):
 *   ☕ Lounge (top)   — idle/offline agents
 *   💻 Work (middle)  — active/working agents
 *   🐛 Errors (bottom) — error state agents (thin strip)
 *
 * All zones span full width. Height grows dynamically with agent count.
 */
const COLS_PER_AGENT = 4   // horizontal spacing between agents
const ROWS_PER_AGENT = 4   // vertical spacing between agents

// Dynamic — updated in computeGridSize
let AGENTS_PER_ROW = 4
let LOUNGE_START_ROW = 1
let LOUNGE_END_ROW = 5
let WORK_START_ROW = 6
let WORK_END_ROW = 10
let ERROR_START_ROW = 11
let ERROR_END_ROW = 13

function getAgentsPerRow(agentCount: number): number {
  if (agentCount <= 6) return 3
  if (agentCount <= 12) return 4
  if (agentCount <= 20) return 5
  if (agentCount <= 30) return 6
  if (agentCount <= 42) return 7
  return 8  // 50+ agents
}
function computeGridSize(agentCount: number) {
  const n = Math.max(agentCount, 1)
  AGENTS_PER_ROW = getAgentsPerRow(n)

  // All zones span full width
  const zoneWidth = AGENTS_PER_ROW * COLS_PER_AGENT + 2

  // Lounge zone (top) — room for ALL agents (worst case: all idle)
  const loungeAgentRows = Math.ceil(n / AGENTS_PER_ROW)
  LOUNGE_START_ROW = 1
  LOUNGE_END_ROW = LOUNGE_START_ROW + loungeAgentRows * ROWS_PER_AGENT + 1

  // Work zone (middle) — room for ALL agents
  const workAgentRows = Math.ceil(n / AGENTS_PER_ROW)
  WORK_START_ROW = LOUNGE_END_ROW + 1
  WORK_END_ROW = WORK_START_ROW + workAgentRows * ROWS_PER_AGENT + 1

  // Error zone (bottom) — thin strip, max 1-2 rows of agents
  const errorAgentRows = Math.max(1, Math.ceil(Math.min(n, AGENTS_PER_ROW * 2) / AGENTS_PER_ROW))
  ERROR_START_ROW = WORK_END_ROW + 1
  ERROR_END_ROW = ERROR_START_ROW + errorAgentRows * ROWS_PER_AGENT

  MAP_COLS = Math.max(BASE_MAP_COLS, zoneWidth)
  MAP_ROWS = Math.max(BASE_MAP_ROWS, ERROR_END_ROW + 1)
}

// ── Responsive breakpoints ──
const BP_MOBILE = 480   // compact (phone portrait)
const BP_TABLET = 768   // small tablet / phone landscape
const BP_DESKTOP = 1024 // standard desktop

type Breakpoint = 'compact' | 'mobile' | 'tablet' | 'desktop'

function getBreakpoint(w: number): Breakpoint {
  if (w < BP_MOBILE) return 'compact'
  if (w < BP_TABLET) return 'mobile'
  if (w < BP_DESKTOP) return 'tablet'
  return 'desktop'
}

// Responsive font sizes for canvas rendering
function getCanvasFontSizes(bp: Breakpoint) {
  switch (bp) {
    case 'compact': return { title: 12, zone: 9, name: 8, cubicle: 7 }
    case 'mobile':  return { title: 13, zone: 10, name: 9, cubicle: 8 }
    case 'tablet':  return { title: 14, zone: 11, name: 10, cubicle: 8 }
    case 'desktop': return { title: 16, zone: 12, name: 11, cubicle: 9 }
  }
}

// ── Chat Bubbles — messages that appear above agents and fade out ──

interface ChatBubble {
  agentId: string
  text: string       // max 80 chars
  createdAt: number  // performance.now()
  duration: number   // ms (default 5000)
}

/** Active chat bubbles — managed externally, drawn on canvas */
const chatBubbles: ChatBubble[] = []

/** Add a chat bubble above an agent (max 80 chars, 5s default) */
function addChatBubble(agentId: string, text: string, durationMs = 5000) {
  // Remove existing bubble for this agent
  const idx = chatBubbles.findIndex(b => b.agentId === agentId)
  if (idx !== -1) chatBubbles.splice(idx, 1)
  chatBubbles.push({
    agentId,
    text: text.length > 80 ? text.substring(0, 77) + '...' : text,
    createdAt: performance.now(),
    duration: durationMs,
  })
}

/** Trim expired bubbles */
function cleanBubbles(now: number) {
  for (let i = chatBubbles.length - 1; i >= 0; i--) {
    if (now - chatBubbles[i].createdAt > chatBubbles[i].duration) {
      chatBubbles.splice(i, 1)
    }
  }
}

/** Truncate task text to ~20 chars for the task label */
function shortTask(task: string | undefined): string {
  if (!task) return ''
  // Take first 2-3 Hebrew words
  const words = task.split(/\s+/).slice(0, 3).join(' ')
  return words.length > 22 ? words.substring(0, 20) + '…' : words
}

// ── Isometric helpers ──

/** Convert cartesian tile coords → isometric screen coords */
function toIso(cx: number, cy: number): [number, number] {
  return [
    (cx - cy) * (TILE_W / 2),
    (cx + cy) * (TILE_H / 2),
  ]
}

// ── Zone definitions (in tile coords) — uses dynamic grid size ──
function getZoneAt(col: number, row: number): Zone {
  // Horizontal zones: top=lounge, middle=work, bottom=errors
  if (row >= ERROR_START_ROW) return 'bugs'
  if (row >= WORK_START_ROW) return 'work'
  return 'lounge'
}

// ── Tilemap — dynamically generated ──
// 0 = wood floor, 1 = stone floor, 2 = carpet, 3 = dark floor (bug zone)

/** Generate floor map for current MAP_COLS × MAP_ROWS */
function generateFloorMap(): number[][] {
  const map: number[][] = []
  for (let row = 0; row < MAP_ROWS; row++) {
    const r: number[] = []
    for (let col = 0; col < MAP_COLS; col++) {
      const zone = getZoneAt(col, row)
      if (zone === 'lounge') r.push(2)       // carpet/lounge
      else if (zone === 'bugs') r.push(3)    // dark/bug zone
      else r.push(0)                          // work zone
    }
    map.push(r)
  }
  return map
}

let FLOOR_MAP = generateFloorMap()

// Floor tile colors (2 shades each for checkerboard pattern)
// Distinct colors per zone — easy to see where each zone is
const FLOOR_STYLES: Record<number, [string, string]> = {
  0: ['#2a1f14', '#332618'],  // work zone — warm wood
  1: ['#1a3040', '#1e3848'],  // stone — cool blue-gray
  2: ['#3a2820', '#422e24'],  // lounge — carpet brown
  3: ['#3a1a1a', '#421e1e'],  // bug zone — dark red
}

// Wall tiles — positions along edges
interface WallTile {
  col: number
  row: number
  type: 'top' | 'left' | 'right' | 'corner_tl' | 'corner_tr' | 'window'
}

/** Generate walls for current grid dimensions */
function generateWalls(): WallTile[] {
  const walls: WallTile[] = [
    // Top wall (full width)
    { col: 0, row: -1, type: 'corner_tl' },
    ...Array.from({ length: MAP_COLS - 1 }, (_, i) => ({
      col: i + 1, row: -1,
      type: (i % 5 === 3) ? 'window' as const : 'top' as const,
    })),
    { col: MAP_COLS, row: -1, type: 'corner_tr' },
    // Left wall (full height)
    ...Array.from({ length: MAP_ROWS }, (_, i) => ({
      col: -1, row: i,
      type: (i % 5 === 2) ? 'window' as const : 'left' as const,
    })),
    // Right wall (full height) — mirrors left wall
    ...Array.from({ length: MAP_ROWS }, (_, i) => ({
      col: MAP_COLS, row: i,
      type: (i % 5 === 2) ? 'window' as const : 'right' as const,
    })),
  ]
  return walls
}

let WALLS = generateWalls()

// ── Cubicle positions — generated dynamically based on agent count ──
function generateCubiclePositions(count: number): [number, number][] {
  const cols = Math.min(AGENTS_PER_ROW, Math.max(1, count))
  const rows = Math.ceil(count / cols)
  const positions: [number, number][] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols && positions.length < count; c++) {
      positions.push([1 + c * COLS_PER_AGENT, WORK_START_ROW + 1 + r * ROWS_PER_AGENT])
    }
  }
  return positions
}

// Default cubicles (overridden when agents are discovered)
let CUBICLE_POSITIONS: [number, number][] = generateCubiclePositions(12)

// Pan clamping
function clampPan(pan: { x: number; y: number }) {
  const { isoW, isoH } = getIsoBounds()
  const maxX = isoW * 0.5
  const maxY = isoH * 0.5
  pan.x = Math.max(-maxX, Math.min(maxX, pan.x))
  pan.y = Math.max(-maxY, Math.min(maxY, pan.y))
}

// ── Lounge furniture positions ──
const SOFA_POSITIONS: [number, number][] = [
]
const COFFEE_TABLE: [number, number] = [2, 5]
const COFFEE_MACHINE: [number, number] = [0, 0]

// ── Bug zone workstation positions (dynamic) ──
function generateBugWorkstations(): [number, number][] {
  const startCol = Math.max(10, MAP_COLS - 6) + 1
  const startRow = Math.max(8, MAP_ROWS - 4) + 1
  return [
    [startCol, startRow],
    [startCol + 2, startRow],
    [startCol + 1, startRow + 1],
    [startCol, startRow + 2],
    [startCol + 2, startRow + 2],
  ]
}
let BUG_WORKSTATIONS = generateBugWorkstations()

// ── Decoration positions (Amir's assets) ──
interface Decoration {
  type: string
  col: number
  row: number
  scale?: number
}

interface DecorationWithId extends Decoration {
  _id: number // unique id for editing
}

interface EditState {
  active: boolean
  selectedDecoId: number | null
  draggingDecoId: number | null
  placementPreview: { type: string; col: number; row: number } | null
}

let _decoIdCounter = 0
function nextDecoId() { return ++_decoIdCounter }

const DEFAULT_DECORATIONS: Decoration[] = [
  // Minimal — just a few plants for life
  { type: 'plant_large', col: 0, row: 0, scale: 1.1 },
  { type: 'plant_small', col: 0, row: 8, scale: 1 },
]

// ── Decoration persistence ──
function loadLayout(): DecorationWithId[] {
  try {
    const saved = localStorage.getItem('office-layout-v2')
    if (saved) {
      const parsed = JSON.parse(saved) as Decoration[]
      return parsed.map(d => ({ ...d, _id: nextDecoId() }))
    }
  } catch { /* ignore */ }
  return DEFAULT_DECORATIONS.map(d => ({ ...d, _id: nextDecoId() }))
}

function saveLayout(decos: DecorationWithId[]) {
  const clean = decos.map(({ _id, ...rest }) => rest)
  localStorage.setItem('office-layout-v2', JSON.stringify(clean))
}

// Available decoration types for the editor sidebar
const AVAILABLE_DECO_TYPES = [
  { type: 'plant_large', label: 'צמח גדול', emoji: '🌿' },
  { type: 'plant_small', label: 'צמח קטן', emoji: '🌱' },
  { type: 'bookshelf', label: 'ארון ספרים', emoji: '📚' },
  { type: 'whiteboard', label: 'לוח', emoji: '📝' },
  { type: 'kanban_board', label: 'קאנבן', emoji: '📋' },
  { type: 'water_cooler', label: 'מים', emoji: '💧' },
  { type: 'printer', label: 'מדפסת', emoji: '🖨️' },
  { type: 'coffee_machine', label: 'קפה', emoji: '☕' },
  { type: 'trophy', label: 'גביע', emoji: '🏆' },
  { type: 'motivation_sign', label: 'שלט', emoji: '💪' },
  { type: 'team_photo', label: 'תמונת צוות', emoji: '📸' },
  { type: 'picture_frame', label: 'מסגרת', emoji: '🖼️' },
  { type: 'mug', label: 'כוס', emoji: '☕' },
  { type: 'keyboard', label: 'מקלדת', emoji: '⌨️' },
  { type: 'mouse', label: 'עכבר', emoji: '🖱️' },
  { type: 'laptop', label: 'לפטופ', emoji: '💻' },
  { type: 'monitor_wall', label: 'מסך קיר', emoji: '🖥️' },
  { type: 'server_rack_mini', label: 'שרת', emoji: '🗄️' },
  { type: 'alert_light', label: 'אור התראה', emoji: '🚨' },
  { type: 'candle', label: 'נר', emoji: '🕯️' },
  { type: 'phone', label: 'טלפון', emoji: '📱' },
  { type: 'stickers', label: 'מדבקות', emoji: '🏷️' },
  { type: 'wireframes', label: 'וויירפריימס', emoji: '📐' },
  { type: 'tea_cup', label: 'תה', emoji: '🍵' },
  { type: 'poster', label: 'פוסטר', emoji: '🎨' },
  { type: 'lamp', label: 'מנורה', emoji: '💡' },
  { type: 'trash_bin', label: 'פח', emoji: '🗑️' },
  { type: 'clock', label: 'שעון', emoji: '🕐' },
  { type: 'fan', label: 'מאוורר', emoji: '🌀' },
  { type: 'calendar', label: 'לוח שנה', emoji: '📅' },
  { type: 'headphones', label: 'אוזניות', emoji: '🎧' },
  { type: 'warning_sign', label: 'שלט אזהרה', emoji: '⚠️' },
]

// Decoration hit-test
function hitTestDeco(
  mx: number, my: number,
  decos: DecorationWithId[],
  ox: number, oy: number,
): DecorationWithId | null {
  // Check from front to back
  const sorted = [...decos].sort((a, b) => (b.col + b.row) - (a.col + a.row))
  for (const d of sorted) {
    const [ix, iy] = toIso(d.col, d.row)
    const sx = ox + ix
    const sy = oy + iy
    const s = (d.scale ?? 1) * SPRITE_SIZE / 2
    if (mx >= sx - s && mx <= sx + s && my >= sy - s - 10 && my <= sy + 10) {
      return d
    }
  }
  return null
}

// Convert screen coords to tile coords
function screenToTile(mx: number, my: number, ox: number, oy: number): [number, number] {
  const sx = mx - ox
  const sy = my - oy
  const col = (sx / (TILE_W / 2) + sy / (TILE_H / 2)) / 2
  const row = (sy / (TILE_H / 2) - sx / (TILE_W / 2)) / 2
  return [Math.round(col), Math.round(row)]
}

// Decoration images — loaded lazily
const decoImages: Record<string, HTMLImageElement> = {}
const furnitureImages: Record<string, HTMLImageElement> = {}
let decoInitialized = false

function loadDecorations() {
  if (decoInitialized) return
  decoInitialized = true

  // Decoration sprites
  const decoTypes = [
    'alert_light', 'calendar', 'candle', 'clock', 'fan', 'headphones',
    'kanban_board', 'keyboard', 'lamp', 'monitor_wall', 'motivation_sign',
    'mouse', 'mug', 'phone', 'picture_frame', 'plant', 'plant_tall',
    'poster', 'server_rack_mini', 'stickers', 'tea_cup', 'team_photo',
    'trash_bin', 'trophy', 'warning_sign', 'window', 'wireframes',
  ]
  for (const t of decoTypes) {
    const img = new Image()
    img.src = `/assets/decorations/${t}.png`
    decoImages[t] = img
  }

  // Furniture sprites
  const furnTypes = [
    'bookshelf', 'carpet', 'chair', 'chair_office', 'chair_simple',
    'coat_rack', 'coffee_machine', 'desk', 'desk_large', 'desk_l_shaped',
    'furniture', 'laptop', 'lounge_table', 'monitor', 'monitor_desktop',
    'monitor_dual', 'plant_large', 'plant_small', 'printer', 'sofa',
    'water_cooler', 'whiteboard',
  ]
  for (const t of furnTypes) {
    const img = new Image()
    img.src = `/assets/furniture/${t}.png`
    furnitureImages[t] = img
  }
}

function getDecoImage(type: string): HTMLImageElement | null {
  return decoImages[type] ?? furnitureImages[type] ?? null
}

// ── Known agent visuals (backward compatible with our team's sprites) ──
// Dynamic agent registry — populated from Gateway sessions, NOT hardcoded
const KNOWN_AGENTS: Record<string, { name: string; role: string; emoji: string; color: string; frames: number; fixedIndex: number }> = {}

// Dynamic list of all agent IDs — populated from Gateway sessions
const ALL_AGENT_IDS: string[] = []

// Fallback emojis for dynamically discovered agents
const AGENT_EMOJIS = ['🤖', '👨‍💻', '👩‍💻', '🧑‍💻', '🎨', '🔧', '📊', '🔍', '📋', '💡', '🎯', '⚡', '🌟', '🔮', '🎪', '🦊']

// Fallback colors for unknown agents (cycled)
const FALLBACK_COLORS = [
  '#E91E63', '#9C27B0', '#673AB7', '#3F51B5', '#2196F3', '#00BCD4',
  '#009688', '#4CAF50', '#8BC34A', '#FF9800', '#FF5722', '#795548',
]

// Build AgentDef from a session key (e.g. "agent:yogi:discord:channel:123")
/** State-based fallback labels when no real task text is available */
const TASK_FALLBACKS: Record<string, string> = {
  working: 'עובד...',
  active: 'מחובר',
  idle: 'ממתין',
  offline: 'לא מחובר',
  error: 'שגיאה',
}

/** Extract best task text from a session's last message(s) */
function extractTaskFromSession(session: any, state?: string): { text: string; isFallback: boolean } {
  const msgs = session.messages ?? []
  // Try messages in order (most recent first)
  for (const m of msgs) {
    // Try preview first (human-readable summary)
    const preview = m.preview?.substring(0, 100)?.trim()
    if (preview) return { text: preview, isFallback: false }
    // Try content (could be string or array)
    const content = typeof m.content === 'string'
      ? m.content.substring(0, 100).trim()
      : Array.isArray(m.content)
        ? m.content.find((c: any) => c.type === 'text')?.text?.substring(0, 100)?.trim()
        : undefined
    if (content) return { text: content, isFallback: false }
    // Try text field
    const text = m.text?.substring(0, 100)?.trim()
    if (text) return { text: text, isFallback: false }
  }
  // Fallback: session label or description if available
  const label = session.label?.substring(0, 100)?.trim()
  if (label) return { text: label, isFallback: false }
  // Final fallback: state-based label
  const fallback = (state && TASK_FALLBACKS[state]) || ''
  return { text: fallback, isFallback: true }
}

function agentDefFromSession(sessionKey: string, index: number, updatedAt: number, aborted: boolean, lastMsg?: string): AgentDef {
  const match = sessionKey.match(/^agent:([^:]+)/)
  const id = match ? match[1] : sessionKey
  
  // Dynamically register agent if not yet known
  if (!KNOWN_AGENTS[id]) {
    KNOWN_AGENTS[id] = {
      name: id,
      role: 'Agent',
      emoji: AGENT_EMOJIS[Object.keys(KNOWN_AGENTS).length % AGENT_EMOJIS.length],
      color: FALLBACK_COLORS[Object.keys(KNOWN_AGENTS).length % FALLBACK_COLORS.length],
      frames: 6,
      fixedIndex: Object.keys(KNOWN_AGENTS).length,
    }
    if (!ALL_AGENT_IDS.includes(id)) ALL_AGENT_IDS.push(id)
  }
  const known = KNOWN_AGENTS[id]

  // Determine state from updatedAt
  const elapsed = Date.now() - updatedAt
  let state: AgentState
  if (aborted) state = 'error'
  else if (elapsed < 30_000) state = 'working'
  else if (elapsed < 300_000) state = 'idle'
  else state = 'offline'

  return {
    id,
    name: known?.name ?? id,
    role: known?.role ?? 'Agent',
    emoji: known?.emoji ?? '🤖',
    color: known?.color ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length],
    frames: known?.frames ?? 6,
    state,
    task: lastMsg ?? '',
    cubicleIndex: index,
    lastUpdated: updatedAt,
    sessionKey,
    model: undefined as string | undefined,
    tokenUsage: undefined as number | undefined,
  }
}

// ── Default demo agents (used when no Gateway token) ──
const _now = Date.now()
// No hardcoded agents — demo mode shows empty office until Gateway connects
const DEFAULT_AGENT_DEFS: AgentDef[] = []
const STATE_META: Record<AgentState, { color: string; label: string; dot: string }> = {
  active:  { color: '#4CAF50', label: 'פעיל',      dot: '🟢' },
  working: { color: '#2196F3', label: 'עובד',      dot: '🔵' },
  idle:    { color: '#FFC107', label: 'ממתין',     dot: '🟡' },
  offline: { color: '#757575', label: 'לא מחובר', dot: '⚫' },
  error:   { color: '#f44336', label: 'שגיאה',    dot: '🔴' },
}

// ── Zone assignment logic ──
function getZoneForState(state: AgentState): Zone {
  if (state === 'working' || state === 'active') return 'work'
  if (state === 'error') return 'bugs'
  return 'lounge'
}

// ── Lounge spots — horizontal zone at top ──
function generateLoungeSpots(count: number): [number, number][] {
  const spots: [number, number][] = []
  const cols: number[] = []
  for (let i = 0; i < AGENTS_PER_ROW; i++) cols.push(1 + i * COLS_PER_AGENT)
  const rowsNeeded = Math.ceil(count / cols.length)
  for (let r = 0; r < rowsNeeded; r++) {
    for (const c of cols) {
      if (spots.length >= count) break
      spots.push([c, LOUNGE_START_ROW + 1 + r * ROWS_PER_AGENT])
    }
  }
  return spots
}

let LOUNGE_SPOTS = generateLoungeSpots(12)
// Sofa at every lounge spot
// Sofas positioned 1 tile offset from agent spots (so agents sit beside, not on)
let LOUNGE_SOFA_POSITIONS = LOUNGE_SPOTS.map(([c, r]): [number, number] => [c + 1, r - 1])

// ── Bug zone spots (5 unique positions) ──
// Bug zone spots — spaced out in the larger map
// Bug zone spots — dynamically positioned in the bottom-right
function generateBugSpots(count: number): [number, number][] {
  const spots: [number, number][] = []
  const cols: number[] = []
  for (let i = 0; i < AGENTS_PER_ROW; i++) cols.push(1 + i * COLS_PER_AGENT)
  const rowsNeeded = Math.max(1, Math.ceil(count / cols.length))
  for (let r = 0; r < rowsNeeded; r++) {
    for (const c of cols) {
      if (spots.length >= count) break
      spots.push([c, ERROR_START_ROW + 1 + r * ROWS_PER_AGENT])
    }
  }
  return spots
}
let BUG_SPOTS = generateBugSpots(12)

// Track which lounge/bug spots are taken (by agent id)
const workAssignments: Map<string, number> = new Map()
const loungeAssignments: Map<string, number> = new Map()
const bugAssignments: Map<string, number> = new Map()

function assignSpot(agentId: string, spots: [number, number][], assignments: Map<string, number>): [number, number] {
  // Known agents ALWAYS go to their fixed index — no exceptions
  const known = KNOWN_AGENTS[agentId]
  if (known && known.fixedIndex < spots.length) {
    assignments.set(agentId, known.fixedIndex)
    return spots[known.fixedIndex]
  }

  // Unknown agents: find first unoccupied spot
  const taken = new Set(assignments.values())
  for (let i = 0; i < spots.length; i++) {
    if (!taken.has(i)) {
      assignments.set(agentId, i)
      return spots[i]
    }
  }
  // Overflow — offset to prevent overlap
  const overflowIdx = assignments.size
  const baseIdx = overflowIdx % spots.length
  assignments.set(agentId, spots.length + overflowIdx)
  const [bx, by] = spots[baseIdx]
  return [bx + 1.5, by + 1.5]
}

function getTargetTile(agent: AgentDef): [number, number] {
  const zone = getZoneForState(agent.state)
  if (zone === 'work') {
    // Dynamic assignment — working agents fill consecutive cubicle positions
    loungeAssignments.delete(agent.id)
    bugAssignments.delete(agent.id)
    return assignSpot(agent.id, CUBICLE_POSITIONS, workAssignments)
  }
  if (zone === 'bugs') {
    workAssignments.delete(agent.id)
    loungeAssignments.delete(agent.id)
    return assignSpot(agent.id, BUG_SPOTS, bugAssignments)
  }
  // lounge (idle / offline)
  workAssignments.delete(agent.id)
  bugAssignments.delete(agent.id)
  return assignSpot(agent.id, LOUNGE_SPOTS, loungeAssignments)
}

function buildAgents(defs: AgentDef[]): AgentRuntime[] {
  // Assign stable fixedIndex to ALL agents based on sorted ID order
  const sortedIds = defs.map(d => d.id).sort()
  for (let i = 0; i < sortedIds.length; i++) {
    const id = sortedIds[i]
    if (KNOWN_AGENTS[id]) {
      KNOWN_AGENTS[id].fixedIndex = i
    } else {
      KNOWN_AGENTS[id] = {
        name: id,
        role: 'Agent',
        emoji: AGENT_EMOJIS[i % AGENT_EMOJIS.length],
        color: FALLBACK_COLORS[i % FALLBACK_COLORS.length],
        frames: 6,
        fixedIndex: i,
      }
    }
  }

  // Expand grid dynamically based on agent count
  computeGridSize(defs.length)
  FLOOR_MAP = generateFloorMap()
  WALLS = generateWalls()
  BUG_WORKSTATIONS = generateBugWorkstations()
  BUG_SPOTS = generateBugSpots(defs.length)
  CUBICLE_POSITIONS = generateCubiclePositions(defs.length)
  LOUNGE_SPOTS = generateLoungeSpots(defs.length)
  console.log(`[Office] buildAgents: ${defs.length} agents, MAP ${MAP_COLS}x${MAP_ROWS}, FLOOR ${FLOOR_MAP.length}x${FLOOR_MAP[0]?.length ?? 0}, lounge rows ${LOUNGE_START_ROW}-${LOUNGE_END_ROW} (${LOUNGE_SPOTS.length} spots), work rows ${WORK_START_ROW}-${WORK_END_ROW} (${CUBICLE_POSITIONS.length} spots), error rows ${ERROR_START_ROW}-${ERROR_END_ROW} (${BUG_SPOTS.length} spots)`)
  LOUNGE_SOFA_POSITIONS = LOUNGE_SPOTS.map(([c, r]): [number, number] => [c + 1, r - 1])
  // Reset spot assignments — fresh every rebuild
  workAssignments.clear()
  loungeAssignments.clear()
  bugAssignments.clear()
  return defs.map(def => {
    const zone = getZoneForState(def.state)
    const [tx, ty] = getTargetTile(def)
    return { def, x: tx, y: ty, tx, ty, zone }
  })
}

// ── Generic sprite bank ──
const GENERIC_SPRITE_COUNT = 11
const genericSpriteImages: HTMLImageElement[] = []
let genericsLoaded = false

function loadGenericSprites() {
  if (genericsLoaded) return
  genericsLoaded = true
  for (let i = 1; i <= GENERIC_SPRITE_COUNT; i++) {
    const img = new Image()
    img.src = `/assets/characters/generic-${i}-idle.png`
    genericSpriteImages.push(img)

    // Also load generic sitting sprites
    const workImg = new Image()
    workImg.src = `/assets/characters/generic-${i}-sitting-work.png`
    workImg.onload = () => { sittingFrameCounts[`generic-${i}-work`] = Math.max(1, Math.floor(workImg.naturalWidth / SPRITE_SIZE)) }
    sittingSprites[`generic-${i}-work`] = workImg

    const loungeImg = new Image()
    loungeImg.src = `/assets/characters/generic-${i}-sitting-lounge.png`
    loungeImg.onload = () => { sittingFrameCounts[`generic-${i}-lounge`] = Math.max(1, Math.floor(loungeImg.naturalWidth / SPRITE_SIZE)) }
    sittingSprites[`generic-${i}-lounge`] = loungeImg
  }
}

/** Deterministic hash of agent id → stable generic sprite index */
function hashAgentId(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % GENERIC_SPRITE_COUNT
}

// ── Sprite loading ──
const spriteImages: Record<string, HTMLImageElement> = {}
const spriteFailed: Set<string> = new Set()  // Track failed loads
const spriteResolved: Record<string, HTMLImageElement> = {}  // Cache resolved sprite per agent

// Auto-detected frame counts from sprite width
const spriteFrameCounts: Record<string, number> = {}
// Sitting sprites — keyed by "{agentId}-work" and "{agentId}-lounge"
const sittingSprites: Record<string, HTMLImageElement> = {}
const sittingFrameCounts: Record<string, number> = {}

// Walk sprites — 192×64 spritesheets (6 frames × 2 rows: SE top, SW bottom)
// Some agents have 192×32 (single row, SE only)
const walkSprites: Record<string, HTMLImageElement> = {}
const walkFrameCounts: Record<string, number> = {}
const walkHasSwRow: Record<string, boolean> = {} // true if sprite has 2 rows (64px height)

// Cubicle sprites — personalized desk+monitor+agent combo (32×32, single frame)
const cubicleSprites: Record<string, HTMLImageElement> = {}
let genericCubicleImg: HTMLImageElement | null = null

const SPRITE_ALIASES: Record<string, string> = { main: 'yogi' }

function loadSpritesForAgents(defs: AgentDef[]) {
  loadGenericSprites()
  defs.forEach(agent => {
    const spriteId = SPRITE_ALIASES[agent.id] ?? agent.id

    // Load idle sprite
    if (!spriteImages[agent.id] && !spriteFailed.has(agent.id)) {
      const img = new Image()
      img.onerror = () => { spriteFailed.add(agent.id); delete spriteImages[agent.id] }
      img.onload = () => {
        if (img.naturalWidth > 0) {
          spriteResolved[agent.id] = img
          spriteFrameCounts[agent.id] = Math.max(1, Math.floor(img.naturalWidth / SPRITE_SIZE))
        } else {
          spriteFailed.add(agent.id)
        }
      }
      img.src = `/assets/characters/${spriteId}-idle.png`
      spriteImages[agent.id] = img
    }

    // Load sitting-work sprite
    const workKey = `${agent.id}-work`
    if (!sittingSprites[workKey]) {
      const img = new Image()
      img.onload = () => {
        if (img.naturalWidth > 0) {
          sittingFrameCounts[workKey] = Math.max(1, Math.floor(img.naturalWidth / SPRITE_SIZE))
        }
      }
      img.onerror = () => { /* silent — fallback to idle */ }
      img.src = `/assets/characters/${spriteId}-sitting-work.png`
      sittingSprites[workKey] = img
    }

    // Load sitting-lounge sprite
    const loungeKey = `${agent.id}-lounge`
    if (!sittingSprites[loungeKey]) {
      const img = new Image()
      img.onload = () => {
        if (img.naturalWidth > 0) {
          sittingFrameCounts[loungeKey] = Math.max(1, Math.floor(img.naturalWidth / SPRITE_SIZE))
        }
      }
      img.onerror = () => { /* silent — fallback to idle */ }
      img.src = `/assets/characters/${spriteId}-sitting-lounge.png`
      sittingSprites[loungeKey] = img
    }

    // Load cubicle sprite (personalized desk+monitor for work zone)
    if (!cubicleSprites[agent.id]) {
      const img = new Image()
      img.onerror = () => { /* silent — no personalized cubicle */ }
      img.src = `/assets/furniture/cubicle_${spriteId}.png`
      cubicleSprites[agent.id] = img
    }

    // Load walk sprite
    if (!walkSprites[agent.id]) {
      const img = new Image()
      img.onload = () => {
        if (img.naturalWidth > 0) {
          walkFrameCounts[agent.id] = Math.max(1, Math.floor(img.naturalWidth / SPRITE_SIZE))
          walkHasSwRow[agent.id] = img.naturalHeight >= SPRITE_SIZE * 2
        }
      }
      img.onerror = () => { /* silent — fallback to idle */ }
      img.src = `/assets/characters/${spriteId}-walk.png`
      walkSprites[agent.id] = img
    }
  })
}

/** Get the best available sprite for an agent — cached and stable */
function getSpriteForAgent(agentId: string, pose?: 'idle' | 'sitting-work' | 'sitting-lounge'): HTMLImageElement | null {
  // Try sitting pose first
  if (pose === 'sitting-work' || pose === 'sitting-lounge') {
    const key = pose === 'sitting-work' ? `${agentId}-work` : `${agentId}-lounge`
    const sitting = sittingSprites[key]
    if (sitting?.complete && sitting.naturalWidth > 0) return sitting

    // Try generic sitting sprite
    const idx = hashAgentId(agentId)
    const genericKey = pose === 'sitting-work' ? `generic-${idx + 1}-work` : `generic-${idx + 1}-lounge`
    const genericSitting = sittingSprites[genericKey]
    if (genericSitting?.complete && genericSitting.naturalWidth > 0) return genericSitting
  }

  // Return cached resolved idle sprite (most stable path — no flicker)
  if (spriteResolved[agentId]) return spriteResolved[agentId]

  // Check if own sprite loaded successfully
  if (!spriteFailed.has(agentId)) {
    const own = spriteImages[agentId]
    if (own?.complete && own.naturalWidth > 0) {
      spriteResolved[agentId] = own
      return own
    }
  }

  // Fallback to generic sprite
  const idx = hashAgentId(agentId)
  const generic = genericSpriteImages[idx]
  if (generic?.complete && generic.naturalWidth > 0) {
    spriteResolved[agentId] = generic
    return generic
  }
  return null
}

// ── Tile texture rendering (textured iso diamonds) ──

function drawIsoTile(
  ctx: CanvasRenderingContext2D,
  ox: number, oy: number,
  col: number, row: number,
  floorType: number,
) {
  const [ix, iy] = toIso(col, row)
  const sx = ox + ix
  const sy = oy + iy
  const hw = TILE_W / 2
  const hh = TILE_H / 2

  // Diamond path
  ctx.beginPath()
  ctx.moveTo(sx, sy - hh)
  ctx.lineTo(sx + hw, sy)
  ctx.lineTo(sx, sy + hh)
  ctx.lineTo(sx - hw, sy)
  ctx.closePath()

  // Checkerboard pattern with floor type colors
  const [c1, c2] = FLOOR_STYLES[floorType] ?? FLOOR_STYLES[0]
  const isDark = (col + row) % 2 === 0
  ctx.fillStyle = isDark ? c1 : c2
  ctx.fill()

  // Subtle grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.04)'
  ctx.lineWidth = 0.5
  ctx.stroke()

  // Wood grain texture for work zone (type 0)
  if (floorType === 0) {
    ctx.save()
    ctx.clip()
    ctx.strokeStyle = 'rgba(255,255,255,0.03)'
    ctx.lineWidth = 0.5
    for (let i = -2; i < 4; i++) {
      ctx.beginPath()
      ctx.moveTo(sx - hw + i * 8, sy - hh)
      ctx.lineTo(sx - hw + i * 8 + hw, sy + hh)
      ctx.stroke()
    }
    ctx.restore()
  }

  // Carpet texture for lounge (type 2)
  if (floorType === 2) {
    ctx.save()
    ctx.clip()
    ctx.fillStyle = 'rgba(255,255,255,0.02)'
    for (let dx = -hw; dx < hw; dx += 6) {
      for (let dy = -hh; dy < hh; dy += 6) {
        if ((dx + dy) % 12 === 0) {
          ctx.fillRect(sx + dx, sy + dy, 2, 2)
        }
      }
    }
    ctx.restore()
  }
}

// ── Wall rendering ──

function drawWallSegment(
  ctx: CanvasRenderingContext2D,
  ox: number, oy: number,
  col: number, row: number,
  type: string,
) {
  const [ix, iy] = toIso(col, row)
  const sx = ox + ix
  const sy = oy + iy
  const wallH = 24

  // Wall face
  ctx.beginPath()
  ctx.moveTo(sx - TILE_W / 2, sy)
  ctx.lineTo(sx, sy - TILE_H / 2)
  ctx.lineTo(sx, sy - TILE_H / 2 - wallH)
  ctx.lineTo(sx - TILE_W / 2, sy - wallH)
  ctx.closePath()
  ctx.fillStyle = '#2a3a4a'
  ctx.fill()
  ctx.strokeStyle = '#1a2a3a'
  ctx.lineWidth = 1
  ctx.stroke()

  // Right face
  ctx.beginPath()
  ctx.moveTo(sx, sy - TILE_H / 2)
  ctx.lineTo(sx + TILE_W / 2, sy)
  ctx.lineTo(sx + TILE_W / 2, sy - wallH)
  ctx.lineTo(sx, sy - TILE_H / 2 - wallH)
  ctx.closePath()
  ctx.fillStyle = '#1e2e3e'
  ctx.fill()
  ctx.strokeStyle = '#1a2a3a'
  ctx.lineWidth = 1
  ctx.stroke()

  // Top
  ctx.beginPath()
  ctx.moveTo(sx, sy - TILE_H / 2 - wallH)
  ctx.lineTo(sx + TILE_W / 2, sy - wallH)
  ctx.lineTo(sx, sy + TILE_H / 2 - wallH)
  ctx.lineTo(sx - TILE_W / 2, sy - wallH)
  ctx.closePath()
  ctx.fillStyle = '#354555'
  ctx.fill()

  // Window
  if (type === 'window') {
    const img = decoImages['window']
    if (img?.complete && img.naturalWidth > 0) {
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(img, sx - 10, sy - TILE_H / 2 - wallH + 4, 20, 16)
      ctx.imageSmoothingEnabled = true
    } else {
      // Fallback: drawn window
      ctx.fillStyle = '#4a7a9a'
      ctx.fillRect(sx - 8, sy - TILE_H / 2 - wallH + 6, 16, 12)
      ctx.strokeStyle = '#2a5a7a'
      ctx.lineWidth = 1
      ctx.strokeRect(sx - 8, sy - TILE_H / 2 - wallH + 6, 16, 12)
      // Cross pane
      ctx.beginPath()
      ctx.moveTo(sx, sy - TILE_H / 2 - wallH + 6)
      ctx.lineTo(sx, sy - TILE_H / 2 - wallH + 18)
      ctx.moveTo(sx - 8, sy - TILE_H / 2 - wallH + 12)
      ctx.lineTo(sx + 8, sy - TILE_H / 2 - wallH + 12)
      ctx.strokeStyle = '#2a5a7a'
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }
}

// ── Furniture drawing ──

function drawIsoDeskAt(
  ctx: CanvasRenderingContext2D,
  ox: number, oy: number,
  col: number, row: number,
  monitorColor: string,
) {
  const [ix, iy] = toIso(col, row)
  const sx = ox + ix
  const sy = oy + iy

  // Try to use Amir's desk sprite
  const deskImg = furnitureImages['desk']
  if (deskImg?.complete && deskImg.naturalWidth > 0) {
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(deskImg, sx - 20, sy - 22, 40, 32)
    ctx.imageSmoothingEnabled = true
  } else {
    // Fallback: procedural desk
    ctx.beginPath()
    ctx.moveTo(sx - 20, sy - 4)
    ctx.lineTo(sx + 12, sy - 14)
    ctx.lineTo(sx + 24, sy - 8)
    ctx.lineTo(sx - 8, sy + 2)
    ctx.closePath()
    ctx.fillStyle = '#6D4C41'
    ctx.fill()
    ctx.strokeStyle = '#4E342E'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = '#4E342E'
    ctx.fillRect(sx - 19, sy - 3, 2, 8)
    ctx.fillRect(sx + 22, sy - 7, 2, 8)
  }

  // Monitor
  const monImg = furnitureImages['monitor_desktop']
  if (monImg?.complete && monImg.naturalWidth > 0) {
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(monImg, sx - 4, sy - 34, 20, 16)
    ctx.imageSmoothingEnabled = true
  } else {
    ctx.fillStyle = '#263238'
    ctx.fillRect(sx - 2, sy - 22, 14, 12)
    ctx.fillStyle = monitorColor
    ctx.fillRect(sx, sy - 20, 10, 8)
    ctx.fillStyle = '#37474F'
    ctx.fillRect(sx + 4, sy - 10, 3, 4)
  }

  // Chair (try Amir's asset)
  const chairImg = furnitureImages['chair_office']
  if (chairImg?.complete && chairImg.naturalWidth > 0) {
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(chairImg, sx - 8, sy + 2, 24, 24)
    ctx.imageSmoothingEnabled = true
  }
}

function drawSofa(
  ctx: CanvasRenderingContext2D,
  ox: number, oy: number,
  col: number, row: number,
) {
  const [ix, iy] = toIso(col, row)
  const sx = ox + ix
  const sy = oy + iy

  // Sofa base
  ctx.beginPath()
  ctx.moveTo(sx - 18, sy - 2)
  ctx.lineTo(sx + 14, sy - 12)
  ctx.lineTo(sx + 22, sy - 8)
  ctx.lineTo(sx - 10, sy + 2)
  ctx.closePath()
  ctx.fillStyle = '#5D4037'
  ctx.fill()

  // Sofa back
  ctx.beginPath()
  ctx.moveTo(sx - 18, sy - 2)
  ctx.lineTo(sx - 18, sy - 10)
  ctx.lineTo(sx + 14, sy - 20)
  ctx.lineTo(sx + 14, sy - 12)
  ctx.closePath()
  ctx.fillStyle = '#8D6E63'
  ctx.fill()

  // Cushion
  ctx.beginPath()
  ctx.moveTo(sx - 14, sy - 4)
  ctx.lineTo(sx + 10, sy - 12)
  ctx.lineTo(sx + 18, sy - 8)
  ctx.lineTo(sx - 6, sy)
  ctx.closePath()
  ctx.fillStyle = '#A1887F'
  ctx.fill()
}

function drawCoffeeTable(
  ctx: CanvasRenderingContext2D,
  ox: number, oy: number,
  col: number, row: number,
) {
  const [ix, iy] = toIso(col, row)
  const sx = ox + ix
  const sy = oy + iy

  ctx.beginPath()
  ctx.moveTo(sx - 10, sy - 2)
  ctx.lineTo(sx + 6, sy - 8)
  ctx.lineTo(sx + 14, sy - 4)
  ctx.lineTo(sx - 2, sy + 2)
  ctx.closePath()
  ctx.fillStyle = '#795548'
  ctx.fill()
  ctx.strokeStyle = '#5D4037'
  ctx.lineWidth = 1
  ctx.stroke()

  // Mug on table (use sprite if available)
  const mugImg = decoImages['mug']
  if (mugImg?.complete && mugImg.naturalWidth > 0) {
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(mugImg, sx - 2, sy - 14, 12, 12)
    ctx.imageSmoothingEnabled = true
  } else {
    ctx.fillStyle = '#FFEB3B'
    ctx.beginPath()
    ctx.arc(sx + 2, sy - 4, 3, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawCoffeeMachine(
  ctx: CanvasRenderingContext2D,
  ox: number, oy: number,
  col: number, row: number,
) {
  const [ix, iy] = toIso(col, row)
  const sx = ox + ix
  const sy = oy + iy

  const img = furnitureImages['coffee_machine']
  if (img?.complete && img.naturalWidth > 0) {
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(img, sx - 14, sy - 34, 28, 32)
    ctx.imageSmoothingEnabled = true
  } else {
    ctx.fillStyle = '#424242'
    ctx.fillRect(sx - 8, sy - 28, 16, 24)
    ctx.fillStyle = '#616161'
    ctx.fillRect(sx - 6, sy - 26, 12, 8)
    ctx.fillStyle = '#4CAF50'
    ctx.beginPath()
    ctx.arc(sx, sy - 14, 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#333'
    ctx.fillRect(sx - 4, sy - 8, 8, 4)
  }
}

function drawWarningSign(
  ctx: CanvasRenderingContext2D,
  ox: number, oy: number,
  col: number, row: number,
) {
  const [ix, iy] = toIso(col, row)
  const sx = ox + ix
  const sy = oy + iy

  ctx.beginPath()
  ctx.moveTo(sx, sy - 24)
  ctx.lineTo(sx + 10, sy - 8)
  ctx.lineTo(sx - 10, sy - 8)
  ctx.closePath()
  ctx.fillStyle = '#FFC107'
  ctx.fill()
  ctx.strokeStyle = '#F57F17'
  ctx.lineWidth = 1.5
  ctx.stroke()

  ctx.fillStyle = '#333'
  ctx.font = 'bold 10px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('!', sx, sy - 12)
}

// ── Decoration sprite rendering ──

function drawDecoration(
  ctx: CanvasRenderingContext2D,
  ox: number, oy: number,
  deco: Decoration,
) {
  const [ix, iy] = toIso(deco.col, deco.row)
  const sx = ox + ix
  const sy = oy + iy
  const scale = deco.scale ?? 1
  const img = getDecoImage(deco.type)

  if (img?.complete && img.naturalWidth > 0) {
    const w = SPRITE_SIZE * scale
    const h = SPRITE_SIZE * scale
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(img, sx - w / 2, sy - h + 4, w, h)
    ctx.imageSmoothingEnabled = true
  }
  // No fallback — decorations are optional visual polish
}

// ── Agent drawing ──

function drawAgent(
  ctx: CanvasRenderingContext2D,
  ox: number, oy: number,
  agent: AgentRuntime,
  t: number,
  isHover: boolean,
  isSelected: boolean,
) {
  const [ix, iy] = toIso(agent.x, agent.y)
  const sx = ox + ix
  const sy = oy + iy

  const isOffline = agent.def.state === 'offline'
  const isInLounge = agent.zone === 'lounge'
  if (isOffline) ctx.globalAlpha = 0.4
  // Sitting offset — agents in lounge are "sitting" on sofas (drawn lower)
  const sitOffset = isInLounge ? 4 : 0

  // Selection / hover ring
  if (isSelected || isHover) {
    ctx.beginPath()
    ctx.ellipse(sx, sy + 4, 20, 10, 0, 0, Math.PI * 2)
    ctx.strokeStyle = isSelected ? STATE_META[agent.def.state].color : 'rgba(255,255,255,0.4)'
    ctx.lineWidth = 2
    ctx.stroke()
  }

  // Shadow
  ctx.beginPath()
  ctx.ellipse(sx, sy + 4, 14, 6, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(0,0,0,0.3)'
  ctx.fill()

  // Breathing disabled — caused sub-pixel flicker on pixel art sprites
  const breathOffset = 0

  // Draw personalized cubicle backdrop when agent is at their work desk
  const isAtDesk = agent.zone === 'work' && Math.abs(agent.x - agent.tx) < 0.5 && Math.abs(agent.y - agent.ty) < 0.5
  const cubicleImg = cubicleSprites[agent.def.id]
  if (isAtDesk && cubicleImg?.complete && cubicleImg.naturalWidth > 0) {
    const cubDrawX = Math.round(sx - SPRITE_DISPLAY / 2)
    const cubDrawY = Math.round(sy - SPRITE_DISPLAY + 8 + sitOffset)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(
      cubicleImg,
      0, 0, SPRITE_SIZE, SPRITE_SIZE,
      cubDrawX, cubDrawY, SPRITE_DISPLAY, SPRITE_DISPLAY,
    )
    ctx.imageSmoothingEnabled = true
  }

  // Determine pose based on zone and movement
  const isMoving = Math.abs(agent.x - agent.tx) > 0.5 || Math.abs(agent.y - agent.ty) > 0.5
  const pose: 'idle' | 'sitting-work' | 'sitting-lounge' | 'walk' = isMoving ? 'walk'
    : agent.zone === 'work' ? 'sitting-work'
    : agent.zone === 'lounge' ? 'sitting-lounge'
    : 'idle'

  // Walk sprite — use when moving, fall back to idle
  const walkImg = walkSprites[agent.def.id]
  const useWalk = pose === 'walk' && walkImg?.complete && walkImg.naturalWidth > 0

  const img = useWalk ? walkImg : getSpriteForAgent(agent.def.id, pose === 'walk' ? 'idle' : pose)
  if (img) {
    let srcX: number
    let srcY = 0
    let maxFrames: number
    let fps: number

    if (useWalk) {
      // Walk sprite: 6 frames per row, row 0 = SE, row 1 = SW
      fps = 8
      maxFrames = walkFrameCounts[agent.def.id] ?? 6
      const frame = Math.floor(t * fps) % maxFrames
      srcX = frame * SPRITE_SIZE

      // Direction: determine from movement vector
      // In isometric: moving right = SE (+x), moving left = SW (-x or +y)
      const dx = agent.tx - agent.x
      const dy = agent.ty - agent.y
      const movingSW = dx < -0.1 || (Math.abs(dx) < 0.1 && dy > 0.1)
      if (movingSW && walkHasSwRow[agent.def.id]) {
        srcY = SPRITE_SIZE // Second row = SW direction
      }
    } else {
      // Non-walk sprite (idle/sitting)
      fps = pose === 'sitting-work' ? 4 : pose === 'sitting-lounge' ? 2 : (agent.def.state === 'working' || agent.def.state === 'active') ? 8 : 4
      maxFrames = Math.max(1, Math.floor(img.naturalWidth / SPRITE_SIZE))
      const frame = Math.floor(t * fps) % maxFrames
      srcX = frame * SPRITE_SIZE
    }

    // Math.round prevents sub-pixel blur on pixel art
    const drawX = Math.round(sx - SPRITE_DISPLAY / 2)
    const drawY = Math.round(sy - SPRITE_DISPLAY + 8 + breathOffset + sitOffset)

    ctx.imageSmoothingEnabled = false
    ctx.drawImage(
      img,
      srcX, srcY, SPRITE_SIZE, SPRITE_SIZE,
      drawX, drawY, SPRITE_DISPLAY, SPRITE_DISPLAY,
    )
    ctx.imageSmoothingEnabled = true
  } else {
    // Fallback — draw emoji + colored circle (before sprites load or if missing)
    const cy = Math.round(sy - 20 + breathOffset + sitOffset)
    ctx.beginPath()
    ctx.arc(sx, cy, 18, 0, Math.PI * 2)
    ctx.fillStyle = agent.def.color
    ctx.fill()
    ctx.strokeStyle = darken(agent.def.color, 40)
    ctx.lineWidth = 2
    ctx.stroke()
    // Draw emoji in circle
    ctx.font = '16px serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#fff'
    ctx.fillText(agent.def.emoji, sx, cy)

    ctx.beginPath()
    ctx.moveTo(sx - 10, cy + 14)
    ctx.lineTo(sx + 10, cy + 14)
    ctx.lineTo(sx + 8, cy + 30)
    ctx.lineTo(sx - 8, cy + 30)
    ctx.closePath()
    ctx.fillStyle = darken(agent.def.color, 30)
    ctx.fill()

    ctx.font = '14px serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(agent.def.emoji, sx, cy)
    ctx.textBaseline = 'alphabetic'
  }

  // ── Name label + Status dot (next to name) ──
  const nameY = Math.round(sy + 18 + breathOffset + sitOffset)
  const nameX = Math.round(sx)
  ctx.font = 'bold 11px "Heebo", "Segoe UI", sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = isOffline ? '#666' : '#eee'
  ctx.fillText(agent.def.name, nameX, nameY)

  // Status dot — positioned to the left of the name (RTL feel)
  const nameWidth = ctx.measureText(agent.def.name).width
  const dotX = Math.round(nameX - nameWidth / 2 - 8)
  const dotY = Math.round(nameY - 4)
  ctx.beginPath()
  ctx.arc(dotX, dotY, 3.5, 0, Math.PI * 2)
  ctx.fillStyle = STATE_META[agent.def.state].color
  ctx.fill()

  // ── Task label — speech bubble above every agent showing current task ──
  if (agent.def.task) {
    const taskText = shortTask(agent.def.task)
    if (taskText) {
      const arrowH = 5
      const taskY = Math.round(sy - SPRITE_DISPLAY - 2 - arrowH + breathOffset)
      ctx.font = '10px "Heebo", "Segoe UI", sans-serif'
      ctx.textAlign = 'center'
      const tw = ctx.measureText(taskText).width
      const padX = 8
      const padY = 4
      const bubbleW = tw + padX * 2
      const bubbleH = 16

      // Bubble background — color varies by state
      const bx = Math.round(sx - bubbleW / 2)
      const by = taskY - bubbleH
      const bgColor = isOffline ? 'rgba(30, 30, 40, 0.70)' : 'rgba(45, 55, 80, 0.92)'
      ctx.fillStyle = bgColor
      ctx.beginPath()
      ctx.roundRect(bx, by, bubbleW, bubbleH, 5)
      ctx.fill()
      ctx.strokeStyle = `${STATE_META[agent.def.state].color}33`
      ctx.lineWidth = 0.5
      ctx.stroke()

      // Pointer arrow (small triangle pointing down)
      const arrowW = 6
      ctx.fillStyle = bgColor
      ctx.beginPath()
      ctx.moveTo(sx - arrowW, taskY)
      ctx.lineTo(sx + arrowW, taskY)
      ctx.lineTo(sx, taskY + arrowH)
      ctx.closePath()
      ctx.fill()

      // Task text
      ctx.fillStyle = isOffline ? '#888' : '#dde4ff'
      ctx.fillText(taskText, Math.round(sx), taskY - padY)
    }
  }

  // ── Chat bubble — temporary message above agent ──
  const bubble = chatBubbles.find(b => b.agentId === agent.def.id)
  if (bubble) {
    const elapsed = t * 1000 - bubble.createdAt
    const progress = Math.min(1, elapsed / bubble.duration)

    // Fade out in last 20%
    const fadeStart = 0.8
    const bubbleAlpha = progress > fadeStart
      ? 1 - (progress - fadeStart) / (1 - fadeStart)
      : Math.min(1, elapsed / 300) // fade in over 300ms

    if (bubbleAlpha > 0.01) {
      ctx.save()
      ctx.globalAlpha = (isOffline ? 0.4 : 1) * bubbleAlpha

      // Float up slightly over time
      const floatY = -progress * 8
      const chatY = Math.round(sy - SPRITE_DISPLAY - 20 + breathOffset + floatY)

      ctx.font = '10px "Heebo", "Segoe UI", sans-serif'
      ctx.textAlign = 'center'

      // Word wrap for longer messages
      const maxLineW = 120
      const words = bubble.text.split(/\s+/)
      const lines: string[] = []
      let currentLine = ''
      for (const word of words) {
        const test = currentLine ? currentLine + ' ' + word : word
        if (ctx.measureText(test).width > maxLineW && currentLine) {
          lines.push(currentLine)
          currentLine = word
        } else {
          currentLine = test
        }
      }
      if (currentLine) lines.push(currentLine)

      const lineH = 13
      const padX = 8
      const padY = 5
      const bubbleW = Math.min(maxLineW + padX * 2,
        Math.max(...lines.map(l => ctx.measureText(l).width)) + padX * 2)
      const bubbleH = lines.length * lineH + padY * 2

      const bx = Math.round(sx - bubbleW / 2)
      const by = chatY - bubbleH

      // Bubble background with subtle shadow
      ctx.shadowColor = 'rgba(0,0,0,0.3)'
      ctx.shadowBlur = 6
      ctx.shadowOffsetY = 2
      ctx.fillStyle = 'rgba(40, 50, 80, 0.92)'
      ctx.beginPath()
      ctx.roundRect(bx, by, bubbleW, bubbleH, 6)
      ctx.fill()
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
      ctx.shadowOffsetY = 0

      // Border
      ctx.strokeStyle = `rgba(${agent.def.state === 'error' ? '248,113,113' : '100,140,220'}, 0.4)`
      ctx.lineWidth = 1
      ctx.stroke()

      // Tail (small triangle pointing down)
      ctx.beginPath()
      ctx.moveTo(sx - 4, by + bubbleH)
      ctx.lineTo(sx, by + bubbleH + 5)
      ctx.lineTo(sx + 4, by + bubbleH)
      ctx.closePath()
      ctx.fillStyle = 'rgba(40, 50, 80, 0.92)'
      ctx.fill()

      // Text
      ctx.fillStyle = '#e0e6f0'
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], Math.round(sx), Math.round(by + padY + (i + 1) * lineH - 2))
      }

      ctx.restore()
    }
  }

  // ── Working indicator — animated dots ──
  if (agent.def.state === 'working' || agent.def.state === 'active') {
    const dotCount = 3
    for (let i = 0; i < dotCount; i++) {
      const phase = (t * 3 + i * 0.4) % 1
      const dotAlpha = Math.sin(phase * Math.PI)
      ctx.beginPath()
      ctx.arc(Math.round(sx - 10 + i * 6), Math.round(sy - SPRITE_DISPLAY + 6 + breathOffset), 2, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(33, 150, 243, ${dotAlpha * 0.8})`
      ctx.fill()
    }
  }

  ctx.globalAlpha = 1
}

function darken(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.max(0, ((n >> 16) & 0xff) - amt)
  const g = Math.max(0, ((n >> 8) & 0xff) - amt)
  const b = Math.max(0, (n & 0xff) - amt)
  return `rgb(${r},${g},${b})`
}

// ── Compute isometric map bounds (reused in drawScene and App) ──
function getIsoBounds() {
  const [, topY] = toIso(0, 0)
  const [rightX] = toIso(MAP_COLS, 0)
  const [, bottomY] = toIso(MAP_COLS, MAP_ROWS)
  const [leftX] = toIso(0, MAP_ROWS)
  const minX = leftX
  const maxX = rightX
  const minY = topY - TILE_H / 2
  const maxY = bottomY + TILE_H / 2
  return { minX, maxX, minY, maxY, isoW: maxX - minX, isoH: maxY - minY }
}

// ── Main scene drawing ──

function drawScene(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  t: number,
  agents: AgentRuntime[],
  hoverAgentId: string | null,
  selectedAgentId: string | null,
  panX: number,
  panY: number,
  fonts?: ReturnType<typeof getCanvasFontSizes>,
  decorations?: DecorationWithId[],
  editState?: EditState,
  allAgentDefs?: AgentDef[],
) {
  const f = fonts ?? getCanvasFontSizes('desktop')
  const decos = decorations ?? DEFAULT_DECORATIONS.map(d => ({ ...d, _id: 0 }))
  const edit = editState ?? { active: false, selectedDecoId: null, draggingDecoId: null, placementPreview: null }

  // Background
  ctx.fillStyle = '#1a1a2e'
  ctx.fillRect(0, 0, w, h)

  // Compute iso origin to center the map
  const { minX, minY, isoW, isoH } = getIsoBounds()

  const ox = (w - isoW) / 2 - minX + panX
  const oy = (h - isoH) / 2 - minY - 20 + panY

  // Title
  ctx.fillStyle = '#7a7aaa'
  ctx.font = `bold ${f.title}px "Heebo", "Segoe UI", sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText('🏢 Virtual Office', w / 2, 28)

  // Zone labels — centered in each horizontal zone
  ctx.font = `${f.zone}px "Heebo", "Segoe UI", sans-serif`
  ctx.fillStyle = 'rgba(255,255,255,0.25)'
  const midCol = MAP_COLS / 2
  const [lx, ly] = toIso(midCol, LOUNGE_START_ROW)
  ctx.fillText('☕ Lounge', ox + lx, oy + ly - 10)
  const [wx, wy] = toIso(midCol, WORK_START_ROW)
  ctx.fillText('💻 Work Zone', ox + wx, oy + wy - 10)
  const [bx, by] = toIso(midCol, ERROR_START_ROW)
  ctx.fillText('🐛 Errors', ox + bx, oy + by - 10)

  // --- Floor tilemap --- (use FLOOR_MAP dimensions, not MAP_ROWS/COLS, to avoid stale mismatch)
  for (let row = 0; row < FLOOR_MAP.length; row++) {
    for (let col = 0; col < (FLOOR_MAP[row]?.length ?? 0); col++) {
      drawIsoTile(ctx, ox, oy, col, row, FLOOR_MAP[row][col])
    }
  }

  // --- Edit mode: grid lines ---
  if (edit.active) {
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'
    ctx.lineWidth = 0.5
    for (let row = 0; row < MAP_ROWS; row++) {
      for (let col = 0; col < MAP_COLS; col++) {
        const [ix, iy] = toIso(col, row)
        const sx = ox + ix
        const sy = oy + iy
        const hw = TILE_W / 2
        const hh = TILE_H / 2
        ctx.beginPath()
        ctx.moveTo(sx, sy - hh)
        ctx.lineTo(sx + hw, sy)
        ctx.lineTo(sx, sy + hh)
        ctx.lineTo(sx - hw, sy)
        ctx.closePath()
        ctx.stroke()
      }
    }
  }

  // --- Walls ---
  for (const wall of WALLS) {
    drawWallSegment(ctx, ox, oy, wall.col, wall.row, wall.type)
  }

  // --- Depth-sorted drawables ---
  interface Drawable {
    sortY: number
    draw: () => void
  }
  const drawables: Drawable[] = []

  // (sofas removed per Tal's request)
  // Coffee area in bottom-right empty space
  drawables.push({ sortY: MAP_COLS - 4 + MAP_ROWS - 3, draw: () => drawCoffeeTable(ctx, ox, oy, MAP_COLS - 4, MAP_ROWS - 3) })
  drawables.push({ sortY: MAP_COLS - 3 + MAP_ROWS - 2, draw: () => drawCoffeeMachine(ctx, ox, oy, MAP_COLS - 3, MAP_ROWS - 2) })

  // Draw name labels at each agent's FIXED work + lounge spot
  const allDefs = allAgentDefs ?? []
  for (let defIdx = 0; defIdx < allDefs.length; defIdx++) {
    const def = allDefs[defIdx]
    const known = KNOWN_AGENTS[def.id]
    const idx = known?.fixedIndex ?? defIdx

    // Work spot label (cubicle) — small tag below the tile
    if (idx < CUBICLE_POSITIONS.length) {
      const [wc, wr] = CUBICLE_POSITIONS[idx]
      const [wix, wiy] = toIso(wc, wr)
      const wsx = ox + wix
      const wsy = oy + wiy
      const isHere = getZoneForState(def.state) === 'work'
      drawables.push({ sortY: wc + wr - 0.2, draw: () => {
        // Background pill for readability
        ctx.font = '9px "Heebo", "Segoe UI", sans-serif'
        ctx.textAlign = 'center'
        const label = def.name
        const tw = ctx.measureText(label).width + 12
        ctx.fillStyle = isHere ? 'rgba(0,230,118,0.15)' : 'rgba(0,0,0,0.3)'
        ctx.beginPath()
        ctx.roundRect(wsx - tw / 2, wsy + 22, tw, 16, 4)
        ctx.fill()
        ctx.fillStyle = isHere ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.25)'
        ctx.fillText(label, wsx, wsy + 34)
      }})
    }

    // Lounge spot label — small tag below the tile
    if (idx < LOUNGE_SPOTS.length) {
      const [lc, lr] = LOUNGE_SPOTS[idx]
      const [lix, liy] = toIso(lc, lr)
      const lsx = ox + lix
      const lsy = oy + liy
      const isHere = getZoneForState(def.state) === 'lounge'
      drawables.push({ sortY: lc + lr - 0.2, draw: () => {
        ctx.font = '9px "Heebo", "Segoe UI", sans-serif'
        ctx.textAlign = 'center'
        const label = def.name
        const tw = ctx.measureText(label).width + 12
        ctx.fillStyle = isHere ? 'rgba(58,40,32,0.5)' : 'rgba(0,0,0,0.3)'
        ctx.beginPath()
        ctx.roundRect(lsx - tw / 2, lsy + 22, tw, 16, 4)
        ctx.fill()
        ctx.fillStyle = isHere ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.25)'
        ctx.fillText(label, lsx, lsy + 34)
      }})
    }
  }

  // Cubicle sprites — permanent fixtures at each work desk position
  for (let i = 0; i < CUBICLE_POSITIONS.length; i++) {
    const [cc, cr] = CUBICLE_POSITIONS[i]
    const [cix, ciy] = toIso(cc, cr)
    const csx = ox + cix
    const csy = oy + ciy
    // Find which agent owns this desk
    const ownerDef = allDefs.find(d => {
      const known = KNOWN_AGENTS[d.id]
      return known && known.fixedIndex === i
    })
    const cubImg = ownerDef ? cubicleSprites[ownerDef.id] : null
    // Use generic cubicle.png as fallback
    if (!genericCubicleImg) {
      genericCubicleImg = new Image()
      genericCubicleImg.src = '/assets/furniture/cubicle.png'
    }
    const img = (cubImg?.complete && cubImg.naturalWidth > 0) ? cubImg : genericCubicleImg
    drawables.push({ sortY: cc + cr - 0.1, draw: () => {
      if (img?.complete && img.naturalWidth > 0) {
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(img, 0, 0, SPRITE_SIZE, SPRITE_SIZE,
          Math.round(csx - SPRITE_DISPLAY / 2), Math.round(csy - SPRITE_DISPLAY + 8), SPRITE_DISPLAY, SPRITE_DISPLAY)
        ctx.imageSmoothingEnabled = true
      }
    }})
  }

  // Decorations (Amir's assets)
  for (const deco of decos) {
    drawables.push({ sortY: deco.col + deco.row, draw: () => {
      drawDecoration(ctx, ox, oy, deco)
      // Edit mode: highlight decorations
      if (edit.active) {
        const [dix, diy] = toIso(deco.col, deco.row)
        const dsx = ox + dix
        const dsy = oy + diy
        const ds = (deco.scale ?? 1) * SPRITE_SIZE / 2
        const isSelected = edit.selectedDecoId === deco._id
        ctx.strokeStyle = isSelected ? 'rgba(255,215,0,0.8)' : 'rgba(100,100,255,0.4)'
        ctx.lineWidth = isSelected ? 2 : 1
        ctx.strokeRect(dsx - ds, dsy - ds * 2 + 4, ds * 2, ds * 2)
      }
    }})
  }

  // Agents — add +0.1 to sortY so they always draw ON TOP of furniture at same depth
  for (const agent of agents) {
    drawables.push({
      sortY: agent.x + agent.y + 0.1,
      draw: () => drawAgent(ctx, ox, oy, agent, t, hoverAgentId === agent.def.id, selectedAgentId === agent.def.id),
    })
  }

  // Stable sort by depth (same sortY keeps insertion order)
  drawables.sort((a, b) => a.sortY - b.sortY)
  for (const d of drawables) d.draw()

  // Edit mode: placement preview ghost
  if (edit.active && edit.placementPreview) {
    ctx.save()
    ctx.globalAlpha = 0.5
    drawDecoration(ctx, ox, oy, {
      type: edit.placementPreview.type,
      col: edit.placementPreview.col,
      row: edit.placementPreview.row,
      scale: 1,
    })
    ctx.restore()
  }

  // Edit mode: overlay tint + label
  if (edit.active) {
    ctx.fillStyle = 'rgba(40,40,80,0.12)'
    ctx.fillRect(0, 0, w, h)
    ctx.font = `bold ${f.title}px "Heebo", "Segoe UI", sans-serif`
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(150,150,255,0.6)'
    ctx.fillText('מצב עריכה', w / 2, 50)
  }
}

// ── Hit testing ──
function hitTestAgent(
  mx: number, my: number,
  agents: AgentRuntime[],
  ox: number, oy: number,
  _toleranceMul = 1,
): AgentRuntime | null {
  // Strategy: find the nearest agent within MAX_DIST pixels
  // This is far more reliable than tight bounding-box checks
  const MAX_DIST = 50
  let best: AgentRuntime | null = null
  let bestDist = MAX_DIST
  for (const agent of agents) {
    const [ix, iy] = toIso(agent.x, agent.y)
    const sx = ox + ix
    const sy = oy + iy - 24 // offset up to sprite center (anchor is at feet)
    const dx = mx - sx
    const dy = my - sy
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < bestDist) {
      bestDist = dist
      best = agent
    }
  }
  return best
}

// ── Settings / Onboarding Screen ──

function SettingsScreen({ onConnect, onDemo }: {
  onConnect: (token: string, url: string) => void
  onDemo: () => void
}) {
  const [token, setToken] = useState(localStorage.getItem('gateway-token') || '')
  const [url, setUrl] = useState(localStorage.getItem('gateway-url') || 'http://127.0.0.1:18789')

  const handleConnect = () => {
    localStorage.setItem('gateway-token', token)
    localStorage.setItem('gateway-url', url)
    onConnect(token, url)
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: 0,
    border: '2px solid #3a3a5c', background: '#16162b', color: '#eee',
    fontSize: 9, outline: 'none', boxSizing: 'border-box', direction: 'ltr',
    fontFamily: '"Press Start 2P", cursive',
    boxShadow: 'inset -2px -2px 0 #0a0a1a, inset 2px 2px 0 #2a2a4a',
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 8, color: '#7a7aaa', marginBottom: 6, display: 'block', direction: 'rtl',
    fontFamily: '"Press Start 2P", cursive',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#1a1a2e',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }}>
      <div style={{
        background: '#16162b', borderRadius: 0, padding: 32, width: 380, maxWidth: '90vw',
        border: '2px solid #3a3a5c',
        boxShadow: 'inset -2px -2px 0 #0a0a1a, inset 2px 2px 0 #2a2a4a, 0 8px 40px rgba(0,0,0,0.6)',
        fontFamily: '"Press Start 2P", cursive',
      }}>
        <h1 style={{
          fontSize: 12, color: '#e0e0e0', textAlign: 'center', margin: '0 0 8px',
          fontWeight: 600, fontFamily: '"Press Start 2P", cursive',
        }}>
          🏢 Virtual Office — Setup
        </h1>
        <p style={{ fontSize: 7, color: '#7a7aaa', textAlign: 'center', margin: '0 0 24px' }}>
          הגדר את החיבור ל-Gateway
        </p>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Gateway Token</label>
          <input
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="הזן את ה-Gateway Token שלך"
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: 24 }}>
          <label style={labelStyle}>Gateway URL</label>
          <input
            type="text"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="http://127.0.0.1:18789"
            style={inputStyle}
          />
        </div>

        <button
          onClick={handleConnect}
          disabled={!token.trim()}
          style={{
            width: '100%', padding: '12px 0', borderRadius: 0,
            background: token.trim() ? '#4a6aff' : '#333', color: '#fff',
            border: '2px solid #3a3a5c', fontSize: 10, fontWeight: 600, cursor: token.trim() ? 'pointer' : 'default',
            marginBottom: 12, opacity: token.trim() ? 1 : 0.5,
            fontFamily: '"Press Start 2P", cursive',
            boxShadow: 'inset -2px -2px 0 #0a0a1a, inset 2px 2px 0 #6a8aff',
          }}
        >
          התחבר
        </button>

        <div style={{ textAlign: 'center' }}>
          <button
            onClick={onDemo}
            style={{
              background: 'none', border: 'none', color: '#7a7aff',
              fontSize: 8, cursor: 'pointer', textDecoration: 'underline',
              fontFamily: '"Press Start 2P", cursive',
            }}
          >
            סביבת דמו
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Ambient Sound System (8-bit procedural via Web Audio API) ──

interface SoundSystem {
  ctx: AudioContext | null
  enabled: boolean
  ambientNode: OscillatorNode | null
  ambientGain: GainNode | null
  init(): void
  toggle(): boolean
  playTyping(): void
  playNotification(): void
  startAmbient(): void
  stopAmbient(): void
  dispose(): void
}

function createSoundSystem(): SoundSystem {
  const sys: SoundSystem = {
    ctx: null,
    enabled: false,
    ambientNode: null,
    ambientGain: null,

    init() {
      if (this.ctx) return
      this.ctx = new AudioContext()
    },

    toggle(): boolean {
      this.init()
      this.enabled = !this.enabled
      if (this.enabled) {
        this.startAmbient()
      } else {
        this.stopAmbient()
      }
      localStorage.setItem('sound-enabled', this.enabled ? '1' : '0')
      return this.enabled
    },

    /** 8-bit keyboard typing sound */
    playTyping() {
      if (!this.enabled || !this.ctx) return
      const ctx = this.ctx
      const now = ctx.currentTime

      // Short burst of noise-like clicks (square wave rapid pitch changes)
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.connect(gain)
      gain.connect(ctx.destination)

      // Rapid pitch modulation = typing clicks
      const clickCount = 2 + Math.floor(Math.random() * 3)
      for (let i = 0; i < clickCount; i++) {
        const t = now + i * 0.06
        osc.frequency.setValueAtTime(800 + Math.random() * 400, t)
        gain.gain.setValueAtTime(0.04, t)
        gain.gain.setValueAtTime(0, t + 0.02)
      }

      osc.start(now)
      osc.stop(now + clickCount * 0.06 + 0.05)
    },

    /** 8-bit notification ding */
    playNotification() {
      if (!this.enabled || !this.ctx) return
      const ctx = this.ctx
      const now = ctx.currentTime

      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.connect(gain)
      gain.connect(ctx.destination)

      // Two-tone ding (classic 8-bit)
      osc.frequency.setValueAtTime(587, now)       // D5
      osc.frequency.setValueAtTime(880, now + 0.1)  // A5
      gain.gain.setValueAtTime(0.08, now)
      gain.gain.linearRampToValueAtTime(0.06, now + 0.1)
      gain.gain.linearRampToValueAtTime(0, now + 0.3)

      osc.start(now)
      osc.stop(now + 0.35)
    },

    /** Quiet ambient office hum */
    startAmbient() {
      if (!this.ctx || this.ambientNode) return
      const ctx = this.ctx

      // Very quiet low-frequency hum
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(60, ctx.currentTime)
      gain.gain.setValueAtTime(0.008, ctx.currentTime)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()

      this.ambientNode = osc
      this.ambientGain = gain
    },

    stopAmbient() {
      if (this.ambientNode) {
        this.ambientNode.stop()
        this.ambientNode.disconnect()
        this.ambientNode = null
      }
      if (this.ambientGain) {
        this.ambientGain.disconnect()
        this.ambientGain = null
      }
    },

    dispose() {
      this.stopAmbient()
      this.ctx?.close()
      this.ctx = null
    },
  }

  // Restore saved preference (but always start OFF)
  sys.enabled = false
  return sys
}

const globalSound = createSoundSystem()

// ── Notification System ──

interface OfficeNotification {
  id: string
  agentName: string
  agentEmoji: string
  message: string
  timestamp: number
}

const MAX_VISIBLE_NOTIFICATIONS = 3
const NOTIFICATION_DURATION_MS = 5_000

// ── React App ──
export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hoverAgentId, _setHoverAgentId] = useState<string | null>(null)
  const hoverAgentIdRef = useRef<string | null>(null)
  const selectedIdRef = useRef<string | null>(null)
  const setHoverAgentId = useCallback((id: string | null) => {
    hoverAgentIdRef.current = id
    _setHoverAgentId(id)
  }, [])
  const [selectedId, _setSelectedId] = useState<string | null>(null)
  const [chatMinimized, setChatMinimized] = useState(false)
  const setSelectedId = useCallback((val: string | null | ((prev: string | null) => string | null)) => {
    _setSelectedId(prev => {
      const next = typeof val === 'function' ? val(prev) : val
      selectedIdRef.current = next
      if (next !== prev) setChatMinimized(false) // expand when switching agents
      return next
    })
  }, [])
  const [agentDefs, setAgentDefs] = useState<AgentDef[]>(DEFAULT_AGENT_DEFS)
  const agentDefsRef = useRef<AgentDef[]>(agentDefs)
  agentDefsRef.current = agentDefs
  // Lazy init — buildAgents has side effects (mutates MAP_COLS/MAP_ROWS/FLOOR_MAP)
  // useRef(expr) evaluates expr on EVERY render, so we must guard against repeated calls
  const agentsInitializedRef = useRef(false)
  const agentsRef = useRef<AgentRuntime[]>([])
  if (!agentsInitializedRef.current) {
    agentsInitializedRef.current = true
    agentsRef.current = buildAgents(DEFAULT_AGENT_DEFS)
  }
  const animRef = useRef<number>(0)
  const originRef = useRef<{ ox: number; oy: number }>({ ox: 0, oy: 0 })

  // Pan & scale state
  const panRef = useRef({ x: 0, y: 0 })
  const scaleRef = useRef(1)
  const userZoomRef = useRef(1) // user-controlled zoom (pinch/wheel)
  // Viewport dimensions — kept in sync with animation loop for hit testing consistency
  const viewportRef = useRef({ w: window.innerWidth, h: window.innerHeight })
  const touchRef = useRef<{
    startX: number; startY: number
    startPanX: number; startPanY: number
    moved: boolean
  } | null>(null)
  const pinchRef = useRef<{
    startDist: number
    startZoom: number
  } | null>(null)
  const lastTouchEndRef = useRef(0)
  const prevUpdatedAtRef = useRef<Map<string, number>>(new Map())
  const lastDefsUpdateRef = useRef<number>(0)

  // Edit mode state
  const [editMode, setEditMode] = useState(false)
  const [decorations, setDecorations] = useState<DecorationWithId[]>(() => loadLayout())
  const [selectedDecoId, setSelectedDecoId] = useState<number | null>(null)
  const [placementType, setPlacementType] = useState<string | null>(null)

  // Edit mode refs (synced during render)
  const editModeRef = useRef(false)
  const hoverTileRef = useRef<[number, number] | null>(null)
  const decorationsRef = useRef<DecorationWithId[]>(decorations)
  const selectedDecoIdRef = useRef<number | null>(null)
  const placementTypeRef = useRef<string | null>(null)
  const dragRef = useRef<{ decoId: number; startCol: number; startRow: number; startMx: number; startMy: number; moved: boolean } | null>(null)

  // Sync refs
  editModeRef.current = editMode
  decorationsRef.current = decorations
  selectedDecoIdRef.current = selectedDecoId
  placementTypeRef.current = placementType

  // Loading state
  const [canvasReady, setCanvasReady] = useState(false)
  // Sound state
  const [soundEnabled, setSoundEnabled] = useState(false)
  // Notification state
  const [notifications, setNotifications] = useState<OfficeNotification[]>([])
  const prevStatesRef = useRef<Map<string, AgentState>>(new Map())
  // Settings state
  const [showSettings, setShowSettings] = useState(() => !localStorage.getItem('gateway-token'))
  const [gatewayToken, setGatewayToken] = useState(() => localStorage.getItem('gateway-token') || '')
  const [gatewayUrl, setGatewayUrl] = useState(() => localStorage.getItem('gateway-url') || 'http://127.0.0.1:18789')

  // Dashboard mode toggle
  const [dashboardMode, setDashboardMode] = useState(false)

  // Responsive breakpoint detection
  const [breakpoint, setBreakpoint] = useState<Breakpoint>(() => getBreakpoint(window.innerWidth))
  const isMobile = breakpoint === 'compact' || breakpoint === 'mobile'
  const isCompact = breakpoint === 'compact'
  useEffect(() => {
    const handler = () => setBreakpoint(getBreakpoint(window.innerWidth))
    window.addEventListener('resize', handler)
    window.addEventListener('orientationchange', handler)
    return () => {
      window.removeEventListener('resize', handler)
      window.removeEventListener('orientationchange', handler)
    }
  }, [])

  useEffect(() => {
    loadSpritesForAgents(agentDefs)
    loadDecorations()
  }, [agentDefs])

  // ── Sound system cleanup ──
  useEffect(() => {
    return () => globalSound.dispose()
  }, [])

  // ── Notification auto-dismiss ──
  useEffect(() => {
    if (notifications.length === 0) return
    const timers = notifications.map(n => {
      const remaining = NOTIFICATION_DURATION_MS - (Date.now() - n.timestamp)
      if (remaining <= 0) return null
      return setTimeout(() => {
        setNotifications(prev => prev.filter(p => p.id !== n.id))
      }, remaining)
    }).filter(Boolean) as ReturnType<typeof setTimeout>[]
    return () => timers.forEach(clearTimeout)
  }, [notifications])

  // ── Mouse wheel: pan (no modifier) / zoom (Ctrl/Cmd) ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+scroll = pan
        panRef.current.x -= e.deltaX / scaleRef.current
        panRef.current.y -= e.deltaY / scaleRef.current
        clampPan(panRef.current)
      } else {
        // Scroll = zoom (standard, like Google Maps / Figma)
        const delta = -e.deltaY * 0.002
        userZoomRef.current = Math.min(3, Math.max(0.3, userZoomRef.current + delta))
      }
    }
    canvas.addEventListener('wheel', handler, { passive: false })
    return () => canvas.removeEventListener('wheel', handler)
  }, [])

  // ── Live status polling from Gateway — discovers agents dynamically ──
  const discoveredRef = useRef(false)
  useEffect(() => {
    if (!gatewayToken) return // demo mode — use DEFAULT_AGENT_DEFS

    async function pollGateway() {
      try {
        // Use backend proxy to avoid CORS issues
        const backendBase = window.location.port === '5173'
          ? 'http://localhost:3001'  // dev mode: Vite on 5173, backend on 3001
          : window.location.origin   // prod: same origin

        const res = await fetch(`${backendBase}/api/proxy/sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Gateway-Token': gatewayToken,
            'X-Gateway-URL': gatewayUrl,
          },
          body: JSON.stringify({ activeMinutes: 10080, messageLimit: 3 }), // 7 days — load ALL agents
        })
        if (!res.ok) return
        const data = await res.json()
        const sessions: any[] = data.sessions ?? []
        if (sessions.length === 0) return

        // Group sessions by agent, preferring listenable sessions (main/webchat)
        const agentSessions = new Map<string, any>()
        // Prefer discord sessions — messages sent via chat UI must arrive in the agent's Discord channel
        const SESSION_KIND_PRIORITY: Record<string, number> = { discord: 3, telegram: 2, webchat: 1, main: 0 }
        for (const session of sessions) {
          const keyParts = (session.key || '').split(':')
          const rawId = keyParts[1] || 'unknown'
          const agentId = rawId
          const kind = session.kind || keyParts[2] || ''
          const existing = agentSessions.get(agentId)
          if (!existing) {
            agentSessions.set(agentId, session)
          } else {
            const existingKind = existing.kind || (existing.key || '').split(':')[2] || ''
            const newPriority = SESSION_KIND_PRIORITY[kind] ?? 0
            const existingPriority = SESSION_KIND_PRIORITY[existingKind] ?? 0
            // Prefer higher-priority session kind; if same priority, take most recent
            if (newPriority > existingPriority ||
                (newPriority === existingPriority && (session.updatedAt ?? 0) > (existing.updatedAt ?? 0))) {
              agentSessions.set(agentId, session)
            }
          }
        }

        const sessionEntries: [string, any][] = Array.from(agentSessions.entries())

        // First poll: discover agents and rebuild — include ALL known agents
        if (!discoveredRef.current && sessionEntries.length > 0) {
          discoveredRef.current = true
          const discoveredIds = new Set(sessionEntries.map(([id]) => id))
          const newDefs: AgentDef[] = sessionEntries.map(([id, s], i) => {
            const updatedAt = new Date(s.updatedAt).getTime()
            const { text: taskText } = extractTaskFromSession(s)
            const known = KNOWN_AGENTS[id]
            const def = agentDefFromSession(s.key, known?.fixedIndex ?? i, updatedAt, !!s.abortedLastRun, taskText)
            def.model = s.model ?? undefined
            def.tokenUsage = s.totalTokens ?? undefined
            return def
          })
          // All agents come from Gateway — no hardcoded additions needed
          setAgentDefs(newDefs)
          loadSpritesForAgents(newDefs)
          agentsRef.current = buildAgents(newDefs)
          return
        }

        // Subsequent polls: update existing agents' states + discover new ones
        const currentDefs = agentDefsRef.current
        const currentIds = new Set(currentDefs.map(d => d.id))
        let needsRebuild = false

        for (const [id, session] of sessionEntries) {
          if (!currentIds.has(id)) {
            // New agent discovered — add it
            needsRebuild = true
            continue
          }
        }

        if (needsRebuild) {
          const newDefs: AgentDef[] = sessionEntries.map(([id, s], i) => {
            const existing = currentDefs.find(d => d.id === id)
            const updatedAt = new Date(s.updatedAt).getTime()
            const { text: taskText, isFallback: taskIsFallback } = extractTaskFromSession(s)
            const def = agentDefFromSession(s.key, existing?.cubicleIndex ?? i, updatedAt, !!s.abortedLastRun, taskText)
            if (existing) { def.task = (!taskIsFallback && taskText) ? taskText : (existing.task || taskText) }
            return def
          })
          setAgentDefs(newDefs)
          loadSpritesForAgents(newDefs)
          // Preserve existing agent positions during rebuild to prevent flicker
          const oldAgents = agentsRef.current
          const newAgents = buildAgents(newDefs)
          for (const na of newAgents) {
            const old = oldAgents.find(oa => oa.def.id === na.def.id)
            if (old) { na.x = old.x; na.y = old.y }
          }
          agentsRef.current = newAgents
          return
        }

        // Normal update: just update states
        const agentRuntimes = agentsRef.current
        const byIdMap = new Map(sessionEntries)
        let defsChanged = false
        for (const a of agentRuntimes) {
          const session = byIdMap.get(a.def.id)
          if (!session) continue

          const updatedAt = new Date(session.updatedAt).getTime()
          const elapsed = Date.now() - updatedAt
          const prevUpdated = prevUpdatedAtRef.current.get(a.def.id) ?? 0
          const justChanged = prevUpdated > 0 && updatedAt !== prevUpdated
          prevUpdatedAtRef.current.set(a.def.id, updatedAt)

          let newState: AgentState
          if (session.abortedLastRun) {
            newState = 'error'
          } else if (justChanged || elapsed < 15_000) {
            // updatedAt changed since last poll → actively working
            newState = 'working'
          } else if (elapsed < 120_000) {
            newState = 'active'
          } else if (elapsed < 300_000) {
            newState = 'idle'
          } else {
            newState = 'offline'
          }

          if (newState !== a.def.state) {
            const oldState = a.def.state
            a.def.state = newState
            a.zone = getZoneForState(newState)
            const [tx, ty] = getTargetTile(a.def)
            a.tx = tx
            a.ty = ty
            defsChanged = true

            // Notification: agent finished working (working/active → idle/offline)
            if ((oldState === 'working' || oldState === 'active') && (newState === 'idle' || newState === 'offline')) {
              const notif: OfficeNotification = {
                id: `${a.def.id}-${Date.now()}`,
                agentName: a.def.name,
                agentEmoji: a.def.emoji,
                message: 'סיים משימה',
                timestamp: Date.now(),
              }
              setNotifications(prev => [...prev.slice(-(MAX_VISIBLE_NOTIFICATIONS - 1)), notif])
              globalSound.playNotification()
            }

            // Sound: agent started working
            if (newState === 'working' || newState === 'active') {
              globalSound.playTyping()
            }
          }

          const { text: newTask, isFallback: newTaskIsFallback } = extractTaskFromSession(session, newState)
          if (newTask && newTask !== a.def.task) {
            // Don't overwrite a real task with a fallback label
            const currentIsFallback = !a.def.task || Object.values(TASK_FALLBACKS).includes(a.def.task)
            if (!newTaskIsFallback || currentIsFallback) {
              a.def.task = newTask
              defsChanged = true
            }
          }
          if (updatedAt !== a.def.lastUpdated) {
            a.def.lastUpdated = updatedAt
            defsChanged = true
          }
          const newModel = session.model ?? undefined
          if (newModel !== a.def.model) {
            a.def.model = newModel
            defsChanged = true
          }
          const newTokens = session.totalTokens ?? undefined
          if (newTokens !== a.def.tokenUsage) {
            a.def.tokenUsage = newTokens
            defsChanged = true
          }
        }
        // Sync React state so detail panel re-renders — throttle to max once per 3s
        if (defsChanged) {
          const now = Date.now()
          if (!lastDefsUpdateRef.current || now - lastDefsUpdateRef.current > 3000) {
            lastDefsUpdateRef.current = now
            setAgentDefs(agentRuntimes.map(a => ({ ...a.def })))
          }
        }
      } catch {
        // Gateway not available, keep static/demo data
      }
    }

    pollGateway()
    // Poll every 5s — fast enough for status updates, avoids re-render churn
    const timer = setInterval(pollGateway, 5000)
    return () => clearInterval(timer)
  }, [gatewayToken, gatewayUrl])

  // ── Animation loop (DPR-aware, double-buffered) ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    // Offscreen buffer for flicker-free drawing
    const offscreen = document.createElement('canvas')
    const offCtx = offscreen.getContext('2d')!

    function frame() {
      const dpr = window.devicePixelRatio || 1
      const w = window.innerWidth
      const h = window.innerHeight
      viewportRef.current = { w, h }

      // DPR-aware canvas sizing — only resize when dimensions change
      const targetW = w * dpr
      const targetH = h * dpr
      if (canvas!.width !== targetW || canvas!.height !== targetH) {
        canvas!.width = targetW
        canvas!.height = targetH
        canvas!.style.width = w + 'px'
        canvas!.style.height = h + 'px'
      }
      if (offscreen.width !== targetW || offscreen.height !== targetH) {
        offscreen.width = targetW
        offscreen.height = targetH
      }

      // Draw to offscreen buffer first
      offCtx.clearRect(0, 0, offscreen.width, offscreen.height)

      const t = performance.now() / 1000

      // Clean expired chat bubbles
      cleanBubbles(t * 1000)

      // Ambient typing sounds for working agents (every ~3 seconds, randomized)
      if (globalSound.enabled && Math.random() < 0.01) {
        const workingAgents = agentsRef.current.filter(a => a.def.state === 'working' || a.def.state === 'active')
        if (workingAgents.length > 0) {
          globalSound.playTyping()
        }
      }

      // Lerp agents toward targets
      const agents = agentsRef.current
      for (const a of agents) {
        const dx = a.tx - a.x
        const dy = a.ty - a.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist > 0.5) {
          a.x += dx * 0.08
          a.y += dy * 0.08
        } else {
          a.x = a.tx
          a.y = a.ty
        }
      }

      // Compute auto-scale for smaller viewports × user zoom
      const { minX, minY, isoW, isoH } = getIsoBounds()
      const autoScale = Math.min(1, (w - 20) / isoW, (h - 80) / isoH)
      const scale = autoScale * userZoomRef.current
      scaleRef.current = scale

      // Compute origin (before scale transform, for hit testing)
      const ox = (w - isoW) / 2 - minX + panRef.current.x
      const oy = (h - isoH) / 2 - minY - 20 + panRef.current.y
      originRef.current = { ox, oy }

      // Apply DPR + scale around center of viewport — draw to offscreen
      offCtx.save()
      offCtx.scale(dpr, dpr)
      offCtx.translate(w / 2, h / 2)
      offCtx.scale(scale, scale)
      offCtx.translate(-w / 2, -h / 2)

      const fonts = getCanvasFontSizes(getBreakpoint(w))
      const editState: EditState = {
        active: editModeRef.current,
        selectedDecoId: selectedDecoIdRef.current,
        draggingDecoId: dragRef.current?.decoId ?? null,
        placementPreview: placementTypeRef.current && hoverTileRef.current
          ? { type: placementTypeRef.current, col: hoverTileRef.current[0], row: hoverTileRef.current[1] }
          : null,
      }
      drawScene(offCtx, w, h, t, agents, hoverAgentIdRef.current, selectedIdRef.current, panRef.current.x, panRef.current.y, fonts, decorationsRef.current, editState, agentDefsRef.current)

      offCtx.restore()

      // Copy completed frame to visible canvas in one operation (no flicker)
      ctx.clearRect(0, 0, canvas!.width, canvas!.height)
      ctx.drawImage(offscreen, 0, 0)

      if (!canvasReady) setCanvasReady(true)
      animRef.current = requestAnimationFrame(frame)
    }

    animRef.current = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(animRef.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings])

  // ── Transform screen coords to canvas coords (accounting for scale + DPR) ──
  const screenToCanvas = useCallback((clientX: number, clientY: number, rect: DOMRect): [number, number] => {
    // Use viewportRef for consistency with animation loop (avoids rect.width mismatches)
    const { w, h } = viewportRef.current
    const s = scaleRef.current
    // Convert client coords to canvas-relative coords using rect offset
    const relX = clientX - rect.left
    const relY = clientY - rect.top
    // Invert the canvas transform: translate(w/2, h/2) → scale(s) → translate(-w/2, -h/2)
    const mx = (relX - w / 2) / s + w / 2
    const my = (relY - h / 2) / s + h / 2
    return [mx, my]
  }, [])

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Skip synthetic click fired by browser after touchEnd (prevents double-toggle on mobile)
    if (Date.now() - lastTouchEndRef.current < 500) return
    const rect = e.currentTarget.getBoundingClientRect()
    const [mx, my] = screenToCanvas(e.clientX, e.clientY, rect)
    const { ox, oy } = originRef.current
    if (editModeRef.current) {
      // If dragging, the click is handled by mouseUp
      if (dragRef.current?.moved) return

      const [col, row] = screenToTile(mx, my, ox, oy)

      if (placementTypeRef.current) {
        // Place new decoration
        const newDeco: DecorationWithId = {
          type: placementTypeRef.current,
          col: Math.max(0, Math.min(MAP_COLS - 1, col)),
          row: Math.max(0, Math.min(MAP_ROWS - 1, row)),
          scale: 1,
          _id: nextDecoId(),
        }
        setDecorations(prev => {
          const next = [...prev, newDeco]
          saveLayout(next)
          return next
        })
        setPlacementType(null)
        return
      }

      // Hit test decorations
      const hitDeco = hitTestDeco(mx, my, decorationsRef.current, ox, oy)
      if (hitDeco) {
        setSelectedDecoId(hitDeco._id)
        return
      }
      setSelectedDecoId(null)
    }

    const agent = hitTestAgent(mx, my, agentsRef.current, ox, oy)
    setSelectedId(prev => prev === agent?.def.id ? null : (agent?.def.id ?? null))
  }, [screenToCanvas])

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!editModeRef.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const [mx, my] = screenToCanvas(e.clientX, e.clientY, rect)
    const { ox, oy } = originRef.current
    const hitDeco = hitTestDeco(mx, my, decorationsRef.current, ox, oy)
    if (hitDeco) {
      dragRef.current = {
        decoId: hitDeco._id,
        startCol: hitDeco.col,
        startRow: hitDeco.row,
        startMx: mx,
        startMy: my,
        moved: false,
      }
      e.preventDefault()
    }
  }, [screenToCanvas])

  const handleMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const [mx, my] = screenToCanvas(e.clientX, e.clientY, rect)
    const { ox, oy } = originRef.current

    // Drag deco in edit mode
    if (editModeRef.current && dragRef.current) {
      const dx = mx - dragRef.current.startMx
      const dy = my - dragRef.current.startMy
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        dragRef.current.moved = true
      }
      if (dragRef.current.moved) {
        const [col, row] = screenToTile(mx, my, ox, oy)
        const clampedCol = Math.max(0, Math.min(MAP_COLS - 1, col))
        const clampedRow = Math.max(0, Math.min(MAP_ROWS - 1, row))
        // Mutate the existing object in-place — no allocations during drag
        const target = decorationsRef.current.find(d => d._id === dragRef.current!.decoId)
        if (target) { target.col = clampedCol; target.row = clampedRow }
        e.currentTarget.style.cursor = 'grabbing'
        return
      }
    }

    if (editModeRef.current) {
      const hitDeco = hitTestDeco(mx, my, decorationsRef.current, ox, oy)
      if (hitDeco) {
        e.currentTarget.style.cursor = 'grab'
        return
      }
      if (placementTypeRef.current) {
        const [col, row] = screenToTile(mx, my, ox, oy)
        hoverTileRef.current = [
          Math.max(0, Math.min(MAP_COLS - 1, col)),
          Math.max(0, Math.min(MAP_ROWS - 1, row)),
        ]
        e.currentTarget.style.cursor = 'crosshair'
        return
      }
    }

    const agent = hitTestAgent(mx, my, agentsRef.current, ox, oy)
    setHoverAgentId(agent?.def.id ?? null)
    e.currentTarget.style.cursor = agent ? 'pointer' : 'default'
  }, [screenToCanvas])

  const handleMouseUp = useCallback((_e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragRef.current) {
      if (dragRef.current.moved) {
        // Sync React state from ref now that drag ended, then persist
        setDecorations([...decorationsRef.current])
        saveLayout(decorationsRef.current)
      }
      dragRef.current = null
    }
  }, [])

  // ── Touch handlers (pan + pinch-to-zoom) ──
  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 1) {
      const t = e.touches[0]

      // In edit mode, check if touching a deco to start drag
      if (editModeRef.current) {
        const rect = e.currentTarget.getBoundingClientRect()
        const [mx, my] = screenToCanvas(t.clientX, t.clientY, rect)
        const { ox, oy } = originRef.current
        const hitDeco = hitTestDeco(mx, my, decorationsRef.current, ox, oy)
        if (hitDeco) {
          dragRef.current = {
            decoId: hitDeco._id,
            startCol: hitDeco.col,
            startRow: hitDeco.row,
            startMx: mx,
            startMy: my,
            moved: false,
          }
          touchRef.current = {
            startX: t.clientX,
            startY: t.clientY,
            startPanX: panRef.current.x,
            startPanY: panRef.current.y,
            moved: false,
          }
          pinchRef.current = null
          return
        }
      }

      touchRef.current = {
        startX: t.clientX,
        startY: t.clientY,
        startPanX: panRef.current.x,
        startPanY: panRef.current.y,
        moved: false,
      }
      pinchRef.current = null
    } else if (e.touches.length === 2) {
      // Pinch start
      touchRef.current = null
      dragRef.current = null
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      pinchRef.current = {
        startDist: Math.sqrt(dx * dx + dy * dy),
        startZoom: userZoomRef.current,
      }
    }
  }, [screenToCanvas])

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 2 && pinchRef.current) {
      // Pinch-to-zoom
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.sqrt(dx * dx + dy * dy)
      const ratio = dist / pinchRef.current.startDist
      userZoomRef.current = Math.min(3, Math.max(0.3, pinchRef.current.startZoom * ratio))
    } else if (e.touches.length === 1 && dragRef.current) {
      // Dragging deco via touch
      const touch = e.touches[0]
      const rect = e.currentTarget.getBoundingClientRect()
      const [mx, my] = screenToCanvas(touch.clientX, touch.clientY, rect)
      const { ox, oy } = originRef.current
      const tdx = mx - dragRef.current.startMx
      const tdy = my - dragRef.current.startMy
      if (Math.abs(tdx) > 5 || Math.abs(tdy) > 5) {
        dragRef.current.moved = true
      }
      if (dragRef.current.moved) {
        const [col, row] = screenToTile(mx, my, ox, oy)
        const clampedCol = Math.max(0, Math.min(MAP_COLS - 1, col))
        const clampedRow = Math.max(0, Math.min(MAP_ROWS - 1, row))
        // Mutate in-place during drag — no allocations (same fix as mouse drag)
        const target = decorationsRef.current.find(d => d._id === dragRef.current!.decoId)
        if (target) { target.col = clampedCol; target.row = clampedRow }
      }
    } else if (e.touches.length === 1 && touchRef.current) {
      const touch = e.touches[0]
      const dx = touch.clientX - touchRef.current.startX
      const dy = touch.clientY - touchRef.current.startY
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        touchRef.current.moved = true
      }
      panRef.current.x = touchRef.current.startPanX + dx / scaleRef.current
      panRef.current.y = touchRef.current.startPanY + dy / scaleRef.current
      clampPan(panRef.current)
    }
    e.preventDefault()
  }, [screenToCanvas])

  const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 0) {
      if (dragRef.current) {
        if (dragRef.current.moved) {
          // Sync React state from ref now that drag ended, then persist
          setDecorations([...decorationsRef.current])
          saveLayout(decorationsRef.current)
        }
        dragRef.current = null
      } else if (touchRef.current && !touchRef.current.moved) {
        // Tap — treat as click (with larger hit area on mobile)
        const rect = e.currentTarget.getBoundingClientRect()
        const [mx, my] = screenToCanvas(touchRef.current.startX, touchRef.current.startY, rect)
        const { ox, oy } = originRef.current

        if (editModeRef.current) {
          const [col, row] = screenToTile(mx, my, ox, oy)
          if (placementTypeRef.current) {
            const newDeco: DecorationWithId = {
              type: placementTypeRef.current,
              col: Math.max(0, Math.min(MAP_COLS - 1, col)),
              row: Math.max(0, Math.min(MAP_ROWS - 1, row)),
              scale: 1,
              _id: nextDecoId(),
            }
            setDecorations(prev => {
              const next = [...prev, newDeco]
              saveLayout(next)
              return next
            })
            setPlacementType(null)
          } else {
            const hitDeco = hitTestDeco(mx, my, decorationsRef.current, ox, oy)
            if (hitDeco) {
              setSelectedDecoId(hitDeco._id)
            } else {
              setSelectedDecoId(null)
              const agent = hitTestAgent(mx, my, agentsRef.current, ox, oy, 1.3)
              setSelectedId(prev => prev === agent?.def.id ? null : (agent?.def.id ?? null))
            }
          }
        } else {
          const agent = hitTestAgent(mx, my, agentsRef.current, ox, oy, 1.3)
          setSelectedId(prev => prev === agent?.def.id ? null : (agent?.def.id ?? null))
        }
      }
      lastTouchEndRef.current = Date.now()
      touchRef.current = null
      pinchRef.current = null
    }
  }, [screenToCanvas])

  // ── Settings handlers ──
  const handleConnect = useCallback((token: string, url: string) => {
    setGatewayToken(token)
    setGatewayUrl(url)
    setShowSettings(false)
  }, [])

  const handleDemo = useCallback(() => {
    setShowSettings(false)
  }, [])

  // Escape key handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditMode(false)
        setPlacementType(null)
        setSelectedDecoId(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Resolve backend base URL (dev vs prod)
  const getBackendBase = useCallback(() => {
    return window.location.port === '5173'
      ? 'http://localhost:3001'
      : window.location.origin
  }, [])

  // Send message to agent via Gateway proxy
  const handleSendToAgent = useCallback(async (agentId: string, message: string) => {
    const agent = agentDefsRef.current.find(a => a.id === agentId)
    const sessionKey = agent?.sessionKey
    if (!sessionKey) {
      throw new Error('No session key for agent')
    }

    const res = await fetch(`${getBackendBase()}/api/proxy/send`, {
      method: 'POST',
      headers: {
        'X-Gateway-Token': gatewayToken,
        'X-Gateway-URL': gatewayUrl,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionKey, message, agentId }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Gateway error: ${res.status}`)
    }
    // Show chat bubble above agent on canvas
    addChatBubble(agentId, message)
  }, [gatewayToken, gatewayUrl, getBackendBase])

  // Fetch chat history for an agent (pass `after` timestamp to get only newer messages)
  const handleFetchHistory = useCallback(async (agentId: string, after?: number): Promise<ChatMessage[]> => {
    const agent = agentDefsRef.current.find(a => a.id === agentId)
    const sessionKey = agent?.sessionKey
    if (!sessionKey) return []

    const body: any = { sessionKey, agentId, limit: 50 }
    if (after) body.after = new Date(after).toISOString()

    const res = await fetch(`${getBackendBase()}/api/proxy/history`, {
      method: 'POST',
      headers: {
        'X-Gateway-Token': gatewayToken,
        'X-Gateway-URL': gatewayUrl,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) return []

    const data = await res.json()
    // v2: backend returns { ok, agentId, messages: StoredMessage[], total }
    const history = data?.messages ?? data?.result?.messages ?? data?.result ?? []

    if (!Array.isArray(history)) return []

    return history
      .filter((m: any) => m.role === 'user' || m.role === 'assistant')
      .map((m: any, i: number) => ({
        id: m.id || `hist-${i}-${m.timestamp || i}`,
        role: m.role as 'user' | 'assistant',
        text: (m.text || m.content || m.preview || '').substring(0, 2000),
        ts: m.timestamp ? new Date(m.timestamp).getTime() : Date.now() - (history.length - i) * 1000,
        source: m.channel || m.source || undefined,
      }))
      .filter((m: ChatMessage) => m.text.length > 0)
  }, [gatewayToken, gatewayUrl, getBackendBase])

  const selectedAgent = agentDefs.find(a => a.id === selectedId) ?? null

    // Show settings screen
  if (showSettings) {
    return <SettingsScreen onConnect={handleConnect} onDemo={handleDemo} />
  }

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      {/* Global pixel art styles */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
        * { image-rendering: pixelated; }
        canvas { image-rendering: pixelated; image-rendering: crisp-edges; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #16162b; }
        ::-webkit-scrollbar-thumb { background: #3a3a5c; border-radius: 0; }
        ::-webkit-scrollbar-thumb:hover { background: #4a6aff; }
        @keyframes pixelLoad { 0% { width: 0%; } 100% { width: 100%; } }
        @keyframes pixelBlink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
        @keyframes loading { 0%{width:0%} 25%{width:25%} 50%{width:50%} 75%{width:75%} 100%{width:100%} }
        @keyframes chatFadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes chatSpin {
          to { transform: rotate(360deg); }
        }
        @keyframes chatBounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
        @keyframes chatBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
      {/* Loading overlay */}
      {!canvasReady && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 50,
          background: '#1a1a2e', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 16,
          fontFamily: '"Press Start 2P", cursive',
        }}>
          <div style={{ fontSize: 48 }}>🏢</div>
          <div style={{ color: '#7a7aaa', fontSize: 10 }}>טוען משרד...</div>
          <div style={{
            width: 120, height: 8, background: '#2a2a4a', borderRadius: 0, overflow: 'hidden',
            border: '2px solid #3a3a5c',
          }}>
            <div style={{
              width: '100%', height: '100%', background: '#4a6aff', borderRadius: 0,
              animation: 'loading 2s steps(8) infinite',
            }} />
          </div>
          <div style={{ color: '#4a6aff', fontSize: 8, animation: 'pixelBlink 1s steps(1) infinite' }}>▓▓▓</div>
        </div>
      )}
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ display: 'block', touchAction: 'none', imageRendering: 'pixelated' }}
      />

      {/* Notifications — toast stack (top-right) */}
      <div style={{
        position: 'absolute', top: 12, right: 12,
        display: 'flex', flexDirection: 'column', gap: 8,
        zIndex: 60, pointerEvents: 'none',
        maxWidth: isMobile ? 'calc(100vw - 24px)' : 300,
      }}>
        {notifications.map((n, i) => (
          <div
            key={n.id}
            onClick={() => setNotifications(prev => prev.filter(p => p.id !== n.id))}
            style={{
              pointerEvents: 'auto',
              background: 'rgba(25,25,50,0.95)',
              border: '2px solid #4a6aff',
              borderRadius: 0,
              padding: isCompact ? '8px 10px' : '10px 14px',
              display: 'flex', alignItems: 'center', gap: 10,
              cursor: 'pointer',
              fontFamily: '"Press Start 2P", cursive',
              boxShadow: 'inset -2px -2px 0 #0a0a1a, inset 2px 2px 0 #2a2a4a, 0 4px 12px rgba(0,0,0,0.5)',
              animation: 'chatFadeIn 0.3s ease-out',
              direction: 'rtl',
            }}
          >
            <span style={{ fontSize: isCompact ? 18 : 22 }}>{n.agentEmoji}</span>
            <div>
              <div style={{ fontSize: isCompact ? 12 : 13, color: '#eee', marginBottom: 2 }}>
                {n.agentName}
              </div>
              <div style={{ fontSize: isCompact ? 6 : 7, color: '#4a6aff' }}>
                ✅ {n.message}
              </div>
            </div>
            <span style={{ fontSize: 6, color: '#555', marginRight: 'auto' }}>✕</span>
          </div>
        ))}
      </div>

      {/* Settings gear icon */}
      <button
        onClick={() => setShowSettings(true)}
        style={{
          position: 'absolute', top: 12, left: 12,
          background: 'rgba(30,30,55,0.8)', border: '2px solid #3a3a5c',
          borderRadius: 0, width: 36, height: 36, fontSize: 18,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#aaa', fontFamily: '"Press Start 2P", cursive',
          boxShadow: 'inset -2px -2px 0 #0a0a1a, inset 2px 2px 0 #2a2a4a',
        }}
        title="הגדרות"
      >
        ⚙️
      </button>

      {/* Sound toggle button */}
      <button
        onClick={() => {
          const nowEnabled = globalSound.toggle()
          setSoundEnabled(nowEnabled)
        }}
        style={{
          position: 'absolute', top: 12, left: 56,
          background: soundEnabled ? 'rgba(74,106,255,0.5)' : 'rgba(30,30,55,0.8)',
          border: '2px solid #3a3a5c',
          borderRadius: 0, width: 36, height: 36, fontSize: 16,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: soundEnabled ? '#fff' : '#666',
          fontFamily: '"Press Start 2P", cursive',
          boxShadow: 'inset -2px -2px 0 #0a0a1a, inset 2px 2px 0 #2a2a4a',
        }}
        title={soundEnabled ? 'כבה סאונד' : 'הפעל סאונד'}
      >
        {soundEnabled ? '🔊' : '🔇'}
      </button>

      {/* Dashboard mode toggle button */}
      <button
        onClick={() => setDashboardMode(m => !m)}
        style={{
          position: 'absolute', top: 12, left: 100,
          background: dashboardMode ? 'rgba(74,106,255,0.5)' : 'rgba(30,30,55,0.8)',
          border: '2px solid #3a3a5c', borderRadius: 0,
          width: 36, height: 36, fontSize: 18,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: dashboardMode ? '#fff' : '#aaa',
          fontFamily: '"Press Start 2P", cursive',
          boxShadow: 'inset -2px -2px 0 #0a0a1a, inset 2px 2px 0 #2a2a4a',
          zIndex: 20,
        }}
        title={dashboardMode ? 'חזור למשרד' : 'Dashboard'}
      >
        📊
      </button>

      {/* Edit mode toggle button */}
      <button
        onClick={() => setEditMode(m => !m)}
        style={{
          position: 'absolute', top: 12, left: 144,
          background: editMode ? 'rgba(100,100,255,0.6)' : 'rgba(30,30,55,0.8)',
          border: '2px solid #3a3a5c', borderRadius: 0,
          padding: '6px 10px', fontSize: 9, cursor: 'pointer',
          color: editMode ? '#fff' : '#aaa', whiteSpace: 'nowrap',
          fontFamily: '"Press Start 2P", cursive',
          boxShadow: 'inset -2px -2px 0 #0a0a1a, inset 2px 2px 0 #2a2a4a',
        }}
      >
        {'🎨 עיצוב משרד'}
      </button>

      {/* Edit mode toolbar */}
      {editMode && (
        <div style={{
          position: 'absolute', top: 52, left: 12,
          background: 'rgba(30,30,55,0.95)', border: '2px solid #3a3a5c',
          borderRadius: 0, padding: '8px 12px', display: 'flex', gap: 8,
          alignItems: 'center', direction: 'rtl',
          fontFamily: '"Press Start 2P", cursive',
          boxShadow: 'inset -2px -2px 0 #0a0a1a, inset 2px 2px 0 #2a2a4a',
        }}>
          <span style={{ color: '#aaf', fontSize: 8, fontWeight: 600 }}>מצב עריכה</span>
          {selectedDecoId !== null && (
            <button
              onClick={() => {
                setDecorations(prev => {
                  const next = prev.filter(d => d._id !== selectedDecoId)
                  saveLayout(next)
                  return next
                })
                setSelectedDecoId(null)
              }}
              style={{
                background: 'rgba(255,80,80,0.3)', border: '2px solid rgba(255,80,80,0.5)',
                borderRadius: 0, padding: '4px 8px', fontSize: 8, cursor: 'pointer', color: '#faa',
                fontFamily: '"Press Start 2P", cursive',
                boxShadow: 'inset -2px -2px 0 #0a0a1a, inset 2px 2px 0 #4a2a2a',
              }}
            >
              {'🗑️ מחק'}
            </button>
          )}
          <button
            onClick={() => {
              const fresh = DEFAULT_DECORATIONS.map(d => ({ ...d, _id: nextDecoId() }))
              setDecorations(fresh)
              saveLayout(fresh)
              setSelectedDecoId(null)
            }}
            style={{
              background: 'rgba(100,100,255,0.2)', border: '2px solid rgba(100,100,255,0.4)',
              borderRadius: 0, padding: '4px 8px', fontSize: 8, cursor: 'pointer', color: '#aaf',
              fontFamily: '"Press Start 2P", cursive',
              boxShadow: 'inset -2px -2px 0 #0a0a1a, inset 2px 2px 0 #2a2a4a',
            }}
          >
            {'🔄 איפוס'}
          </button>
        </div>
      )}

      {/* Edit mode sidebar */}
      {editMode && (
        <div style={{
          position: 'absolute', top: 92, left: 12, width: 180,
          maxHeight: 'calc(100vh - 160px)', overflowY: 'auto',
          background: 'rgba(30,30,55,0.95)', border: '2px solid #3a3a5c',
          borderRadius: 0, padding: 8, direction: 'rtl',
          fontFamily: '"Press Start 2P", cursive',
          boxShadow: 'inset -2px -2px 0 #0a0a1a, inset 2px 2px 0 #2a2a4a',
        }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4,
          }}>
            {AVAILABLE_DECO_TYPES.map(dt => (
              <button
                key={dt.type}
                onClick={() => setPlacementType(prev => prev === dt.type ? null : dt.type)}
                style={{
                  background: placementType === dt.type ? 'rgba(100,100,255,0.4)' : 'rgba(255,255,255,0.05)',
                  border: placementType === dt.type ? '2px solid rgba(100,100,255,0.6)' : '2px solid transparent',
                  borderRadius: 0, padding: '6px 4px', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  color: '#ccc', fontSize: 7, fontFamily: '"Press Start 2P", cursive',
                }}
              >
                <span style={{ fontSize: 18 }}>{dt.emoji}</span>
                <span>{dt.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Dashboard overlay — placeholder until Dana completes */}
      {dashboardMode && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(10,10,30,0.95)',
          display: 'flex', flexWrap: 'wrap', gap: 12, padding: 20,
          alignContent: 'flex-start', overflowY: 'auto',
          fontFamily: '"Press Start 2P", cursive',
        }}>
          {agentDefs.map(a => (
            <div key={a.id} onClick={() => setSelectedId(prev => prev === a.id ? null : a.id)} style={{
              background: selectedId === a.id ? 'rgba(74,106,255,0.3)' : 'rgba(30,30,60,0.8)',
              border: '2px solid #3a3a5c', padding: 12, cursor: 'pointer',
              width: breakpoint === 'compact' || breakpoint === 'mobile' ? '100%' : 'calc(33% - 12px)',
              fontSize: 8,
            }}>
              <div style={{ fontSize: 24, marginBottom: 4 }}>{a.emoji}</div>
              <div style={{ color: '#eee', marginBottom: 4 }}>{a.name}</div>
              <div style={{ color: a.state === 'working' ? '#4f4' : a.state === 'idle' ? '#ff4' : '#888', fontSize: 7 }}>
                {a.state} {a.task ? `— ${a.task}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Bottom status bar — responsive */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        background: 'rgba(20,20,40,0.95)', borderTop: '2px solid #3a3a5c',
        padding: isCompact ? '4px 4px' : isMobile ? '6px 8px' : '8px 16px',
        fontFamily: '"Press Start 2P", cursive',
        boxShadow: 'inset 0 2px 0 #2a2a4a',
        display: 'flex', gap: isCompact ? 2 : isMobile ? 6 : 12,
        justifyContent: isMobile ? 'flex-start' : 'center',
        flexWrap: isMobile ? 'nowrap' : 'wrap',
        overflowX: isMobile ? 'auto' : 'visible',
        WebkitOverflowScrolling: 'touch',
      }}>
        {agentDefs.map(a => (
          <div key={a.id} onClick={() => setSelectedId(s => s === a.id ? null : a.id)} style={{
            display: 'flex', alignItems: 'center', gap: isCompact ? 2 : isMobile ? 3 : 5,
            padding: isCompact ? '3px 3px' : isMobile ? '2px 5px' : '3px 8px',
            borderRadius: 0, cursor: 'pointer', fontSize: isCompact ? 11 : isMobile ? 12 : 13,
            background: selectedId === a.id ? 'rgba(100,100,200,0.3)' : 'transparent',
            whiteSpace: 'nowrap', flexShrink: 0,
            // Minimum touch target 44px height on mobile
            minHeight: isMobile ? 36 : undefined,
          }}>
            <span style={{
              width: isCompact ? 6 : 7, height: isCompact ? 6 : 7, borderRadius: '50%',
              background: STATE_META[a.state].color, display: 'inline-block',
            }} />
            <span style={{ color: '#ccc' }}>
              {isCompact ? a.emoji : `${a.emoji} ${a.name}`}
            </span>
          </div>
        ))}
      </div>

      {/* Detail panel — chat-focused, compact header */}
      {selectedAgent && (
        <div style={{
          position: isMobile ? 'fixed' : 'absolute',
          ...(isMobile ? { bottom: isCompact ? 32 : 40, left: 0, right: 0, height: '50vh' }
            : { top: 10, right: 10, bottom: 10, width: breakpoint === 'tablet' ? 300 : 340 }),
          display: 'flex', flexDirection: 'column',
          background: '#12152a',
          border: `1px solid ${STATE_META[selectedAgent.state].color}44`,
          borderRadius: 12,
          color: '#e0e0e0', direction: 'rtl',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          zIndex: 10, fontFamily: '"Heebo", sans-serif',
          overflow: 'hidden',
        }}>
          {/* Compact header — emoji + name + status + zone + close */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 14px',
            background: 'rgba(255,255,255,0.03)',
            borderBottom: `1px solid ${STATE_META[selectedAgent.state].color}33`,
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 28 }}>{selectedAgent.emoji}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{selectedAgent.name}</span>
                <span style={{
                  fontSize: 10, padding: '2px 6px', borderRadius: 8,
                  background: `${STATE_META[selectedAgent.state].color}22`,
                  color: STATE_META[selectedAgent.state].color,
                }}>
                  {STATE_META[selectedAgent.state].dot} {STATE_META[selectedAgent.state].label}
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#888', display: 'flex', gap: 8, marginTop: 2 }}>
                <span>{getZoneForState(selectedAgent.state) === 'work' ? '💻 עבודה'
                  : getZoneForState(selectedAgent.state) === 'bugs' ? '🐛 באגים' : '☕ מנוחה'}</span>
                {selectedAgent.lastUpdated && <span>🕐 {timeAgo(selectedAgent.lastUpdated)}</span>}
              </div>
            </div>
            <button onClick={() => setSelectedId(null)} style={{
              background: 'none', border: 'none', color: '#888',
              fontSize: 20, cursor: 'pointer', padding: 8,
              minWidth: 40, minHeight: 40,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>✕</button>
          </div>

          {/* Chat takes all remaining space */}
          <ChatInput
            agentId={selectedAgent.id}
            agentColor={STATE_META[selectedAgent.state].color}
            compact={isCompact}
            onSend={handleSendToAgent}
            onFetchHistory={handleFetchHistory}
          />
        </div>
      )}
    </div>
  )
}

function timeAgo(ts: number | undefined): string {
  if (!ts) return 'לא ידוע'
  const diff = Date.now() - ts
  if (diff < 60_000) return 'עכשיו'
  if (diff < 3_600_000) return `לפני ${Math.floor(diff / 60_000)} דקות`
  if (diff < 86_400_000) return `לפני ${Math.floor(diff / 3_600_000)} שעות`
  return `לפני ${Math.floor(diff / 86_400_000)} ימים`
}

function InfoBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 12, marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 4, fontFamily: '"Heebo", sans-serif' }}>{label}</div>
      {children}
    </div>
  )
}

function ExpandableTask({ task, hasRealTask, compact }: {
  task: string
  hasRealTask: boolean
  compact?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const isLong = task.length > 40

  return (
    <InfoBox label="משימה נוכחית">
      <div
        onClick={isLong ? () => setExpanded(e => !e) : undefined}
        style={{
          fontSize: compact ? 12 : 13,
          lineHeight: 1.5,
          color: hasRealTask ? '#eee' : '#666',
          fontFamily: '"Heebo", sans-serif',
          cursor: isLong ? 'pointer' : 'default',
          overflow: expanded ? 'visible' : 'hidden',
          textOverflow: expanded ? 'unset' : 'ellipsis',
          whiteSpace: expanded ? 'normal' : 'nowrap',
          maxWidth: '100%',
          wordBreak: expanded ? 'break-word' : undefined,
          transition: 'all 0.2s ease',
        }}
      >
        {task}
      </div>
      {isLong && (
        <div
          onClick={() => setExpanded(e => !e)}
          style={{
            fontSize: 11,
            color: '#6688cc',
            cursor: 'pointer',
            marginTop: 4,
            userSelect: 'none',
            fontFamily: '"Heebo", sans-serif',
          }}
        >
          {expanded ? '▲ פחות' : '▼ עוד...'}
        </div>
      )}
    </InfoBox>
  )
}

// ── Chat Component (bidirectional) ──

type SendStatus = 'idle' | 'sending' | 'sent' | 'error'

// Module-level chat cache — persists across agent switches and component unmounts
const globalChatCache: Record<string, ChatMessage[]> = {}

/** Source channel icon for chat messages */
function sourceIcon(source?: string): string {
  if (!source) return ''
  const s = source.toLowerCase()
  if (s.includes('discord')) return '💬'
  if (s.includes('telegram')) return '✈️'
  if (s.includes('whatsapp')) return '📱'
  if (s.includes('webchat')) return '🌐'
  if (s.includes('signal')) return '🔒'
  return '📨'
}

/** Markdown renderer: **bold**, *italic*, `code`, ```blocks```, [links](url), # headers, - lists */
function renderMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let key = 0

  // Split into code blocks vs rest
  const blocks = text.split(/(```[\s\S]*?```)/)
  for (const block of blocks) {
    if (!block) continue
    if (block.startsWith('```') && block.endsWith('```')) {
      const code = block.slice(3, -3).replace(/^\w*\n/, '')
      nodes.push(<pre key={key++} style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 6, padding: 8, margin: '4px 0', fontSize: 12, overflowX: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'monospace', direction: 'ltr', textAlign: 'left' }}><code>{code}</code></pre>)
      continue
    }
    // Process line by line for headers and lists
    const lines = block.split('\n')
    let listItems: React.ReactNode[] = []
    let numberedItems: React.ReactNode[] = []
    const flushList = () => {
      if (listItems.length > 0) {
        nodes.push(<ul key={key++} style={{ margin: '4px 0', paddingRight: 16, paddingLeft: 0, listStyle: 'disc' }}>{listItems}</ul>)
        listItems = []
      }
      if (numberedItems.length > 0) {
        nodes.push(<ol key={key++} style={{ margin: '4px 0', paddingRight: 16, paddingLeft: 0 }}>{numberedItems}</ol>)
        numberedItems = []
      }
    }
    for (const line of lines) {
      // Headers
      if (line.match(/^#{1,3}\s/)) {
        flushList()
        const level = line.match(/^(#{1,3})\s/)![1].length
        const hText = line.replace(/^#{1,3}\s/, '')
        const fontSize = level === 1 ? 16 : level === 2 ? 14 : 13
        nodes.push(<div key={key++} style={{ fontSize, fontWeight: 700, margin: '6px 0 2px' }}>{renderInline(hText, key++)}</div>)
        continue
      }
      // Bullet list items
      if (line.match(/^[-*]\s/)) {
        if (numberedItems.length > 0) flushList()
        listItems.push(<li key={key++} style={{ fontSize: 13, lineHeight: 1.5 }}>{renderInline(line.replace(/^[-*]\s/, ''), key++)}</li>)
        continue
      }
      // Numbered list
      if (line.match(/^\d+\.\s/)) {
        if (listItems.length > 0) flushList()
        numberedItems.push(<li key={key++} style={{ fontSize: 13, lineHeight: 1.5 }}>{renderInline(line.replace(/^\d+\.\s/, ''), key++)}</li>)
        continue
      }
      // Normal line
      flushList()
      if (line.trim()) {
        nodes.push(<div key={key++} style={{ lineHeight: 1.5 }}>{renderInline(line, key++)}</div>)
      } else if (nodes.length > 0) {
        // Empty line = line break
        nodes.push(<br key={key++} />)
      }
    }
    flushList()
  }
  return nodes
}

/** Inline markdown: **bold**, *italic*, `code`, [links](url) */
function renderInline(text: string, baseKey: number): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[([^\]]+)\]\(([^)]+)\))/)
  let k = baseKey * 100
  for (const part of parts) {
    if (!part) continue
    if (part.startsWith('`') && part.endsWith('`')) {
      nodes.push(<code key={k++} style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 4px', borderRadius: 3, fontSize: 12, fontFamily: 'monospace' }}>{part.slice(1, -1)}</code>)
    } else if (part.startsWith('**') && part.endsWith('**')) {
      nodes.push(<strong key={k++}>{part.slice(2, -2)}</strong>)
    } else if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) {
      nodes.push(<em key={k++}>{part.slice(1, -1)}</em>)
    } else if (part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)) {
      const m = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)!
      nodes.push(<a key={k++} href={m[2]} target="_blank" rel="noopener" style={{ color: '#64b5f6', textDecoration: 'underline' }}>{m[1]}</a>)
    } else {
      nodes.push(<span key={k++}>{part}</span>)
    }
  }
  return nodes
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
}

function ChatInput({ agentId, agentColor, compact, onSend, onFetchHistory }: {
  agentId: string
  agentColor: string
  compact?: boolean
  onSend?: (agentId: string, message: string) => Promise<void> | void
  onFetchHistory?: (agentId: string, after?: number) => Promise<ChatMessage[]>
}) {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<SendStatus>('idle')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [polling, setPolling] = useState(false)
  const [streamText, setStreamText] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef<ChatMessage[]>(messages)
  messagesRef.current = messages

  // Load history when agent changes
  useEffect(() => {
    setMessages(globalChatCache[agentId] || [])
    setStreamText('')
    if (onFetchHistory) {
      onFetchHistory(agentId).then(history => {
        if (history.length > 0) {
          globalChatCache[agentId] = history
          setMessages(history)
        }
      }).catch(() => {})
    }
  }, [agentId, onFetchHistory])

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, streamText])

  // WebSocket listener for streaming responses from backend watcher
  useEffect(() => {
    const wsBase = window.location.port === '5173'
      ? 'ws://localhost:3001'
      : `ws://${window.location.host}`
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    function connect() {
      ws = new WebSocket(`${wsBase}/ws`)
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'chat:response' && data.data?.agentId === agentId) {
            const msg = data.data.message
            if (msg?.text) {
              const newMsg: ChatMessage = {
                id: msg.id || `ws-${Date.now()}`,
                role: 'assistant',
                text: msg.text.substring(0, 2000),
                ts: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
              }
              setMessages(prev => {
                // Deduplicate
                if (prev.some(m => m.id === newMsg.id || (m.role === 'assistant' && m.text === newMsg.text))) return prev
                const next = [...prev, newMsg]
                globalChatCache[agentId] = next
                return next
              })
              setPolling(false)
            }
          }
          if (data.type === 'chat:timeout' && data.data?.agentId === agentId) {
            setPolling(false)
          }
        } catch { /* ignore */ }
      }
      ws.onclose = () => {
        reconnectTimer = setTimeout(connect, 3000)
      }
      ws.onerror = () => { /* onclose will fire */ }
    }

    connect()

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close()
      }
    }
  }, [agentId])

  // Poll every 5s for new messages
  useEffect(() => {
    if (!onFetchHistory) return
    const interval = setInterval(async () => {
      try {
        const current = messagesRef.current
        const lastTs = current.length > 0 ? current[current.length - 1].ts : undefined
        const history = await onFetchHistory(agentId, lastTs)
        if (history.length > 0) {
          if (lastTs) {
            const existingIds = new Set(current.map(m => m.id))
            const newMsgs = history.filter(m => !existingIds.has(m.id) && m.ts > lastTs)
            if (newMsgs.length > 0) {
              const merged = [...current, ...newMsgs]
              globalChatCache[agentId] = merged
              setMessages(merged)
              if (newMsgs[newMsgs.length - 1]?.role === 'assistant') {
                setPolling(false)
                setStreamText('')
              }
            }
          } else {
            globalChatCache[agentId] = history
            setMessages(history)
            if (history[history.length - 1]?.role === 'assistant') {
              setPolling(false)
              setStreamText('')
            }
          }
        }
      } catch {}
    }, 5000)
    return () => clearInterval(interval)
  }, [agentId, onFetchHistory])

  const handleSend = useCallback(async () => {
    const msg = text.trim()
    if (!msg || status === 'sending') return
    setStatus('sending')
    try {
      await onSend?.(agentId, msg)
      const sentMsg: ChatMessage = { id: `local-${Date.now()}`, role: 'user', text: msg, ts: Date.now() }
      setMessages(prev => { const next = [...prev, sentMsg]; globalChatCache[agentId] = next; return next })
      setText('')
      setStreamText('')
      setStatus('sent')
      setPolling(true)
      setTimeout(() => setStatus('idle'), 1200)
    } catch {
      setStatus('error')
      setTimeout(() => setStatus('idle'), 2000)
    }
  }, [text, status, agentId, onSend])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }, [handleSend])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      flex: 1, minHeight: 0,
      fontFamily: '"Heebo", sans-serif',
      direction: 'rtl',
    }}>
      {/* Messages area */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto', padding: '10px 12px',
        display: 'flex', flexDirection: 'column', gap: 6,
        scrollBehavior: 'smooth',
      }}>
        {messages.length === 0 && !streamText && (
          <div style={{ textAlign: 'center', color: '#555', fontSize: 13, marginTop: 40 }}>
            💬 שלח הודעה להתחיל שיחה
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} style={{
            alignSelf: msg.role === 'user' ? 'flex-start' : 'flex-end',
            maxWidth: '80%',
          }}>
            <div style={{
              padding: '8px 12px',
              borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
              background: msg.role === 'user' ? 'rgba(60, 60, 120, 0.5)' : 'rgba(255,255,255,0.06)',
              border: msg.role === 'assistant' ? `1px solid ${agentColor}33` : '1px solid rgba(80,80,150,0.3)',
              color: '#e0e0e0', fontSize: 13, lineHeight: 1.6, wordBreak: 'break-word',
            }}>
              {renderMarkdown(msg.text)}
            </div>
            <div style={{
              fontSize: 10, color: '#666', marginTop: 2,
              textAlign: msg.role === 'user' ? 'left' : 'right',
              padding: '0 4px', display: 'flex', gap: 3,
              justifyContent: msg.role === 'user' ? 'flex-start' : 'flex-end',
            }}>
              {msg.ts ? formatTime(msg.ts) : ''}
              {msg.role === 'user' && msg.id.startsWith('local-') && ' ✓✓'}
            </div>
          </div>
        ))}
        {/* Streaming message — token by token */}
        {streamText && (
          <div style={{ alignSelf: 'flex-end', maxWidth: '80%' }}>
            <div style={{
              padding: '8px 12px',
              borderRadius: '12px 12px 12px 4px',
              background: 'rgba(255,255,255,0.06)',
              border: `1px solid ${agentColor}33`,
              color: '#e0e0e0', fontSize: 13, lineHeight: 1.6, wordBreak: 'break-word',
            }}>
              {renderMarkdown(streamText)}
              <span style={{ animation: 'chatBlink 1s infinite', color: agentColor }}>▋</span>
            </div>
          </div>
        )}
        {/* Typing indicator */}
        {polling && !streamText && (
          <div style={{
            alignSelf: 'flex-end', maxWidth: '60%',
            padding: '10px 16px', borderRadius: '12px 12px 12px 4px',
            background: 'rgba(255,255,255,0.04)',
            border: `1px solid ${agentColor}22`,
            color: '#888', fontSize: 16, letterSpacing: 2,
          }}>
            <span style={{ display: 'inline-block', animation: 'chatBounce 1.4s infinite' }}>●</span>
            <span style={{ display: 'inline-block', animation: 'chatBounce 1.4s infinite 0.2s' }}>●</span>
            <span style={{ display: 'inline-block', animation: 'chatBounce 1.4s infinite 0.4s' }}>●</span>
          </div>
        )}
      </div>

      {/* Input area */}
      <div style={{
        display: 'flex', gap: 8, padding: '8px 10px',
        background: 'rgba(255,255,255,0.03)',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        alignItems: 'flex-end', flexShrink: 0,
      }}>
        <textarea
          ref={inputRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="הקלד הודעה..."
          disabled={status === 'sending'}
          rows={1}
          style={{
            flex: 1, resize: 'none',
            minHeight: 40, maxHeight: 100,
            padding: '10px 14px',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(255,255,255,0.04)',
            color: '#eee', fontSize: 14,
            fontFamily: '"Heebo", sans-serif',
            outline: 'none', direction: 'rtl',
            lineHeight: 1.4,
          }}
          onInput={e => {
            const el = e.currentTarget
            el.style.height = 'auto'
            el.style.height = Math.min(el.scrollHeight, 100) + 'px'
          }}
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || status === 'sending'}
          style={{
            width: 40, height: 40, borderRadius: 8,
            border: 'none',
            background: text.trim() && status !== 'sending' ? agentColor : 'rgba(255,255,255,0.08)',
            color: '#fff', fontSize: 18,
            cursor: text.trim() && status !== 'sending' ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, transition: 'background 0.2s',
          }}
          title="שלח"
        >
          {status === 'sending' ? (
            <span style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'chatSpin 0.6s linear infinite' }} />
          ) : '◀'}
        </button>
      </div>
    </div>
  )
}
