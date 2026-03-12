import { useRef, useEffect, useState, useCallback } from 'react'

// ── Types ──
type AgentState = 'active' | 'idle' | 'working' | 'offline' | 'error'

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

// Dynamic grid — expands when >12 agents
let MAP_COLS = BASE_MAP_COLS
let MAP_ROWS = BASE_MAP_ROWS

/**
 * Compute grid size based on agent count.
 * Base: 16x12 supports 12 cubicles. Each extra 4 agents adds a row.
 * Work zone starts at col 4, so effective cubicle cols = (MAP_COLS - 5) / 2
 */
function computeGridSize(agentCount: number) {
  if (agentCount <= 12) {
    MAP_COLS = BASE_MAP_COLS
    MAP_ROWS = BASE_MAP_ROWS
    return
  }
  // Expanded spacing: 3-tile horizontal, 4-tile vertical per cubicle
  const cubicleColSlots = 4
  const rowsNeeded = Math.ceil(agentCount / cubicleColSlots)
  const workRows = rowsNeeded * 4 + 2
  MAP_ROWS = Math.max(BASE_MAP_ROWS, workRows)
  MAP_COLS = Math.max(BASE_MAP_COLS, 5 + cubicleColSlots * 3 + 1)
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
  const bugStartCol = Math.max(10, MAP_COLS - 6)
  const bugStartRow = Math.max(8, MAP_ROWS - 4)
  if (col >= bugStartCol && row >= bugStartRow) return 'bugs'
  if (col <= 3) return 'lounge'
  return 'work'
}

// ── Tilemap — dynamically generated ──
// 0 = wood floor, 1 = stone floor, 2 = carpet, 3 = dark floor (bug zone)

/** Generate floor map for current MAP_COLS × MAP_ROWS */
function generateFloorMap(): number[][] {
  const map: number[][] = []
  const bugStartCol = Math.max(10, MAP_COLS - 6)
  const bugStartRow = Math.max(8, MAP_ROWS - 4)
  for (let row = 0; row < MAP_ROWS; row++) {
    const r: number[] = []
    for (let col = 0; col < MAP_COLS; col++) {
      if (col >= bugStartCol && row >= bugStartRow) {
        r.push(3) // bug zone
      } else if (col <= 3) {
        r.push(2) // lounge carpet
      } else {
        r.push(0) // work zone wood
      }
    }
    map.push(r)
  }
  return map
}

let FLOOR_MAP = generateFloorMap()

// Floor tile colors (2 shades each for checkerboard pattern)
const FLOOR_STYLES: Record<number, [string, string]> = {
  0: ['#2a1f14', '#332618'],  // wood (work zone)
  1: ['#1a3040', '#1e3848'],  // stone
  2: ['#3a2820', '#422e24'],  // carpet (lounge)
  3: ['#3a1a1a', '#421e1e'],  // dark red (bug zone)
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
    { col: 0, row: -1, type: 'corner_tl' },
    ...Array.from({ length: MAP_COLS - 1 }, (_, i) => ({
      col: i + 1, row: -1,
      type: (i % 5 === 3) ? 'window' as const : 'top' as const,
    })),
    { col: MAP_COLS, row: -1, type: 'corner_tr' },
    // Left wall
    ...Array.from({ length: MAP_ROWS }, (_, i) => ({
      col: -1, row: i,
      type: (i % 5 === 2) ? 'window' as const : 'left' as const,
    })),
    // Zone divider: lounge | work
    ...Array.from({ length: MAP_ROWS }, (_, i) => ({
      col: 3.5, row: i,
      type: 'left' as const,
    })),
  ]
  return walls
}

let WALLS = generateWalls()

// ── Cubicle positions — generated dynamically based on agent count ──
function generateCubiclePositions(count: number): [number, number][] {
  const cols = Math.min(4, count)
  const rows = Math.ceil(count / cols)
  const positions: [number, number][] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols && positions.length < count; c++) {
      // 3-tile horizontal spacing, 4-tile vertical spacing — no overlap
      positions.push([5 + c * 3, 1 + r * 4])
    }
  }
  return positions
}

// Default 12 cubicles (overridden when agents are discovered)
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
  [1, 2], [1, 6], [2, 10], [3, 14],
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
  // Plants around the office
  { type: 'plant_large', col: 0, row: 11, scale: 1.2 },
  { type: 'plant_small', col: 3, row: 0, scale: 1 },
  { type: 'plant_large', col: 9, row: 0, scale: 1.2 },
  { type: 'plant_small', col: 15, row: 0, scale: 1 },
  { type: 'plant_small', col: 3, row: 11, scale: 1 },

  // Whiteboard in work zone
  { type: 'whiteboard', col: 4, row: 0, scale: 1.5 },

  // Kanban board
  { type: 'kanban_board', col: 7, row: 0, scale: 1.3 },

  // Water cooler
  { type: 'water_cooler', col: 9, row: 7, scale: 1.2 },

  // Printer
  { type: 'printer', col: 9, row: 4, scale: 1.1 },

  // Bookshelf in lounge
  { type: 'bookshelf', col: 0, row: 3, scale: 1.3 },

  // Motivational signs
  { type: 'motivation_sign', col: 1, row: 0, scale: 1.2 },

  // Trophy in lounge (team achievements)
  { type: 'trophy', col: 2, row: 0, scale: 1 },

  // Bug zone decorations
  { type: 'alert_light', col: 10, row: 8, scale: 1.2 },
  { type: 'alert_light', col: 15, row: 8, scale: 1.2 },
  { type: 'monitor_wall', col: 14, row: 8, scale: 1.5 },
  { type: 'server_rack_mini', col: 10, row: 11, scale: 1.3 },

  // Team photo & picture frames in lounge
  { type: 'team_photo', col: 0, row: 6, scale: 1.2 },
  { type: 'picture_frame', col: 0, row: 9, scale: 1 },

  // Desk decorations per cubicle area
  { type: 'mug', col: 6, row: 1, scale: 0.8 },
  { type: 'keyboard', col: 5, row: 4, scale: 0.8 },
  { type: 'mouse', col: 7, row: 4, scale: 0.7 },
  { type: 'stickers', col: 9, row: 1, scale: 0.8 },
  { type: 'wireframes', col: 7, row: 7, scale: 1 },
  { type: 'candle', col: 11, row: 1, scale: 0.8 },
  { type: 'phone', col: 5, row: 7, scale: 0.8 },
  { type: 'tea_cup', col: 11, row: 4, scale: 0.8 },
  { type: 'laptop', col: 9, row: 7, scale: 0.9 },
]

// ── Decoration persistence ──
function loadLayout(): DecorationWithId[] {
  try {
    const saved = localStorage.getItem('office-layout')
    if (saved) {
      const parsed = JSON.parse(saved) as Decoration[]
      return parsed.map(d => ({ ...d, _id: nextDecoId() }))
    }
  } catch { /* ignore */ }
  return DEFAULT_DECORATIONS.map(d => ({ ...d, _id: nextDecoId() }))
}

function saveLayout(decos: DecorationWithId[]) {
  const clean = decos.map(({ _id, ...rest }) => rest)
  localStorage.setItem('office-layout', JSON.stringify(clean))
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
const KNOWN_AGENTS: Record<string, { name: string; role: string; emoji: string; color: string; frames: number }> = {
  yogi:   { name: 'יוגי',   role: 'COO',              emoji: '🐻', color: '#8B4513', frames: 8 },
  omer:   { name: 'עומר',   role: 'Tech Lead',        emoji: '👨‍💻', color: '#2196F3', frames: 8 },
  noa:    { name: 'נועה',   role: 'Frontend/UX',      emoji: '🎨', color: '#E91E63', frames: 8 },
  itai:   { name: 'איתי',   role: 'Backend/API',      emoji: '🗄️', color: '#4CAF50', frames: 8 },
  gil:    { name: 'גיל',    role: 'DevOps',           emoji: '⚙️', color: '#FF9800', frames: 8 },
  michal: { name: 'מיכל',   role: 'QA Lead',          emoji: '🔍', color: '#009688', frames: 8 },
  amir:   { name: 'אמיר',   role: 'Game Artist',      emoji: '🎮', color: '#FF5722', frames: 8 },
  roni:   { name: 'רוני',   role: 'Product Manager',  emoji: '📋', color: '#9C27B0', frames: 6 },
  dana:   { name: 'דנה',    role: 'HR',               emoji: '💜', color: '#E040FB', frames: 6 },
  lior:   { name: 'ליאור',  role: 'Marketing',        emoji: '📈', color: '#00BCD4', frames: 6 },
  tomer:  { name: 'תומר',   role: 'Sales',            emoji: '💼', color: '#795548', frames: 6 },
  alon:   { name: 'אלון',   role: 'Senior Dev',       emoji: '🧑‍💻', color: '#607D8B', frames: 6 },
  main:   { name: 'Main',   role: 'Main Agent',       emoji: '🏠', color: '#78909C', frames: 6 },
}

// Fallback colors for unknown agents (cycled)
const FALLBACK_COLORS = [
  '#E91E63', '#9C27B0', '#673AB7', '#3F51B5', '#2196F3', '#00BCD4',
  '#009688', '#4CAF50', '#8BC34A', '#FF9800', '#FF5722', '#795548',
]

// Build AgentDef from a session key (e.g. "agent:yogi:discord:channel:123")
function agentDefFromSession(sessionKey: string, index: number, updatedAt: number, aborted: boolean, lastMsg?: string): AgentDef {
  const match = sessionKey.match(/^agent:([^:]+)/)
  const id = match ? match[1] : sessionKey
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
  }
}

// ── Default demo agents (used when no Gateway token) ──
const _now = Date.now()
const DEFAULT_AGENT_DEFS: AgentDef[] = [
  { id: 'yogi',   ...KNOWN_AGENTS.yogi,   state: 'active',  task: 'מנהל את הצוות', cubicleIndex: 0,  lastUpdated: _now - 15_000 },
  { id: 'omer',   ...KNOWN_AGENTS.omer,   state: 'working', task: 'בונה Virtual Office', cubicleIndex: 1,  lastUpdated: _now - 5_000 },
  { id: 'noa',    ...KNOWN_AGENTS.noa,    state: 'working', task: 'עיצוב isometric layout', cubicleIndex: 2,  lastUpdated: _now - 20_000 },
  { id: 'itai',   ...KNOWN_AGENTS.itai,   state: 'idle',    task: 'backend architecture', cubicleIndex: 3,  lastUpdated: _now - 180_000 },
  { id: 'gil',    ...KNOWN_AGENTS.gil,    state: 'offline', task: 'dev setup plan', cubicleIndex: 4,  lastUpdated: _now - 3_600_000 },
  { id: 'michal', ...KNOWN_AGENTS.michal, state: 'working', task: 'בדיקות QA', cubicleIndex: 5,  lastUpdated: _now - 10_000 },
  { id: 'amir',   ...KNOWN_AGENTS.amir,   state: 'working', task: 'יצירת sprites', cubicleIndex: 6,  lastUpdated: _now - 8_000 },
  { id: 'roni',   ...KNOWN_AGENTS.roni,   state: 'idle',    task: 'ניהול roadmap', cubicleIndex: 7,  lastUpdated: _now - 240_000 },
  { id: 'dana',   ...KNOWN_AGENTS.dana,   state: 'idle',    task: 'משאבי אנוש', cubicleIndex: 8,  lastUpdated: _now - 300_000 },
  { id: 'lior',   ...KNOWN_AGENTS.lior,   state: 'idle',    task: 'שיווק ותוכן', cubicleIndex: 9,  lastUpdated: _now - 600_000 },
  { id: 'tomer',  ...KNOWN_AGENTS.tomer,  state: 'error',   task: 'מכירות CRM', cubicleIndex: 10, lastUpdated: _now - 45_000 },
  { id: 'alon',   ...KNOWN_AGENTS.alon,   state: 'working', task: 'full-stack dev', cubicleIndex: 11, lastUpdated: _now - 12_000 },
]

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

// ── Lounge spots (12+ unique positions spread across cols 0-3, rows 0-11) ──
// Spots spaced ≥3 tiles apart — generous spacing for larger map (20×16)
const LOUNGE_SPOTS: [number, number][] = [
  [0, 1], [3, 1], [0, 4], [3, 4], [0, 7], [3, 7],
  [0, 10], [3, 10], [1, 13], [3, 13], [0, 15], [3, 15],
]

// ── Bug zone spots (5 unique positions) ──
// Bug zone spots — spaced out in the larger map
const BUG_SPOTS: [number, number][] = [
  [15, 13], [18, 13], [15, 15], [18, 15], [17, 14],
]

// Track which lounge/bug spots are taken (by agent id)
const loungeAssignments: Map<string, number> = new Map()
const bugAssignments: Map<string, number> = new Map()

function assignSpot(agentId: string, spots: [number, number][], assignments: Map<string, number>): [number, number] {
  // If agent already has a spot, keep it
  const existing = assignments.get(agentId)
  if (existing !== undefined) return spots[existing]

  // Find first unoccupied spot
  const taken = new Set(assignments.values())
  for (let i = 0; i < spots.length; i++) {
    if (!taken.has(i)) {
      assignments.set(agentId, i)
      return spots[i]
    }
  }
  // All spots taken — offset slightly from last spot
  const fallbackIdx = assignments.size % spots.length
  assignments.set(agentId, fallbackIdx)
  const [bx, by] = spots[fallbackIdx]
  return [bx + 0.5, by + 0.5]
}

function releaseSpot(agentId: string) {
  loungeAssignments.delete(agentId)
  bugAssignments.delete(agentId)
}

function getTargetTile(agent: AgentDef): [number, number] {
  const zone = getZoneForState(agent.state)
  if (zone === 'work') {
    // Always return the agent's FIXED cubicle
    releaseSpot(agent.id) // free any lounge/bug spot
    return CUBICLE_POSITIONS[agent.cubicleIndex]
  }
  if (zone === 'bugs') {
    loungeAssignments.delete(agent.id) // free lounge if was there
    return assignSpot(agent.id, BUG_SPOTS, bugAssignments)
  }
  // lounge (idle / offline)
  bugAssignments.delete(agent.id) // free bug zone if was there
  return assignSpot(agent.id, LOUNGE_SPOTS, loungeAssignments)
}

function buildAgents(defs: AgentDef[]): AgentRuntime[] {
  // Expand grid if needed
  computeGridSize(defs.length)
  FLOOR_MAP = generateFloorMap()
  WALLS = generateWalls()
  BUG_WORKSTATIONS = generateBugWorkstations()
  // Update cubicle positions for the actual count
  CUBICLE_POSITIONS = generateCubiclePositions(defs.length)
  // Reset spot assignments
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

function loadSpritesForAgents(defs: AgentDef[]) {
  loadGenericSprites()
  defs.forEach(agent => {
    if (spriteImages[agent.id]) return // already loaded
    const img = new Image()
    img.src = `/assets/characters/${agent.id}-idle.png`
    spriteImages[agent.id] = img
  })
}

/** Get the best available sprite for an agent: own sprite > generic (by hash) */
function getSpriteForAgent(agentId: string): HTMLImageElement | null {
  const own = spriteImages[agentId]
  if (own?.complete && own.naturalWidth > 0) return own
  // Fallback to generic sprite (deterministic by id hash)
  const idx = hashAgentId(agentId)
  const generic = genericSpriteImages[idx]
  if (generic?.complete && generic.naturalWidth > 0) return generic
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
  if (isOffline) ctx.globalAlpha = 0.4

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

  const breathOffset = isOffline ? 0 : Math.sin(t * 2 + agent.x * 2 + agent.y * 3) * 1.5

  const img = getSpriteForAgent(agent.def.id)
  if (img) {
    // Sprite rendering from spritesheet (own or generic)
    const fps = (agent.def.state === 'working' || agent.def.state === 'active') ? 8 : 4
    const frame = Math.floor(t * fps) % agent.def.frames
    const srcX = frame * SPRITE_SIZE

    // Math.round prevents sub-pixel blur on pixel art
    const drawX = Math.round(sx - SPRITE_DISPLAY / 2)
    const drawY = Math.round(sy - SPRITE_DISPLAY + 8 + breathOffset)

    ctx.imageSmoothingEnabled = false
    ctx.drawImage(
      img,
      srcX, 0, SPRITE_SIZE, SPRITE_SIZE,
      drawX, drawY, SPRITE_DISPLAY, SPRITE_DISPLAY,
    )
    ctx.imageSmoothingEnabled = true
  } else {
    // Last resort fallback (should rarely happen — only before images load)
    const cy = Math.round(sy - 20 + breathOffset)
    ctx.beginPath()
    ctx.arc(sx, cy, 14, 0, Math.PI * 2)
    ctx.fillStyle = agent.def.color
    ctx.fill()
    ctx.strokeStyle = darken(agent.def.color, 40)
    ctx.lineWidth = 2
    ctx.stroke()

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

  // Name label
  ctx.font = 'bold 11px "Segoe UI", Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = isOffline ? '#666' : '#eee'
  ctx.fillText(agent.def.name, Math.round(sx), Math.round(sy + 18 + breathOffset))

  // Status dot
  ctx.beginPath()
  ctx.arc(Math.round(sx + 16), Math.round(sy - SPRITE_DISPLAY + 16 + breathOffset), 4, 0, Math.PI * 2)
  ctx.fillStyle = STATE_META[agent.def.state].color
  ctx.fill()

  // Working indicator — small animation dots
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
  ctx.font = `bold ${f.title}px "Segoe UI", sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText('🏢 Tal Amar — Virtual Office', w / 2, 28)

  // Zone labels — positioned relative to dynamic grid
  ctx.font = `${f.zone}px "Segoe UI", sans-serif`
  ctx.fillStyle = 'rgba(255,255,255,0.25)'
  const [lx, ly] = toIso(1.5, Math.min(5.5, MAP_ROWS / 2))
  ctx.fillText('☕ Lounge', ox + lx, oy + ly - 30)
  const [wx, wy] = toIso(Math.min(8, (4 + MAP_COLS) / 2), Math.min(4, MAP_ROWS / 3))
  ctx.fillText('💻 Work Zone', ox + wx, oy + wy - 30)
  const bugStartCol = Math.max(10, MAP_COLS - 6)
  const bugStartRow = Math.max(8, MAP_ROWS - 4)
  const [bx, by] = toIso(bugStartCol + 2.5, bugStartRow + 1)
  ctx.fillText('🐛 Bug Zone', ox + bx, oy + by - 30)

  // --- Floor tilemap ---
  for (let row = 0; row < MAP_ROWS; row++) {
    for (let col = 0; col < MAP_COLS; col++) {
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

  // Furniture
  for (const [sc, sr] of SOFA_POSITIONS) {
    drawables.push({ sortY: sc + sr, draw: () => drawSofa(ctx, ox, oy, sc, sr) })
  }
  drawables.push({ sortY: COFFEE_TABLE[0] + COFFEE_TABLE[1], draw: () => drawCoffeeTable(ctx, ox, oy, COFFEE_TABLE[0], COFFEE_TABLE[1]) })
  drawables.push({ sortY: COFFEE_MACHINE[0] + COFFEE_MACHINE[1], draw: () => drawCoffeeMachine(ctx, ox, oy, COFFEE_MACHINE[0], COFFEE_MACHINE[1]) })

  for (let i = 0; i < CUBICLE_POSITIONS.length; i++) {
    const [cc, cr] = CUBICLE_POSITIONS[i]
    const owner = (allAgentDefs ?? DEFAULT_AGENT_DEFS).find(a => a.cubicleIndex === i)
    drawables.push({ sortY: cc + cr, draw: () => {
      drawIsoDeskAt(ctx, ox, oy, cc, cr, '#00E676')
      // Draw cubicle name tag
      if (owner) {
        const [ix, iy] = toIso(cc, cr)
        const sx = ox + ix
        const sy = oy + iy
        ctx.font = '9px "Segoe UI", sans-serif'
        ctx.textAlign = 'center'
        const isAtDesk = getZoneForState(owner.state) === 'work'
        ctx.fillStyle = isAtDesk ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.35)'
        const label = isAtDesk ? owner.emoji + ' ' + owner.name : owner.emoji + ' ' + owner.name + ' (ריק)'
        ctx.fillText(label, sx, sy + 32)
      }
    }})
  }
  for (const [bc, br] of BUG_WORKSTATIONS) {
    drawables.push({ sortY: bc + br, draw: () => drawIsoDeskAt(ctx, ox, oy, bc, br, '#f44336') })
  }
  drawables.push({ sortY: 14 + 10, draw: () => drawWarningSign(ctx, ox, oy, 14, 10) })

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

  // Agents
  for (const agent of agents) {
    drawables.push({
      sortY: agent.x + agent.y,
      draw: () => drawAgent(ctx, ox, oy, agent, t, hoverAgentId === agent.def.id, selectedAgentId === agent.def.id),
    })
  }

  // Sort by depth
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
    ctx.font = `bold ${f.title}px "Segoe UI", sans-serif`
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
    width: '100%', padding: '10px 12px', borderRadius: 8,
    border: '1px solid #3a3a5c', background: '#16162b', color: '#eee',
    fontSize: 14, outline: 'none', boxSizing: 'border-box', direction: 'ltr',
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 13, color: '#999', marginBottom: 6, display: 'block', direction: 'rtl',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#1a1a2e',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }}>
      <div style={{
        background: '#22223a', borderRadius: 16, padding: 32, width: 380, maxWidth: '90vw',
        border: '1px solid #3a3a5c', boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
      }}>
        <h1 style={{
          fontSize: 24, color: '#eee', textAlign: 'center', margin: '0 0 8px',
          fontWeight: 600,
        }}>
          🏢 Virtual Office — Setup
        </h1>
        <p style={{ fontSize: 13, color: '#777', textAlign: 'center', margin: '0 0 24px' }}>
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
            width: '100%', padding: '12px 0', borderRadius: 8,
            background: token.trim() ? '#4a5aff' : '#333', color: '#fff',
            border: 'none', fontSize: 15, fontWeight: 600, cursor: token.trim() ? 'pointer' : 'default',
            marginBottom: 12, opacity: token.trim() ? 1 : 0.5,
          }}
        >
          התחבר
        </button>

        <div style={{ textAlign: 'center' }}>
          <button
            onClick={onDemo}
            style={{
              background: 'none', border: 'none', color: '#7a7aff',
              fontSize: 13, cursor: 'pointer', textDecoration: 'underline',
            }}
          >
            סביבת דמו
          </button>
        </div>
      </div>
    </div>
  )
}

// ── React App ──
export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoverAgentId, setHoverAgentId] = useState<string | null>(null)
  const [agentDefs, setAgentDefs] = useState<AgentDef[]>(DEFAULT_AGENT_DEFS)
  const agentDefsRef = useRef<AgentDef[]>(agentDefs)
  agentDefsRef.current = agentDefs
  const agentsRef = useRef<AgentRuntime[]>(buildAgents(DEFAULT_AGENT_DEFS))
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
  // Settings state
  const [showSettings, setShowSettings] = useState(() => !localStorage.getItem('gateway-token'))
  const [gatewayToken, setGatewayToken] = useState(() => localStorage.getItem('gateway-token') || '')
  const [gatewayUrl, setGatewayUrl] = useState(() => localStorage.getItem('gateway-url') || 'http://127.0.0.1:18789')

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
          body: JSON.stringify({ activeMinutes: 120, messageLimit: 1 }),
        })
        if (!res.ok) return
        const data = await res.json()
        const sessions: any[] = data.sessions ?? []
        if (sessions.length === 0) return

        // Group sessions by agent, keeping the most recent per agent
        const agentSessions = new Map<string, any>()
        for (const session of sessions) {
          const keyParts = (session.key || '').split(':')
          const rawId = keyParts[1] || 'unknown'
          const agentId = rawId === 'main' ? 'yogi' : rawId
          const existing = agentSessions.get(agentId)
          if (!existing || (session.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
            agentSessions.set(agentId, session)
          }
        }

        const sessionEntries: [string, any][] = Array.from(agentSessions.entries())

        // First poll: discover agents and rebuild
        if (!discoveredRef.current && sessionEntries.length > 0) {
          discoveredRef.current = true
          const newDefs: AgentDef[] = sessionEntries.map(([id, s], i) => {
            const updatedAt = new Date(s.updatedAt).getTime()
            const preview = s.messages?.[0]?.preview?.substring(0, 100) ?? ''
            return agentDefFromSession(s.key, i, updatedAt, !!s.abortedLastRun, preview)
          })
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
            const preview = s.messages?.[0]?.preview?.substring(0, 100) ?? ''
            const def = agentDefFromSession(s.key, existing?.cubicleIndex ?? i, updatedAt, !!s.abortedLastRun, preview)
            if (existing) { def.task = preview || existing.task }
            return def
          })
          setAgentDefs(newDefs)
          loadSpritesForAgents(newDefs)
          agentsRef.current = buildAgents(newDefs)
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

          let newState: AgentState
          if (session.abortedLastRun) {
            newState = 'error'
          } else if (elapsed < 30_000) {
            const lastMsg = session.messages?.[0]
            newState = lastMsg?.toolCalls?.length > 0 ? 'working' : 'active'
          } else if (elapsed < 300_000) {
            newState = 'idle'
          } else {
            newState = 'offline'
          }

          if (newState !== a.def.state) {
            a.def.state = newState
            a.zone = getZoneForState(newState)
            const [tx, ty] = getTargetTile(a.def)
            a.tx = tx
            a.ty = ty
            defsChanged = true
          }

          const newTask = session.messages?.[0]?.preview?.substring(0, 100) ?? ''
          if (newTask && newTask !== a.def.task) {
            a.def.task = newTask
            defsChanged = true
          }
          if (updatedAt !== a.def.lastUpdated) {
            a.def.lastUpdated = updatedAt
            defsChanged = true
          }
        }
        // Sync React state so detail panel re-renders with updated task/state
        if (defsChanged) {
          setAgentDefs(agentRuntimes.map(a => ({ ...a.def })))
        }
      } catch {
        // Gateway not available, keep static/demo data
      }
    }

    pollGateway()
    // Fast polling (2s) — change detection inside prevents unnecessary re-renders
    const timer = setInterval(pollGateway, 2000)
    return () => clearInterval(timer)
  }, [gatewayToken, gatewayUrl])

  // ── Animation loop (DPR-aware) ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    function frame() {
      const dpr = window.devicePixelRatio || 1
      const w = window.innerWidth
      const h = window.innerHeight
      viewportRef.current = { w, h }

      // DPR-aware canvas sizing — only resize when dimensions change (avoids flickering)
      const targetW = w * dpr
      const targetH = h * dpr
      if (canvas!.width !== targetW || canvas!.height !== targetH) {
        canvas!.width = targetW
        canvas!.height = targetH
        canvas!.style.width = w + 'px'
        canvas!.style.height = h + 'px'
      }

      // Clear canvas (no longer reset via width/height every frame)
      ctx.clearRect(0, 0, canvas!.width, canvas!.height)

      const t = performance.now() / 1000

      // Lerp agents toward targets
      const agents = agentsRef.current
      for (const a of agents) {
        const dx = a.tx - a.x
        const dy = a.ty - a.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist > 0.01) {
          a.x += dx * 0.03
          a.y += dy * 0.03
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

      // Apply DPR + scale around center of viewport
      ctx.save()
      ctx.scale(dpr, dpr)
      ctx.translate(w / 2, h / 2)
      ctx.scale(scale, scale)
      ctx.translate(-w / 2, -h / 2)

      const fonts = getCanvasFontSizes(getBreakpoint(w))
      const editState: EditState = {
        active: editModeRef.current,
        selectedDecoId: selectedDecoIdRef.current,
        draggingDecoId: dragRef.current?.decoId ?? null,
        placementPreview: placementTypeRef.current && hoverTileRef.current
          ? { type: placementTypeRef.current, col: hoverTileRef.current[0], row: hoverTileRef.current[1] }
          : null,
      }
      drawScene(ctx, w, h, t, agents, hoverAgentId, selectedId, panRef.current.x, panRef.current.y, fonts, decorationsRef.current, editState, agentDefsRef.current)

      ctx.restore()

      if (!canvasReady) setCanvasReady(true)
      animRef.current = requestAnimationFrame(frame)
    }

    animRef.current = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(animRef.current)
  }, [hoverAgentId, selectedId, editMode, showSettings])

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

  // Send message to agent via Gateway proxy
  const handleSendToAgent = useCallback(async (agentId: string, message: string) => {
    const agent = agentDefsRef.current.find(a => a.id === agentId)
    const sessionKey = agent?.sessionKey
    if (!sessionKey) {
      throw new Error('No session key for agent')
    }

    const backendBase = 'http://' + window.location.hostname + ':3001'

    const res = await fetch(`${backendBase}/api/proxy/send`, {
      method: 'POST',
      headers: {
        'X-Gateway-Token': gatewayToken,
        'X-Gateway-URL': gatewayUrl,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionKey, message }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `Gateway error: ${res.status}`)
    }
  }, [gatewayToken, gatewayUrl])

  const selectedAgent = agentDefs.find(a => a.id === selectedId) ?? null

    // Show settings screen
  if (showSettings) {
    return <SettingsScreen onConnect={handleConnect} onDemo={handleDemo} />
  }

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      {/* Loading overlay */}
      {!canvasReady && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 50,
          background: '#1a1a2e', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 16,
        }}>
          <div style={{ fontSize: 48 }}>🏢</div>
          <div style={{ color: '#7a7aaa', fontSize: 16 }}>טוען משרד...</div>
          <div style={{
            width: 120, height: 4, background: '#2a2a4a', borderRadius: 2, overflow: 'hidden',
          }}>
            <div style={{
              width: '60%', height: '100%', background: '#4a6aff', borderRadius: 2,
              animation: 'loading 1.5s ease-in-out infinite',
            }} />
          </div>
          <style>{`@keyframes loading { 0%{width:20%;margin-left:0} 50%{width:60%;margin-left:20%} 100%{width:20%;margin-left:80%} }`}</style>
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
        style={{ display: 'block', touchAction: 'none' }}
      />

      {/* Settings gear icon */}
      <button
        onClick={() => setShowSettings(true)}
        style={{
          position: 'absolute', top: 12, left: 12,
          background: 'rgba(30,30,55,0.8)', border: '1px solid #3a3a5c',
          borderRadius: 8, width: 36, height: 36, fontSize: 18,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#aaa',
        }}
        title="הגדרות"
      >
        ⚙️
      </button>

      {/* Edit mode toggle button */}
      <button
        onClick={() => setEditMode(m => !m)}
        style={{
          position: 'absolute', top: 12, left: 56,
          background: editMode ? 'rgba(100,100,255,0.6)' : 'rgba(30,30,55,0.8)',
          border: '1px solid #3a3a5c', borderRadius: 8,
          padding: '6px 10px', fontSize: 13, cursor: 'pointer',
          color: editMode ? '#fff' : '#aaa', whiteSpace: 'nowrap',
        }}
      >
        {'🎨 עיצוב משרד'}
      </button>

      {/* Edit mode toolbar */}
      {editMode && (
        <div style={{
          position: 'absolute', top: 52, left: 12,
          background: 'rgba(30,30,55,0.95)', border: '1px solid #3a3a5c',
          borderRadius: 8, padding: '8px 12px', display: 'flex', gap: 8,
          alignItems: 'center', direction: 'rtl',
        }}>
          <span style={{ color: '#aaf', fontSize: 12, fontWeight: 600 }}>מצב עריכה</span>
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
                background: 'rgba(255,80,80,0.3)', border: '1px solid rgba(255,80,80,0.5)',
                borderRadius: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer', color: '#faa',
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
              background: 'rgba(100,100,255,0.2)', border: '1px solid rgba(100,100,255,0.4)',
              borderRadius: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer', color: '#aaf',
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
          background: 'rgba(30,30,55,0.95)', border: '1px solid #3a3a5c',
          borderRadius: 8, padding: 8, direction: 'rtl',
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
                  border: placementType === dt.type ? '1px solid rgba(100,100,255,0.6)' : '1px solid transparent',
                  borderRadius: 6, padding: '6px 4px', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  color: '#ccc', fontSize: 10,
                }}
              >
                <span style={{ fontSize: 18 }}>{dt.emoji}</span>
                <span>{dt.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bottom status bar — responsive */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        background: 'rgba(20,20,40,0.92)', borderTop: '1px solid #3a3a5c',
        padding: isCompact ? '4px 4px' : isMobile ? '6px 8px' : '8px 16px',
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
            borderRadius: 6, cursor: 'pointer', fontSize: isCompact ? 10 : isMobile ? 11 : 12,
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

      {/* Detail panel — responsive: bottom sheet (mobile) / side panel (desktop) */}
      {selectedAgent && (
        <div style={isMobile ? {
          position: 'fixed',
          bottom: isCompact ? 32 : 40,
          left: 8, right: 8,
          maxHeight: isCompact ? '45vh' : '50vh',
          overflowY: 'auto',
          background: 'rgba(25,25,50,0.97)',
          border: `2px solid ${STATE_META[selectedAgent.state].color}`,
          borderRadius: 12,
          padding: isCompact ? 14 : 20,
          color: '#eee', direction: 'rtl',
          boxShadow: '0 -8px 32px rgba(0,0,0,0.5)', zIndex: 10,
        } : {
          position: 'absolute', top: 20, right: 20,
          width: breakpoint === 'tablet' ? 260 : 280,
          background: 'rgba(25,25,50,0.95)',
          border: `2px solid ${STATE_META[selectedAgent.state].color}`,
          borderRadius: 12, padding: 20, color: '#eee', direction: 'rtl',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          <button onClick={() => setSelectedId(null)} style={{
            position: 'absolute', top: 8, left: 8, background: 'none',
            border: 'none', color: '#888', fontSize: isMobile ? 24 : 18, cursor: 'pointer',
            padding: isMobile ? 8 : 0,
            // Accessible touch target
            minWidth: isMobile ? 44 : undefined,
            minHeight: isMobile ? 44 : undefined,
          }}>✕</button>

          {isCompact ? (
            // Compact layout — horizontal header
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <span style={{ fontSize: 32 }}>{selectedAgent.emoji}</span>
              <div>
                <h2 style={{ fontSize: 16, margin: 0, fontWeight: 600 }}>{selectedAgent.name}</h2>
                <p style={{ fontSize: 11, color: '#999', margin: 0 }}>{selectedAgent.role}</p>
              </div>
              <span style={{
                marginRight: 'auto', color: STATE_META[selectedAgent.state].color, fontWeight: 600, fontSize: 12,
              }}>
                {STATE_META[selectedAgent.state].dot} {STATE_META[selectedAgent.state].label}
              </span>
            </div>
          ) : (
            <>
              <div style={{ fontSize: isMobile ? 48 : 40, textAlign: 'center', marginBottom: 8 }}>{selectedAgent.emoji}</div>
              <h2 style={{ fontSize: isMobile ? 20 : 18, textAlign: 'center', margin: '0 0 4px', fontWeight: 600 }}>{selectedAgent.name}</h2>
              <p style={{ fontSize: isMobile ? 14 : 12, color: '#999', textAlign: 'center', marginBottom: 16 }}>{selectedAgent.role}</p>

              <InfoBox label="סטטוס">
                <span style={{ color: STATE_META[selectedAgent.state].color, fontWeight: 600 }}>
                  {STATE_META[selectedAgent.state].dot} {STATE_META[selectedAgent.state].label}
                </span>
              </InfoBox>
            </>
          )}

          <InfoBox label="משימה נוכחית">
            <span style={{ fontSize: isCompact ? 12 : 13, lineHeight: 1.5, color: selectedAgent.task ? undefined : '#666' }}>
              {selectedAgent.task || (selectedAgent.state === 'offline' ? '💤 לא מחובר' : '⏳ ממתין למשימה')}
            </span>
          </InfoBox>

          {selectedAgent.lastUpdated && (
            <InfoBox label="עדכון אחרון">
              <span style={{ fontSize: isCompact ? 12 : 13, color: '#aaa' }}>
                🕐 {timeAgo(selectedAgent.lastUpdated)}
              </span>
            </InfoBox>
          )}

          <InfoBox label="אזור">
            <span style={{ fontSize: isCompact ? 12 : 13 }}>
              {getZoneForState(selectedAgent.state) === 'work' ? '💻 Work Zone'
                : getZoneForState(selectedAgent.state) === 'bugs' ? '🐛 Bug Zone'
                : '☕ Lounge'}
            </span>
          </InfoBox>

          {!isCompact && (
            <InfoBox label="מזהה">
              <code style={{ fontSize: 12, color: '#7B68EE' }}>agent:{selectedAgent.id}</code>
            </InfoBox>
          )}

          {/* Chat Input — UI by Noa, logic by Alon */}
          <ChatInput
            agentId={selectedAgent.id}
            agentColor={STATE_META[selectedAgent.state].color}
            compact={isCompact}
            onSend={handleSendToAgent}
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
      <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  )
}

// ── Chat Input Component ──
// UI-only — onSend callback for Alon to wire up

type SendStatus = 'idle' | 'sending' | 'sent' | 'error'

function ChatInput({ agentId, agentColor, compact, onSend }: {
  agentId: string
  agentColor: string
  compact?: boolean
  onSend?: (agentId: string, message: string) => Promise<void> | void
}) {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<SendStatus>('idle')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSend = useCallback(async () => {
    const msg = text.trim()
    if (!msg || status === 'sending') return

    setStatus('sending')
    try {
      await onSend?.(agentId, msg)
      setText('')
      setStatus('sent')
      // Reset to idle after success animation
      setTimeout(() => setStatus('idle'), 1800)
    } catch {
      setStatus('error')
      setTimeout(() => setStatus('idle'), 2000)
    }
  }, [text, status, agentId, onSend])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const inputHeight = compact ? 36 : 44
  const fontSize = compact ? 13 : 14

  return (
    <div style={{
      marginTop: 12,
      borderTop: '1px solid rgba(255,255,255,0.08)',
      paddingTop: 12,
      direction: 'rtl',
    }}>
      {/* Success / Error animation overlay */}
      {(status === 'sent' || status === 'error') && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          padding: '8px 0',
          fontSize: 13,
          color: status === 'sent' ? '#4ade80' : '#f87171',
          animation: 'chatFadeIn 0.3s ease-out',
        }}>
          <span style={{
            width: 20, height: 20, borderRadius: '50%',
            background: status === 'sent' ? 'rgba(74, 222, 128, 0.15)' : 'rgba(248, 113, 113, 0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12,
          }}>
            {status === 'sent' ? '✓' : '✕'}
          </span>
          {status === 'sent' ? 'נשלח!' : 'שגיאה בשליחה'}
        </div>
      )}

      {/* Input row */}
      <div style={{
        display: 'flex',
        gap: 8,
        alignItems: 'center',
      }}>
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="שלח הודעה..."
          disabled={status === 'sending'}
          style={{
            flex: 1,
            height: inputHeight,
            minHeight: inputHeight, // touch target
            padding: '0 12px',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(255,255,255,0.05)',
            color: '#eee',
            fontSize,
            fontFamily: '"Segoe UI", Arial, sans-serif',
            outline: 'none',
            direction: 'rtl',
            transition: 'border-color 0.2s, background 0.2s',
            opacity: status === 'sending' ? 0.6 : 1,
          }}
          onFocus={e => {
            e.currentTarget.style.borderColor = agentColor
            e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
          }}
          onBlur={e => {
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
            e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
          }}
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || status === 'sending'}
          style={{
            width: inputHeight,
            height: inputHeight,
            minWidth: inputHeight, // touch target
            minHeight: inputHeight,
            borderRadius: 8,
            border: 'none',
            background: text.trim() && status !== 'sending'
              ? agentColor
              : 'rgba(255,255,255,0.08)',
            color: text.trim() && status !== 'sending' ? '#fff' : '#555',
            fontSize: compact ? 16 : 18,
            cursor: text.trim() && status !== 'sending' ? 'pointer' : 'default',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background 0.2s, transform 0.1s',
            transform: status === 'sending' ? 'scale(0.95)' : 'scale(1)',
            flexShrink: 0,
          }}
          onMouseDown={e => {
            if (text.trim()) (e.currentTarget as HTMLElement).style.transform = 'scale(0.9)'
          }}
          onMouseUp={e => {
            (e.currentTarget as HTMLElement).style.transform = 'scale(1)'
          }}
          title="שלח"
        >
          {status === 'sending' ? (
            // Spinning indicator
            <span style={{
              display: 'inline-block',
              width: 16, height: 16,
              border: '2px solid rgba(255,255,255,0.3)',
              borderTopColor: '#fff',
              borderRadius: '50%',
              animation: 'chatSpin 0.6s linear infinite',
            }} />
          ) : '←'}
        </button>
      </div>

      {/* CSS animations (injected once) */}
      <style>{`
        @keyframes chatFadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes chatSpin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
