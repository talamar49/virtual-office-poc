import { useRef, useEffect, useState, useCallback } from 'react'

// ── i18n ──
type Lang = 'he' | 'en'
const translations = {
  he: {
    virtualOffice: 'משרד וירטואלי',
    loading: 'המשרד נטען...',
    connectingAgents: 'מחבר סוכנים...',
    setup: 'הגדרות חיבור',
    gatewayToken: 'Gateway Token',
    gatewayUrl: 'כתובת Gateway',
    tokenPlaceholder: 'הזן את ה-Gateway Token שלך',
    connect: 'התחבר',
    demoMode: 'סביבת דמו',
    sendMessage: 'שלח הודעה להתחיל שיחה',
    send: 'שלח',
    typeMessage: 'הקלד הודעה...',
    active: 'פעיל',
    working: 'עובד',
    idle: 'ממתין',
    offline: 'לא מחובר',
    error: 'שגיאה',
    workZone: '💻 אזור עבודה',
    loungeZone: '☕ אזור מנוחה',
    errorZone: '🐛 שגיאות',
    currentTask: 'משימה נוכחית',
    language: 'שפה',
    attachFile: 'צרף קובץ',
    recordVoice: 'הקלט קול',
    stopRecording: 'עצור הקלטה',
    chatWith: 'שיחה עם',
    agents: 'סוכנים',
    settings: 'הגדרות',
    noAgents: 'אין סוכנים מחוברים',
    reception: 'קבלה',
    coffeeCorner: 'פינת קפה',
    meetingRoom: 'חדר ישיבות',
    workingTask: 'עובד...',
    connectedTask: 'מחובר',
    idleTask: 'ממתין',
    offlineTask: 'לא מחובר',
    errorTask: 'שגיאה',
    unknown: 'לא ידוע',
    now: 'עכשיו',
    minutesAgo: 'לפני {n} דקות',
    hoursAgo: 'לפני {n} שעות',
    daysAgo: 'לפני {n} ימים',
    lastSeen: 'נראה לאחרונה',
    model: 'מודל',
    tokens: 'טוקנים',
    session: 'סשן',
    editMode: 'מצב עריכה',
    designOffice: '🎨 עיצוב משרד',
    delete: '🗑️ מחק',
    reset: '🔄 איפוס',
    muteSound: 'כבה סאונד',
    enableSound: 'הפעל סאונד',
    backToOffice: 'חזור למשרד',
    dashboard: 'Dashboard',
    taskCompleted: 'סיים משימה',
  },
  en: {
    virtualOffice: 'Virtual Office',
    loading: 'Loading office...',
    connectingAgents: 'Connecting agents...',
    setup: 'Connection Setup',
    gatewayToken: 'Gateway Token',
    gatewayUrl: 'Gateway URL',
    tokenPlaceholder: 'Enter your Gateway Token',
    connect: 'Connect',
    demoMode: 'Demo Mode',
    sendMessage: 'Send a message to start a conversation',
    send: 'Send',
    typeMessage: 'Type a message...',
    active: 'Active',
    working: 'Working',
    idle: 'Idle',
    offline: 'Offline',
    error: 'Error',
    workZone: '💻 Work Zone',
    loungeZone: '☕ Lounge',
    errorZone: '🐛 Errors',
    currentTask: 'Current Task',
    language: 'Language',
    attachFile: 'Attach file',
    recordVoice: 'Record voice',
    stopRecording: 'Stop recording',
    chatWith: 'Chat with',
    agents: 'Agents',
    settings: 'Settings',
    noAgents: 'No agents connected',
    reception: 'Reception',
    coffeeCorner: 'Coffee Corner',
    meetingRoom: 'Meeting Room',
    workingTask: 'Working...',
    connectedTask: 'Connected',
    idleTask: 'Idle',
    offlineTask: 'Offline',
    errorTask: 'Error',
    unknown: 'Unknown',
    now: 'Just now',
    minutesAgo: '{n} min ago',
    hoursAgo: '{n} hours ago',
    daysAgo: '{n} days ago',
    lastSeen: 'Last seen',
    model: 'Model',
    tokens: 'Tokens',
    session: 'Session',
    editMode: 'Edit Mode',
    designOffice: '🎨 Design Office',
    delete: '🗑️ Delete',
    reset: '🔄 Reset',
    muteSound: 'Mute Sound',
    enableSound: 'Enable Sound',
    backToOffice: 'Back to Office',
    dashboard: 'Dashboard',
    taskCompleted: 'Task completed',
  },
} as const

function useI18n() {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('office-lang') as Lang) || 'he')
  const t = translations[lang]
  const toggleLang = useCallback(() => {
    const next = lang === 'he' ? 'en' : 'he'
    localStorage.setItem('office-lang', next)
    setLang(next)
  }, [lang])
  const dir = lang === 'he' ? 'rtl' : 'ltr'
  return { lang, t, toggleLang, dir }
}

// ── Types ──
type AgentState = 'active' | 'idle' | 'working' | 'offline' | 'error'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'agent'
  text: string
  ts: number
  source?: string // channel source: 'discord', 'telegram', 'webchat', etc.
  senderName?: string // for inter-agent messages
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
  const seenTexts = new Set<string>()
  return msgs.filter(m => {
    // Deduplicate by ID
    if (seen.has(m.id)) return false
    seen.add(m.id)
    // Deduplicate by role+text (truncated) — catches WS vs poll duplicates with different IDs
    const textKey = `${m.role}:${m.text.substring(0, 150)}`
    if (seenTexts.has(textKey)) return false
    seenTexts.add(textKey)
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

// ── Movement path — L-shaped waypoint-based pathfinding ──
interface MovementPath {
  waypoints: [number, number][]
  currentWaypoint: number
}

interface AgentRuntime {
  def: AgentDef
  x: number
  y: number
  tx: number
  ty: number
  room: RoomId  // current room assignment
  path: MovementPath | null  // active walk path (null = at destination)
}

const AGENT_MOVE_SPEED = 3 // tiles per second

// ── Room system ──
type RoomId = 'reception' | 'dev' | 'openspace' | 'biz' | 'qa' | 'meeting' | 'lounge' | 'manager'

interface Room {
  id: RoomId
  label: string
  emoji: string
  sign: string          // sign text displayed on the wall
  floorType: number     // index into FLOOR_STYLES
  startCol: number
  endCol: number
  startRow: number
  endRow: number
  seats: [number, number][]  // cubicle/seat positions within the room
  loungeSeats?: [number, number][] // sofa positions (lounge only)
}

// Team assignments — which agents belong to which work room
const TEAM_ROOMS: Record<string, RoomId> = {
  omer: 'dev', noa: 'dev', gil: 'dev',
  itai: 'openspace', alon: 'openspace', ido: 'openspace',
  lior: 'biz', tomer: 'biz', dana: 'biz', roni: 'biz',
  michal: 'qa',
  yogi: 'manager',
}

// Default room for unknown agents
function getWorkRoom(agentId: string): RoomId {
  return TEAM_ROOMS[agentId] || 'openspace'
}

// Room definitions — fixed layout
const ROOMS: Room[] = [
  { id: 'reception', label: 'קבלה', emoji: '📋', sign: 'OpenClaw HQ',
    floorType: 4, startCol: 0, endCol: 20, startRow: 0, endRow: 2, seats: [] },
  { id: 'dev', label: 'Dev Team', emoji: '💻', sign: '⚡ Dev Team',
    floorType: 5, startCol: 0, endCol: 5, startRow: 3, endRow: 9,
    seats: [[1, 4], [1, 7], [3, 4]] },
  { id: 'openspace', label: 'Open Space', emoji: '🏢', sign: '',
    floorType: 0, startCol: 6, endCol: 14, startRow: 3, endRow: 9,
    seats: [[7, 4], [7, 7], [10, 4], [10, 7], [13, 4], [13, 7]] },
  { id: 'biz', label: 'Business', emoji: '📈', sign: '📊 Business',
    floorType: 6, startCol: 15, endCol: 20, startRow: 3, endRow: 9,
    seats: [[16, 4], [16, 7], [18, 4], [18, 7]] },
  { id: 'qa', label: 'QA Lab', emoji: '🔍', sign: '🔍 QA Lab',
    floorType: 7, startCol: 0, endCol: 5, startRow: 10, endRow: 13,
    seats: [[1, 11], [3, 11]] },
  { id: 'meeting', label: 'Meeting Room', emoji: '🏢', sign: '',
    floorType: 3, startCol: 15, endCol: 20, startRow: 10, endRow: 13, seats: [] },
  { id: 'lounge', label: 'Lounge', emoji: '☕', sign: '☕ Lounge',
    floorType: 2, startCol: 0, endCol: 14, startRow: 14, endRow: 19,
    seats: [], loungeSeats: [[2, 15], [2, 17], [5, 15], [5, 17], [8, 15], [8, 17], [11, 15], [11, 17]] },
  { id: 'manager', label: 'Manager', emoji: '🐻', sign: '',
    floorType: 8, startCol: 15, endCol: 20, startRow: 14, endRow: 19,
    seats: [[17, 16]] },
]

const ROOM_MAP = new Map<RoomId, Room>(ROOMS.map(r => [r.id, r]))

function getRoomAt(col: number, row: number): Room | undefined {
  for (const r of ROOMS) {
    if (col >= r.startCol && col <= r.endCol && row >= r.startRow && row <= r.endRow) return r
  }
  return undefined
}

// ── Isometric constants ──
const TILE_W = 64
const TILE_H = 32
const SPRITE_SIZE = 64    // v6/v7 assets are 64×64
const SPRITE_DISPLAY = 64 // display size matches native (1:1, no upscale)

// Fixed map size for room-based layout
let MAP_COLS = 21
let MAP_ROWS = 20

// Agent spacing within rooms
const COLS_PER_AGENT = 3
const ROWS_PER_AGENT = 3

// ── Lounge spot assignment ──
const loungeAssignments: Map<string, number> = new Map()

function assignLoungeSpot(agentId: string): [number, number] {
  const lounge = ROOM_MAP.get('lounge')!
  const spots = lounge.loungeSeats!
  // Already assigned?
  const existing = loungeAssignments.get(agentId)
  if (existing !== undefined && existing < spots.length) return spots[existing]
  // Find free spot
  const taken = new Set(loungeAssignments.values())
  for (let i = 0; i < spots.length; i++) {
    if (!taken.has(i)) { loungeAssignments.set(agentId, i); return spots[i] }
  }
  // Overflow — stack with offset
  const idx = loungeAssignments.size % spots.length
  loungeAssignments.set(agentId, spots.length + loungeAssignments.size)
  return [spots[idx][0] + 1, spots[idx][1]]
}

function releaseLoungeSpot(agentId: string) {
  loungeAssignments.delete(agentId)
}

// ── Pathfinding (L-shape: horizontal then vertical) ──
function findPath(from: [number, number], to: [number, number]): [number, number][] {
  const [fx, fy] = from
  const [tx, ty] = to
  // L-shape: go horizontal first, then vertical (avoids walls between rooms)
  const path: [number, number][] = []
  // Horizontal leg
  const dx = tx > fx ? 1 : -1
  for (let x = fx; x !== tx; x += dx) path.push([x, fy])
  // Vertical leg
  const dy = ty > fy ? 1 : -1
  for (let y = fy; y !== ty; y += dy) path.push([tx, y])
  path.push(to)
  return path
}

// ── Custom seating overrides (populated from backend API) ──
let _seatingOverrides: Record<string, { room: string; col: number; row: number }> = {}

// ── Work seat allocation — per-room tracking to prevent overlap ──
// Maps agentId → { roomId, seatIndex }
const workSeatAssignments: Map<string, { roomId: RoomId; seatIndex: number }> = new Map()

function assignWorkSeat(agentId: string, roomId: RoomId): [number, number] {
  const room = ROOM_MAP.get(roomId)!
  const seats = room.seats

  // Already assigned to this room?
  const existing = workSeatAssignments.get(agentId)
  if (existing && existing.roomId === roomId && existing.seatIndex < seats.length) {
    return seats[existing.seatIndex]
  }

  // Release old assignment if switching rooms
  releaseWorkSeat(agentId)

  // Find first free seat in this room
  const takenInRoom = new Set<number>()
  for (const [, assignment] of workSeatAssignments) {
    if (assignment.roomId === roomId) takenInRoom.add(assignment.seatIndex)
  }
  for (let i = 0; i < seats.length; i++) {
    if (!takenInRoom.has(i)) {
      workSeatAssignments.set(agentId, { roomId, seatIndex: i })
      return seats[i]
    }
  }

  // Room full — overflow to openspace
  if (roomId !== 'openspace') {
    console.warn(`[Seating] Room '${roomId}' full — overflow '${agentId}' to openspace`)
    return assignWorkSeat(agentId, 'openspace')
  }

  // Openspace also full — generate overflow position with offset
  const overflowIdx = takenInRoom.size
  const baseSeat = seats.length > 0 ? seats[overflowIdx % seats.length] : [Math.floor((room.startCol + room.endCol) / 2), Math.floor((room.startRow + room.endRow) / 2)] as [number, number]
  const offset = Math.floor(overflowIdx / Math.max(seats.length, 1))
  const overflowPos: [number, number] = [baseSeat[0] + offset + 1, baseSeat[1]]
  workSeatAssignments.set(agentId, { roomId, seatIndex: seats.length + overflowIdx })
  console.warn(`[Seating] Overflow: '${agentId}' at [${overflowPos}]`)
  return overflowPos
}

function releaseWorkSeat(agentId: string) {
  workSeatAssignments.delete(agentId)
}

// ── Collision detection — verify no two agents share a tile ──
const _occupiedTiles: Map<string, string> = new Map() // "col,row" → agentId

function claimTile(agentId: string, col: number, row: number): [number, number] {
  const key = `${col},${row}`
  const occupant = _occupiedTiles.get(key)
  if (occupant && occupant !== agentId) {
    // Collision! Nudge this agent to adjacent tile
    console.warn(`[Seating] Collision: '${agentId}' and '${occupant}' both at [${col},${row}] — nudging`)
    // Try offsets: right, below, left, above, diagonals
    const offsets: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]
    for (const [dx, dy] of offsets) {
      const nk = `${col + dx},${row + dy}`
      if (!_occupiedTiles.has(nk)) {
        _occupiedTiles.set(nk, agentId)
        return [col + dx, row + dy]
      }
    }
    // All adjacent taken — stack with small offset (worst case)
    _occupiedTiles.set(`${col + 2},${row}`, agentId)
    return [col + 2, row]
  }
  // Release old tile claim
  for (const [k, v] of _occupiedTiles) {
    if (v === agentId) { _occupiedTiles.delete(k); break }
  }
  _occupiedTiles.set(key, agentId)
  return [col, row]
}

// ── Get target tile based on state ──
function getTargetTileForAgent(agentId: string, state: AgentState): { pos: [number, number]; room: RoomId } {
  // Check custom seating override first (drag & drop assignments)
  const override = _seatingOverrides[agentId]
  if (override && (state === 'working' || state === 'active' || state === 'error')) {
    releaseLoungeSpot(agentId)
    releaseWorkSeat(agentId)
    const pos = claimTile(agentId, override.col, override.row)
    return { pos, room: override.room as RoomId }
  }

  // Idle/offline → lounge
  if (state === 'idle' || state === 'offline') {
    releaseWorkSeat(agentId)
    const pos = assignLoungeSpot(agentId)
    const claimed = claimTile(agentId, pos[0], pos[1])
    return { pos: claimed, room: 'lounge' }
  }
  // Working/active/error → assigned work room cubicle
  releaseLoungeSpot(agentId)
  const roomId = getWorkRoom(agentId)
  const seat = assignWorkSeat(agentId, roomId)
  const claimed = claimTile(agentId, seat[0], seat[1])
  return { pos: claimed, room: roomId }
}

function computeGridSize(_agentCount: number) {
  // Fixed layout — rooms don't resize
  MAP_COLS = 21
  MAP_ROWS = 20
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
// ── Tilemap — room-based floor types ──
function generateFloorMap(): number[][] {
  const map: number[][] = []
  for (let row = 0; row < MAP_ROWS; row++) {
    const r: number[] = []
    for (let col = 0; col < MAP_COLS; col++) {
      const room = getRoomAt(col, row)
      r.push(room?.floorType ?? 0)
    }
    map.push(r)
  }
  return map
}

let FLOOR_MAP = generateFloorMap()

// Floor tile colors per room type (2 shades for checkerboard)
const FLOOR_STYLES: Record<number, [string, string]> = {
  0: ['#3d2f20', '#44352a'],  // Open Space — warm parquet
  1: ['#1a3040', '#1e3848'],  // stone (unused default)
  2: ['#3a2820', '#422e24'],  // Lounge — cozy carpet brown
  3: ['#1e1e30', '#242440'],  // Meeting Room — dark blue
  4: ['#b8b0a8', '#ada59c'],  // Reception — light marble
  5: ['#1a1a2e', '#1e1e34'],  // Dev Room — dark, monitor glow
  6: ['#2a3025', '#303828'],  // Business Wing — corporate green-gray
  7: ['#2a2a35', '#303040'],  // QA Corner — lab gray
  8: ['#2a2420', '#322c26'],  // Manager — warm dark
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
// Cubicle positions are defined per-room in ROOMS[].seats
// This flat list is built from all rooms for backward compatibility
let CUBICLE_POSITIONS: [number, number][] = ROOMS.flatMap(r => r.seats)

// Pan clamping
function clampPan(pan: { x: number; y: number }) {
  const { isoW, isoH } = getIsoBounds()
  const maxX = isoW * 0.5
  const maxY = isoH * 0.5
  pan.x = Math.max(-maxX, Math.min(maxX, pan.x))
  pan.y = Math.max(-maxY, Math.min(maxY, pan.y))
}

// (Furniture positions defined in room layout)

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

// Available decoration types for the editor sidebar — bilingual
const DECO_LABELS: Record<string, { he: string; en: string }> = {
  plant_large: { he: 'צמח גדול', en: 'Large Plant' },
  plant_small: { he: 'צמח קטן', en: 'Small Plant' },
  bookshelf: { he: 'ארון ספרים', en: 'Bookshelf' },
  whiteboard: { he: 'לוח', en: 'Whiteboard' },
  kanban_board: { he: 'קאנבן', en: 'Kanban Board' },
  water_cooler: { he: 'מים', en: 'Water Cooler' },
  printer: { he: 'מדפסת', en: 'Printer' },
  coffee_machine: { he: 'קפה', en: 'Coffee Machine' },
  trophy: { he: 'גביע', en: 'Trophy' },
  motivation_sign: { he: 'שלט', en: 'Sign' },
  team_photo: { he: 'תמונת צוות', en: 'Team Photo' },
  picture_frame: { he: 'מסגרת', en: 'Picture Frame' },
  mug: { he: 'כוס', en: 'Mug' },
  keyboard: { he: 'מקלדת', en: 'Keyboard' },
  mouse: { he: 'עכבר', en: 'Mouse' },
  laptop: { he: 'לפטופ', en: 'Laptop' },
  monitor_wall: { he: 'מסך קיר', en: 'Wall Monitor' },
  server_rack_mini: { he: 'שרת', en: 'Server Rack' },
  alert_light: { he: 'אור התראה', en: 'Alert Light' },
  candle: { he: 'נר', en: 'Candle' },
  phone: { he: 'טלפון', en: 'Phone' },
  stickers: { he: 'מדבקות', en: 'Stickers' },
  wireframes: { he: 'וויירפריימס', en: 'Wireframes' },
  tea_cup: { he: 'תה', en: 'Tea' },
  poster: { he: 'פוסטר', en: 'Poster' },
  lamp: { he: 'מנורה', en: 'Lamp' },
  trash_bin: { he: 'פח', en: 'Trash Bin' },
  clock: { he: 'שעון', en: 'Clock' },
  fan: { he: 'מאוורר', en: 'Fan' },
  calendar: { he: 'לוח שנה', en: 'Calendar' },
  headphones: { he: 'אוזניות', en: 'Headphones' },
  warning_sign: { he: 'שלט אזהרה', en: 'Warning Sign' },
}
const DECO_EMOJIS: Record<string, string> = {
  plant_large: '🌿', plant_small: '🌱', bookshelf: '📚', whiteboard: '📝',
  kanban_board: '📋', water_cooler: '💧', printer: '🖨️', coffee_machine: '☕',
  trophy: '🏆', motivation_sign: '💪', team_photo: '📸', picture_frame: '🖼️',
  mug: '☕', keyboard: '⌨️', mouse: '🖱️', laptop: '💻', monitor_wall: '🖥️',
  server_rack_mini: '🗄️', alert_light: '🚨', candle: '🕯️', phone: '📱',
  stickers: '🏷️', wireframes: '📐', tea_cup: '🍵', poster: '🎨', lamp: '💡',
  trash_bin: '🗑️', clock: '🕐', fan: '🌀', calendar: '📅', headphones: '🎧',
  warning_sign: '⚠️',
}
let _currentLang: Lang = 'he'
function getDecoTypes() {
  return Object.keys(DECO_LABELS).map(type => ({
    type, label: DECO_LABELS[type][_currentLang], emoji: DECO_EMOJIS[type] || '📦',
  }))
}
const AVAILABLE_DECO_TYPES = getDecoTypes()

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

// ── Asset loading system — v6 primary (64×64), v4 fallback (128×128) ──
const V6_BASE = '/assets/furniture/v6'
const V4_BASE = '/assets/furniture/v4'

// v6 assets (64×64 isometric pixel art — Amir's latest)
const V6_ASSETS = [
  // Floors
  'floor_wood', 'floor_marble', 'floor_carpet_gray', 'floor_carpet_green', 'floor_carpet_dark',
  // Walls — base + oriented variants (north = top-left edge, east = top-right edge)
  'wall_plain', 'wall_window', 'wall_door', 'wall_glass',
  'wall_plain_north', 'wall_window_north', 'wall_door_north', 'wall_glass_north',
  'wall_plain_east', 'wall_window_east', 'wall_door_east', 'wall_glass_east',
  // Furniture
  'bookshelf', 'manager_desk', 'meeting_table', 'plant_large', 'plant_small',
  'printer', 'reception_desk', 'server_rack', 'water_cooler',
]

// v4 fallback assets (128×128) — used when v6 version doesn't exist
const V4_FALLBACK = [
  'cubicle_work', 'lounge_sofa', 'coffee_station',
  'floor_carpet_warm',  // v6 has warm→green, keep v4 warm
]

// Floor sprite mapping: floorType → asset name
const FLOOR_SPRITE_MAP: Record<number, string | null> = {
  0: 'floor_wood',          // Open Space — parquet
  1: null,                  // stone (flat color fallback)
  2: 'floor_carpet_dark',   // Lounge — warm carpet (v6 dark carpet)
  3: null,                  // Meeting Room (flat — dark blue)
  4: 'floor_marble',        // Reception — marble
  5: null,                  // Dev Room (flat — dark monitor glow)
  6: 'floor_carpet_gray',   // Business Wing — gray carpet
  7: 'floor_carpet_gray',   // QA Corner — gray carpet
  8: 'floor_wood',          // Manager — wood
}

// Wall config per room edge — orientation-aware sprites
// North walls (top-left edge in iso) use wall_*_north, East walls (top-right edge) use wall_*_east
type WallOrientation = 'north' | 'east'
interface WallSegment { col: number; row: number; side: 'top' | 'left'; orientation: WallOrientation; sprite: string }

/** Get wall sprite name with orientation suffix */
function wallSpriteName(base: string, orient: WallOrientation): string {
  // Try oriented sprite first (wall_plain_north), fall back to base (wall_plain)
  return `${base}_${orient}`
}

function generateRoomWalls(): WallSegment[] {
  const segs: WallSegment[] = []
  for (const room of ROOMS) {
    if (room.id === 'reception') continue
    // Top wall (north-facing — left-upper edge in isometric)
    for (let c = room.startCol; c <= room.endCol; c++) {
      const base = (c === Math.floor((room.startCol + room.endCol) / 2)) ? 'wall_door'
        : (c % 3 === 0) ? 'wall_window' : 'wall_plain'
      segs.push({ col: c, row: room.startRow, side: 'top', orientation: 'north', sprite: wallSpriteName(base, 'north') })
    }
    // Left wall (east-facing — right-upper edge in isometric)
    for (let r = room.startRow; r <= room.endRow; r++) {
      segs.push({ col: room.startCol, row: r, side: 'left', orientation: 'east', sprite: wallSpriteName('wall_plain', 'east') })
    }
  }
  return segs
}

const ROOM_WALLS = generateRoomWalls()

// Per-room furniture placement
interface FurniturePlacement { asset: string; col: number; row: number; scale?: number }

const ROOM_FURNITURE: Record<RoomId, FurniturePlacement[]> = {
  reception: [
    { asset: 'reception_desk', col: 10, row: 1 },
    { asset: 'plant_large', col: 2, row: 1 },
    { asset: 'plant_large', col: 18, row: 1 },
    { asset: 'water_cooler', col: 14, row: 1 },
  ],
  dev: [
    { asset: 'cubicle_work', col: 1, row: 4 },
    { asset: 'cubicle_work', col: 1, row: 7 },
    { asset: 'cubicle_work', col: 3, row: 4 },
    { asset: 'server_rack', col: 4, row: 8 },
    { asset: 'plant_small', col: 5, row: 3 },
  ],
  openspace: [
    { asset: 'cubicle_work', col: 7, row: 4 },
    { asset: 'cubicle_work', col: 7, row: 7 },
    { asset: 'cubicle_work', col: 10, row: 4 },
    { asset: 'cubicle_work', col: 10, row: 7 },
    { asset: 'cubicle_work', col: 13, row: 4 },
    { asset: 'cubicle_work', col: 13, row: 7 },
    { asset: 'printer', col: 14, row: 8 },
    { asset: 'water_cooler', col: 6, row: 8 },
    { asset: 'plant_large', col: 14, row: 3 },
  ],
  biz: [
    { asset: 'cubicle_work', col: 16, row: 4 },
    { asset: 'cubicle_work', col: 16, row: 7 },
    { asset: 'cubicle_work', col: 18, row: 4 },
    { asset: 'cubicle_work', col: 18, row: 7 },
    { asset: 'bookshelf', col: 20, row: 4 },
    { asset: 'plant_small', col: 20, row: 8 },
  ],
  qa: [
    { asset: 'cubicle_work', col: 1, row: 11 },
    { asset: 'cubicle_work', col: 3, row: 11 },
    { asset: 'printer', col: 4, row: 12 },
  ],
  meeting: [
    { asset: 'meeting_table', col: 17, row: 11 },
    { asset: 'plant_small', col: 20, row: 10 },
  ],
  lounge: [
    { asset: 'lounge_sofa', col: 2, row: 15 },
    { asset: 'lounge_sofa', col: 2, row: 17 },
    { asset: 'lounge_sofa', col: 8, row: 15 },
    { asset: 'lounge_sofa', col: 8, row: 17 },
    { asset: 'coffee_station', col: 5, row: 15 },
    { asset: 'water_cooler', col: 5, row: 17 },
    { asset: 'plant_large', col: 12, row: 14 },
    { asset: 'plant_small', col: 0, row: 14 },
  ],
  manager: [
    { asset: 'manager_desk', col: 17, row: 16 },
    { asset: 'bookshelf', col: 20, row: 15 },
    { asset: 'plant_large', col: 15, row: 18 },
  ],
}

// Image cache — v6 primary, v4 fallback
const spriteCache: Record<string, HTMLImageElement> = {}
const spriteSizes: Record<string, number> = {} // track native size for scaling
let spritesInitialized = false

// UI assets — signs, status icons, chat bubble
const UI_BASE = '/assets/ui/v7'
const UI_SIGNS: Record<string, string> = {
  dev: 'signs/sign_dev.png',
  biz: 'signs/sign_business.png',
  qa: 'signs/sign_qa.png',
  lounge: 'signs/sign_lounge.png',
  reception: 'signs/sign_hq.png',
}
const UI_ICONS = ['status_active', 'status_idle', 'status_error', 'status_working', 'mug']
const UI_MISC = ['chat_bubble']

// Room sign → sprite mapping
const ROOM_SIGN_SPRITE: Record<RoomId, string | null> = {
  reception: 'sign_reception', dev: 'sign_dev', openspace: null,
  biz: 'sign_biz', qa: 'sign_qa', meeting: null,
  lounge: 'sign_lounge', manager: null,
}

// Agent state → status icon mapping
const STATE_ICON_MAP: Record<AgentState, string | null> = {
  active: 'icon_status_active',
  working: 'icon_status_working',
  idle: 'icon_status_idle',
  error: 'icon_status_error',
  offline: null,
}

function preloadSprites() {
  if (spritesInitialized) return
  spritesInitialized = true

  // Load v6 assets (64×64)
  for (const name of V6_ASSETS) {
    const img = new Image()
    img.src = `${V6_BASE}/${name}.png`
    spriteCache[name] = img
    spriteSizes[name] = 64
  }

  // Load v4 fallbacks (128×128)
  for (const name of V4_FALLBACK) {
    if (!spriteCache[name]) {
      const img = new Image()
      img.src = `${V4_BASE}/${name}.png`
      spriteCache[name] = img
      spriteSizes[name] = 128
    }
  }

  // Load UI signs
  for (const [roomId, path] of Object.entries(UI_SIGNS)) {
    const key = `sign_${roomId}`
    const img = new Image()
    img.src = `${UI_BASE}/${path}`
    spriteCache[key] = img
    spriteSizes[key] = roomId === 'reception' ? 128 : 64 // HQ sign is 128×32
  }

  // Load UI icons
  for (const name of UI_ICONS) {
    const key = `icon_${name}`
    const img = new Image()
    img.src = `${UI_BASE}/icons/${name}.png`
    spriteCache[key] = img
    spriteSizes[key] = 16
  }

  // Load chat bubble
  for (const name of UI_MISC) {
    const img = new Image()
    img.src = `${UI_BASE}/${name}.png`
    spriteCache[name] = img
    spriteSizes[name] = 32
  }

  console.log(`[Assets] Preloading ${V6_ASSETS.length} v6 + ${V4_FALLBACK.length} v4 + ${Object.keys(UI_SIGNS).length + UI_ICONS.length + UI_MISC.length} UI sprites`)
}

function getSprite(name: string): HTMLImageElement | null {
  const img = spriteCache[name]
  return (img?.complete && img.naturalWidth > 0) ? img : null
}

function getSpriteNativeSize(name: string): number {
  return spriteSizes[name] ?? 64
}

// Legacy decoration/furniture images (keep existing system working)
const decoImages: Record<string, HTMLImageElement> = {}
const furnitureImages: Record<string, HTMLImageElement> = {}
let decoInitialized = false

function loadDecorations() {
  if (decoInitialized) return
  decoInitialized = true
  preloadSprites() // also load v4 sprites

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

  // Also load office/ subfolder assets
  const officeTypes = [
    'coffee_station', 'doormat', 'floor_carpet', 'floor_parquet',
    'lamp_ceiling', 'lamp_desk', 'meeting_table', 'plant_cactus',
    'plant_small', 'plant_succulent', 'plant_tall', 'printer',
    'reception_desk', 'wall_art', 'wall_window', 'water_cooler', 'whiteboard',
  ]
  for (const t of officeTypes) {
    const img = new Image()
    img.src = `/assets/furniture/office/${t}.png`
    decoImages[`office_${t}`] = img
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
/** State-based fallback labels — uses current i18n */
let TASK_FALLBACKS: Record<string, string> = {
  working: 'עובד...',
  active: 'מחובר',
  idle: 'ממתין',
  offline: 'לא מחובר',
  error: 'שגיאה',
}
function updateTaskFallbacks(t: typeof translations[Lang]) {
  TASK_FALLBACKS = {
    working: t.workingTask,
    active: t.connectedTask,
    idle: t.idleTask,
    offline: t.offlineTask,
    error: t.errorTask,
  }
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
const STATE_COLORS: Record<AgentState, { color: string; dot: string }> = {
  active:  { color: '#4CAF50', dot: '🟢' },
  working: { color: '#2196F3', dot: '🔵' },
  idle:    { color: '#FFC107', dot: '🟡' },
  offline: { color: '#757575', dot: '⚫' },
  error:   { color: '#f44336', dot: '🔴' },
}
function getStateMeta(state: AgentState, t: { active: string; working: string; idle: string; offline: string; error: string }) {
  const c = STATE_COLORS[state]
  return { color: c.color, dot: c.dot, label: t[state] }
}
// Legacy compat — used in places without i18n context
const STATE_META: Record<AgentState, { color: string; label: string; dot: string }> = {
  active:  { color: '#4CAF50', label: 'פעיל',      dot: '🟢' },
  working: { color: '#2196F3', label: 'עובד',      dot: '🔵' },
  idle:    { color: '#FFC107', label: 'ממתין',     dot: '🟡' },
  offline: { color: '#757575', label: 'לא מחובר', dot: '⚫' },
  error:   { color: '#f44336', label: 'שגיאה',    dot: '🔴' },
}

// ── Zone assignment logic ──
// ── Room-based agent placement ──
function buildAgents(defs: AgentDef[]): AgentRuntime[] {
  const sortedIds = defs.map(d => d.id).sort()
  for (let i = 0; i < sortedIds.length; i++) {
    const id = sortedIds[i]
    if (KNOWN_AGENTS[id]) {
      KNOWN_AGENTS[id].fixedIndex = i
    } else {
      KNOWN_AGENTS[id] = {
        name: id, role: 'Agent',
        emoji: AGENT_EMOJIS[i % AGENT_EMOJIS.length],
        color: FALLBACK_COLORS[i % FALLBACK_COLORS.length],
        frames: 6, fixedIndex: i,
      }
    }
  }

  computeGridSize(defs.length)
  FLOOR_MAP = generateFloorMap()
  WALLS = generateWalls()
  CUBICLE_POSITIONS = ROOMS.flatMap(r => r.seats)
  loungeAssignments.clear()

  console.log(`[Office] buildAgents: ${defs.length} agents, MAP ${MAP_COLS}x${MAP_ROWS}, rooms: ${ROOMS.map(r => r.id).join(', ')}`)

  return defs.map(def => {
    const { pos, room } = getTargetTileForAgent(def.id, def.state)
    return { def, x: pos[0], y: pos[1], tx: pos[0], ty: pos[1], room, path: null }
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

// (cubicle sprites removed)

const SPRITE_ALIASES: Record<string, string> = { main: 'yogi' }

// v7 character sprites: 64×64 per frame, separate files per pose
// Shadow sprites: {id}-shadow.png (40×12 ellipse)
const shadowSprites: Record<string, HTMLImageElement> = {}
// Track which agents use v7 (64×64) vs legacy (32×32) sprites
const spriteIsV7: Set<string> = new Set()

/** Get sprite frame size for an agent (v7=64, legacy=32) */
function getCharSpriteSize(agentId: string): number {
  return spriteIsV7.has(agentId) ? 64 : SPRITE_SIZE
}

function loadSpritesForAgents(defs: AgentDef[]) {
  loadGenericSprites()
  defs.forEach(agent => {
    const spriteId = SPRITE_ALIASES[agent.id] ?? agent.id

    // Load idle sprite — try v7 first, then legacy
    if (!spriteImages[agent.id] && !spriteFailed.has(agent.id)) {
      const img = new Image()
      img.onerror = () => {
        // v7 failed — try legacy path
        const legacyImg = new Image()
        legacyImg.onerror = () => { spriteFailed.add(agent.id) }
        legacyImg.onload = () => {
          if (legacyImg.naturalWidth > 0) {
            spriteImages[agent.id] = legacyImg
            spriteResolved[agent.id] = legacyImg
            spriteFrameCounts[agent.id] = Math.max(1, Math.floor(legacyImg.naturalWidth / SPRITE_SIZE))
          }
        }
        legacyImg.src = `/assets/characters/${spriteId}-idle.png`
      }
      img.onload = () => {
        if (img.naturalWidth > 0) {
          spriteIsV7.add(agent.id)
          spriteResolved[agent.id] = img
          spriteFrameCounts[agent.id] = Math.max(1, Math.floor(img.naturalWidth / 64))
        } else {
          spriteFailed.add(agent.id)
        }
      }
      img.src = `/assets/characters/v7/${spriteId}-idle.png`
      spriteImages[agent.id] = img
    }

    // Load sitting-work sprite — v7 then legacy
    const workKey = `${agent.id}-work`
    if (!sittingSprites[workKey]) {
      const img = new Image()
      img.onload = () => {
        if (img.naturalWidth > 0) {
          const sz = spriteIsV7.has(agent.id) ? 64 : SPRITE_SIZE
          sittingFrameCounts[workKey] = Math.max(1, Math.floor(img.naturalWidth / sz))
        }
      }
      img.onerror = () => {
        // Try legacy
        const legacyImg = new Image()
        legacyImg.onload = () => {
          if (legacyImg.naturalWidth > 0) {
            sittingSprites[workKey] = legacyImg
            sittingFrameCounts[workKey] = Math.max(1, Math.floor(legacyImg.naturalWidth / SPRITE_SIZE))
          }
        }
        legacyImg.onerror = () => {}
        legacyImg.src = `/assets/characters/${spriteId}-sitting-work.png`
      }
      img.src = `/assets/characters/v7/${spriteId}-sitting-work.png`
      sittingSprites[workKey] = img
    }

    // Load sitting-lounge sprite — v7 then legacy
    const loungeKey = `${agent.id}-lounge`
    if (!sittingSprites[loungeKey]) {
      const img = new Image()
      img.onload = () => {
        if (img.naturalWidth > 0) {
          const sz = spriteIsV7.has(agent.id) ? 64 : SPRITE_SIZE
          sittingFrameCounts[loungeKey] = Math.max(1, Math.floor(img.naturalWidth / sz))
        }
      }
      img.onerror = () => {
        const legacyImg = new Image()
        legacyImg.onload = () => {
          if (legacyImg.naturalWidth > 0) {
            sittingSprites[loungeKey] = legacyImg
            sittingFrameCounts[loungeKey] = Math.max(1, Math.floor(legacyImg.naturalWidth / SPRITE_SIZE))
          }
        }
        legacyImg.onerror = () => {}
        legacyImg.src = `/assets/characters/${spriteId}-sitting-lounge.png`
      }
      img.src = `/assets/characters/v7/${spriteId}-sitting-lounge.png`
      sittingSprites[loungeKey] = img
    }

    // Load walk sprite — v7 then legacy
    if (!walkSprites[agent.id]) {
      const img = new Image()
      img.onload = () => {
        if (img.naturalWidth > 0) {
          const sz = spriteIsV7.has(agent.id) ? 64 : SPRITE_SIZE
          walkFrameCounts[agent.id] = Math.max(1, Math.floor(img.naturalWidth / sz))
          walkHasSwRow[agent.id] = img.naturalHeight >= sz * 2
        }
      }
      img.onerror = () => {
        const legacyImg = new Image()
        legacyImg.onload = () => {
          if (legacyImg.naturalWidth > 0) {
            walkSprites[agent.id] = legacyImg
            walkFrameCounts[agent.id] = Math.max(1, Math.floor(legacyImg.naturalWidth / SPRITE_SIZE))
            walkHasSwRow[agent.id] = legacyImg.naturalHeight >= SPRITE_SIZE * 2
          }
        }
        legacyImg.onerror = () => {}
        legacyImg.src = `/assets/characters/${spriteId}-walk.png`
      }
      img.src = `/assets/characters/v7/${spriteId}-walk.png`
      walkSprites[agent.id] = img
    }

    // Load shadow sprite (v7 only)
    if (!shadowSprites[agent.id]) {
      const img = new Image()
      img.onerror = () => {} // no shadow is fine
      img.src = `/assets/characters/v7/${spriteId}-shadow.png`
      shadowSprites[agent.id] = img
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

  // Try sprite-based floor first
  const spriteName = FLOOR_SPRITE_MAP[floorType]
  const spriteImg = spriteName ? getSprite(spriteName) : null

  if (spriteImg) {
    // Draw sprite scaled to tile size — v6 is 64×64, v4 is 128×128
    const native = getSpriteNativeSize(spriteName!)
    const scale = TILE_W / native
    const drawW = native * scale
    const drawH = native * scale
    ctx.drawImage(spriteImg, sx - drawW / 2, sy - drawH / 2, drawW, drawH)
    return
  }

  // Fallback: flat color diamond
  ctx.beginPath()
  ctx.moveTo(sx, sy - hh)
  ctx.lineTo(sx + hw, sy)
  ctx.lineTo(sx, sy + hh)
  ctx.lineTo(sx - hw, sy)
  ctx.closePath()

  const [c1, c2] = FLOOR_STYLES[floorType] ?? FLOOR_STYLES[0]
  const isDark = (col + row) % 2 === 0
  ctx.fillStyle = isDark ? c1 : c2
  ctx.fill()

  ctx.strokeStyle = 'rgba(255,255,255,0.04)'
  ctx.lineWidth = 0.5
  ctx.stroke()

  // Wood grain texture for type 0/8
  if (floorType === 0 || floorType === 8) {
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

  // Carpet texture for types 2, 6, 7
  if (floorType === 2 || floorType === 6 || floorType === 7) {
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
  const isInLounge = agent.room === 'lounge'
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

  // Shadow — use v7 shadow sprite if available, else fallback ellipse
  const shadowImg = shadowSprites[agent.def.id]
  if (shadowImg?.complete && shadowImg.naturalWidth > 0) {
    ctx.globalAlpha = (isOffline ? 0.4 : 1) * 0.35
    ctx.drawImage(shadowImg, Math.round(sx - 20), Math.round(sy - 2), 40, 12)
    ctx.globalAlpha = isOffline ? 0.4 : 1
  } else {
    ctx.beginPath()
    ctx.ellipse(sx, sy + 4, 14, 6, 0, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(0,0,0,0.3)'
    ctx.fill()
  }

  // Breathing disabled — caused sub-pixel flicker on pixel art sprites
  const breathOffset = 0

  // Determine pose based on zone and movement
  const isMoving = Math.abs(agent.x - agent.tx) > 0.5 || Math.abs(agent.y - agent.ty) > 0.5
  const pose: 'idle' | 'sitting-work' | 'sitting-lounge' | 'walk' = isMoving ? 'walk'
    : agent.room === 'lounge' ? 'sitting-lounge'
    : (agent.def.state === 'working' || agent.def.state === 'active') ? 'sitting-work'
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

    const charSz = getCharSpriteSize(agent.def.id)

    if (useWalk) {
      // Walk sprite: frames per row, row 0 = SE, row 1 = SW
      fps = 8
      maxFrames = walkFrameCounts[agent.def.id] ?? 4
      const frame = Math.floor(t * fps) % maxFrames
      srcX = frame * charSz

      // Direction: determine from movement toward current waypoint (or target)
      const wp = agent.path?.waypoints[agent.path.currentWaypoint]
      const dx = (wp ? wp[0] : agent.tx) - agent.x
      const dy = (wp ? wp[1] : agent.ty) - agent.y
      const movingSW = dx < -0.1 || (Math.abs(dx) < 0.1 && dy > 0.1)
      if (movingSW && walkHasSwRow[agent.def.id]) {
        srcY = charSz // Second row = SW direction
      }
    } else {
      // Non-walk sprite (idle/sitting)
      fps = pose === 'sitting-work' ? 4 : pose === 'sitting-lounge' ? 2 : (agent.def.state === 'working' || agent.def.state === 'active') ? 8 : 4
      maxFrames = Math.max(1, Math.floor(img.naturalWidth / charSz))
      const frame = Math.floor(t * fps) % maxFrames
      srcX = frame * charSz
    }

    // Math.round prevents sub-pixel blur on pixel art
    const drawX = Math.round(sx - SPRITE_DISPLAY / 2)
    const drawY = Math.round(sy - SPRITE_DISPLAY + 8 + breathOffset + sitOffset)

    ctx.imageSmoothingEnabled = false
    ctx.drawImage(
      img,
      srcX, srcY, charSz, charSz,
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

  // ── Status icon sprite above head ──
  const stateIconKey = STATE_ICON_MAP[agent.def.state]
  if (stateIconKey) {
    const iconSprite = getSprite(stateIconKey)
    if (iconSprite) {
      const iconSize = 16
      const iconX = Math.round(sx - iconSize / 2)
      const iconY = Math.round(sy - SPRITE_DISPLAY - iconSize + 4 + breathOffset + sitOffset)
      // Pulsing effect for idle/error
      const pulse = (agent.def.state === 'idle' || agent.def.state === 'error')
        ? 0.7 + 0.3 * Math.sin(t * 4) : 1
      ctx.globalAlpha = (isOffline ? 0.4 : 1) * pulse
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(iconSprite, iconX, iconY, iconSize, iconSize)
      ctx.imageSmoothingEnabled = true
      ctx.globalAlpha = isOffline ? 0.4 : 1
    }
  }

  // Coffee mug for idle agents in lounge
  if (agent.def.state === 'idle' && agent.room === 'lounge') {
    const mugSprite = getSprite('icon_mug')
    if (mugSprite) {
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(mugSprite, Math.round(sx + 12), Math.round(sy - 20 + sitOffset), 12, 12)
      ctx.imageSmoothingEnabled = true
    }
  }

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

interface I18nLabels { loungeZone?: string; workZone?: string; errorZone?: string; virtualOffice: string; active: string; working: string; idle: string; offline: string; error: string; editMode: string }
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
  i18nLabels?: I18nLabels,
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
  const labels: I18nLabels = i18nLabels ?? { loungeZone: '☕ Lounge', workZone: '💻 Work Zone', errorZone: '🐛 Errors', virtualOffice: '🏢 Virtual Office', active: 'Active', working: 'Working', idle: 'Idle', offline: 'Offline', error: 'Error', editMode: 'Edit Mode' }
  ctx.fillText(labels.virtualOffice, w / 2, 28)

  // Room signs — sprite signs if available, text fallback
  for (const room of ROOMS) {
    if (!room.sign) continue
    const signCol = (room.startCol + room.endCol) / 2
    const signRow = room.startRow
    const [signIx, signIy] = toIso(signCol, signRow)
    const signX = ox + signIx
    const signY = oy + signIy

    const signKey = ROOM_SIGN_SPRITE[room.id]
    const signSprite = signKey ? getSprite(signKey) : null

    if (signSprite) {
      // Sprite sign — draw above the room's top wall
      const signW = room.id === 'reception' ? 96 : 48  // HQ sign wider
      const signH = room.id === 'reception' ? 24 : 24
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(signSprite, Math.round(signX - signW / 2), Math.round(signY - signH - 8), signW, signH)
      ctx.imageSmoothingEnabled = true
    } else {
      // Text fallback
      ctx.font = `${f.zone}px "Heebo", "Segoe UI", sans-serif`
      ctx.fillStyle = 'rgba(255,255,255,0.3)'
      ctx.textAlign = 'center'
      ctx.fillText(room.sign, signX, signY - 6)
    }
  }

  // --- Floor tilemap --- (use FLOOR_MAP dimensions, not MAP_ROWS/COLS, to avoid stale mismatch)
  for (let row = 0; row < FLOOR_MAP.length; row++) {
    for (let col = 0; col < (FLOOR_MAP[row]?.length ?? 0); col++) {
      drawIsoTile(ctx, ox, oy, col, row, FLOOR_MAP[row][col])
    }
  }

  // --- Room borders — subtle lines between rooms ---
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.lineWidth = 1
  for (const room of ROOMS) {
    if (room.id === 'reception') continue // no border for reception
    const corners: [number, number][] = [
      [room.startCol, room.startRow],
      [room.endCol + 1, room.startRow],
      [room.endCol + 1, room.endRow + 1],
      [room.startCol, room.endRow + 1],
    ]
    ctx.beginPath()
    corners.forEach((c, i) => {
      const [px, py] = toIso(c[0], c[1])
      if (i === 0) ctx.moveTo(ox + px, oy + py)
      else ctx.lineTo(ox + px, oy + py)
    })
    ctx.closePath()
    ctx.stroke()
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
  // ── Room furniture from v4 sprites ──
  for (const room of ROOMS) {
    const placements = ROOM_FURNITURE[room.id] ?? []
    for (const fp of placements) {
      const sprite = getSprite(fp.asset)
      const [fIx, fIy] = toIso(fp.col, fp.row)
      const fsx = ox + fIx
      const fsy = oy + fIy
      const scale = fp.scale ?? 1
      drawables.push({ sortY: fp.col + fp.row, draw: () => {
        if (sprite) {
          // Draw sprite: v6=64×64, v4=128×128 — scale to tile size
          const native = getSpriteNativeSize(fp.asset)
          const spriteScale = (TILE_W / native) * scale
          const drawW = native * spriteScale
          const drawH = native * spriteScale
          ctx.drawImage(sprite, fsx - drawW / 2, fsy - drawH + TILE_H / 2, drawW, drawH)
        } else {
          // Fallback: small colored diamond placeholder
          const [c1] = FLOOR_STYLES[room.floorType] ?? FLOOR_STYLES[0]
          ctx.globalAlpha = 0.5
          ctx.fillStyle = c1
          ctx.beginPath()
          ctx.moveTo(fsx, fsy - 8)
          ctx.lineTo(fsx + 12, fsy)
          ctx.lineTo(fsx, fsy + 8)
          ctx.lineTo(fsx - 12, fsy)
          ctx.closePath()
          ctx.fill()
          ctx.globalAlpha = 1
          // Label
          ctx.font = '7px "Heebo", sans-serif'
          ctx.fillStyle = 'rgba(255,255,255,0.3)'
          ctx.textAlign = 'center'
          ctx.fillText(fp.asset.replace(/_/g, ' '), fsx, fsy + 14)
        }
      }})
    }
  }

  // ── Room wall sprites ──
  for (const seg of ROOM_WALLS) {
    // Try oriented sprite (wall_plain_north), fall back to base (wall_plain)
    const wallSprite = getSprite(seg.sprite) ?? getSprite(seg.sprite.replace(/_north$|_east$/, ''))
    const [wIx, wIy] = toIso(seg.col, seg.row)
    const wsx = ox + wIx
    const wsy = oy + wIy
    if (seg.side === 'top') {
      drawables.push({ sortY: seg.col + seg.row - 1, draw: () => {
        if (wallSprite) {
          const native = getSpriteNativeSize(seg.sprite)
          const wScale = TILE_W / native
          const drawW = native * wScale
          const drawH = native * wScale
          ctx.drawImage(wallSprite, wsx - drawW / 2, wsy - drawH + TILE_H / 4, drawW, drawH)
        } else {
          // Fallback: thin isometric wall line
          ctx.strokeStyle = 'rgba(255,255,255,0.15)'
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(wsx - TILE_W / 2, wsy)
          ctx.lineTo(wsx, wsy - TILE_H / 2)
          ctx.lineTo(wsx + TILE_W / 2, wsy)
          ctx.stroke()
        }
      }})
    } else if (seg.side === 'left') {
      drawables.push({ sortY: seg.col + seg.row - 0.5, draw: () => {
        if (wallSprite) {
          const native2 = getSpriteNativeSize(seg.sprite)
          const wScale2 = TILE_W / native2
          const drawW2 = native2 * wScale2
          const drawH2 = native2 * wScale2
          ctx.drawImage(wallSprite, wsx - drawW2, wsy - drawH2 / 2, drawW2, drawH2)
        } else {
          ctx.strokeStyle = 'rgba(255,255,255,0.1)'
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(wsx - TILE_W / 2, wsy)
          ctx.lineTo(wsx, wsy + TILE_H / 2)
          ctx.stroke()
        }
      }})
    }
  }

  // Lounge furniture — coffee area (procedural fallback)
  const lounge = ROOM_MAP.get('lounge')!
  if (!getSprite('coffee_station')) {
    drawables.push({ sortY: lounge.startCol + 3 + lounge.startRow + 1, draw: () => drawCoffeeTable(ctx, ox, oy, lounge.startCol + 3, lounge.startRow + 1) })
    drawables.push({ sortY: lounge.startCol + 1 + lounge.startRow + 1, draw: () => drawCoffeeMachine(ctx, ox, oy, lounge.startCol + 1, lounge.startRow + 1) })
  }

  // Draw name labels at each agent's FIXED work + lounge spot
  const allDefs = allAgentDefs ?? []
  for (let defIdx = 0; defIdx < allDefs.length; defIdx++) {
    const def = allDefs[defIdx]
    const known = KNOWN_AGENTS[def.id]
    const idx = known?.fixedIndex ?? defIdx

    // Name plate at agent's work desk (permanent) — shows even when they're in lounge
    const { pos: workPos } = getTargetTileForAgent(def.id, 'working')
    const [wc, wr] = workPos
    const [wix, wiy] = toIso(wc, wr)
    const wsx = ox + wix
    const wsy = oy + wiy
    const isWorking = def.state === 'working' || def.state === 'active' || def.state === 'error'
    const stateColor = STATE_META[def.state]?.color || '#888'
    drawables.push({ sortY: wc + wr - 0.2, draw: () => {
      ctx.font = '9px "Heebo", "Segoe UI", sans-serif'
      ctx.textAlign = 'center'
      const label = def.name
      const tw = ctx.measureText(label).width + 18
      ctx.fillStyle = isWorking ? `${stateColor}25` : 'rgba(0,0,0,0.25)'
      ctx.beginPath()
      ctx.roundRect(wsx - tw / 2, wsy + 22, tw, 16, 4)
      ctx.fill()
      // Status dot
      ctx.beginPath()
      ctx.arc(wsx + tw / 2 - 8, wsy + 30, 3, 0, Math.PI * 2)
      ctx.fillStyle = stateColor
      ctx.fill()
      ctx.fillStyle = isWorking ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.3)'
      ctx.fillText(label, wsx - 2, wsy + 34)
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
    ctx.fillText(labels.editMode || 'Edit Mode', w / 2, 50)
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

function SettingsScreen({ onConnect, t, dir, toggleLang, lang, error }: {
  onConnect: (token: string, url: string) => void
  error?: string | null
  t: typeof translations[Lang]
  dir: string
  toggleLang: () => void
  lang: Lang
}) {
  const [token, setToken] = useState(localStorage.getItem('gateway-token') || '')
  const [url, setUrl] = useState(localStorage.getItem('gateway-url') || 'http://127.0.0.1:18789')

  const handleConnect = () => {
    localStorage.setItem('gateway-token', token)
    localStorage.setItem('gateway-url', url)
    onConnect(token, url)
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 14px', borderRadius: 8,
    border: '1px solid #3a3a5c', background: '#1e1e38', color: '#eee',
    fontSize: 15, outline: 'none', boxSizing: 'border-box', direction: 'ltr',
    fontFamily: '"Heebo", "Segoe UI", sans-serif',
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 14, color: '#9a9aca', marginBottom: 6, display: 'block', direction: 'rtl',
    fontFamily: '"Heebo", "Segoe UI", sans-serif', fontWeight: 500,
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#1a1a2e',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }}>
      <div style={{
        position: 'relative', background: '#1a1a30', borderRadius: 16, padding: 36, width: 400, maxWidth: '90vw',
        border: '1px solid #3a3a5c',
        boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
        fontFamily: '"Heebo", "Segoe UI", sans-serif',
      }}>
        <h1 style={{
          fontSize: 24, color: '#e0e0e0', textAlign: 'center', margin: '0 0 8px',
          fontWeight: 700, fontFamily: '"Heebo", "Segoe UI", sans-serif',
        }}>
          🏢 {t.virtualOffice}
        </h1>
        <p style={{ fontSize: 14, color: '#7a7aaa', textAlign: 'center', margin: '0 0 28px' }}>
          {t.setup}
        </p>
        {error && (
          <div style={{
            background: 'rgba(244, 67, 54, 0.15)', border: '1px solid rgba(244, 67, 54, 0.4)',
            borderRadius: 8, padding: '10px 14px', marginBottom: 16,
            color: '#ff6b6b', fontSize: 13, textAlign: 'center',
          }}>⚠️ {error}</div>
        )}
        <button onClick={toggleLang} style={{
          position: 'absolute', top: 12, right: 12, background: 'rgba(255,255,255,0.08)',
          border: '1px solid #3a3a5c', borderRadius: 8, padding: '4px 10px',
          color: '#9a9aca', fontSize: 12, cursor: 'pointer', fontFamily: '"Heebo", sans-serif',
        }}>{lang === 'he' ? 'EN' : 'עב'}</button>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>{t.gatewayToken}</label>
          <input
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder={t.tokenPlaceholder}
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: 24 }}>
          <label style={labelStyle}>{t.gatewayUrl}</label>
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
            width: '100%', padding: '14px 0', borderRadius: 10,
            background: token.trim() ? '#4a6aff' : '#333', color: '#fff',
            border: 'none', fontSize: 16, fontWeight: 600, cursor: token.trim() ? 'pointer' : 'default',
            marginBottom: 12, opacity: token.trim() ? 1 : 0.5,
            fontFamily: '"Heebo", "Segoe UI", sans-serif',
            transition: 'background 0.2s',
          }}
        >
          {t.connect}
        </button>


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
  const { lang, t, toggleLang, dir } = useI18n()
  const i18nRef = useRef(t)
  i18nRef.current = t
  updateTaskFallbacks(t)
  _i18nForTimeAgo = t
  _currentLang = lang
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

  // Seating overrides — drag & drop custom seat assignments
  const seatingOverridesRef = useRef<Record<string, { room: string; col: number; row: number }>>({})
  const [seatingLoaded, setSeatingLoaded] = useState(false)
  const dragAgentRef = useRef<{ agentId: string; startX: number; startY: number } | null>(null)

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
  const [agentsLoaded, setAgentsLoaded] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const pollFailCountRef = useRef(0)
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
        // Ctrl+scroll = zoom (pinch gesture on trackpad sends ctrlKey)
        const delta = -e.deltaY * 0.01
        userZoomRef.current = Math.min(3, Math.max(0.3, userZoomRef.current + delta))
      } else {
        // Scroll = zoom (mouse wheel), shift+scroll = horizontal pan
        if (e.shiftKey) {
          panRef.current.x -= e.deltaY / scaleRef.current
          clampPan(panRef.current)
        } else {
          const delta = -e.deltaY * 0.002
          userZoomRef.current = Math.min(3, Math.max(0.3, userZoomRef.current + delta))
        }
      }
    }
    canvas.addEventListener('wheel', handler, { passive: false })
    return () => canvas.removeEventListener('wheel', handler)
  }, [])

  // ── Load seating overrides from backend ──
  useEffect(() => {
    const backendBase = window.location.port === '5173' ? 'http://localhost:3001' : ''
    fetch(`${backendBase}/api/seating`)
      .then(r => r.json())
      .then(data => {
        if (data.ok && data.assignments) {
          seatingOverridesRef.current = data.assignments
          _seatingOverrides = data.assignments
          // Re-apply seating to existing agents
          for (const a of agentsRef.current) {
            const override = data.assignments[a.def.id]
            if (override) {
              a.tx = override.col
              a.ty = override.row
              a.x = override.col
              a.y = override.row
            }
          }
        }
        setSeatingLoaded(true)
      })
      .catch(() => setSeatingLoaded(true))
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
          body: JSON.stringify({ activeMinutes: 10080, messageLimit: 1 }), // 7 days — load ALL agents, minimal messages for speed
        })
        if (!res.ok) {
          pollFailCountRef.current++
          if (res.status === 401 || res.status === 403) {
            setConnectionError(lang === 'he' ? 'Gateway Token שגוי — בדוק את ההגדרות' : 'Invalid Gateway Token — check settings')
            setShowSettings(true)
            return
          }
          if (pollFailCountRef.current >= 3) {
            setConnectionError(lang === 'he' ? 'לא ניתן להתחבר ל-Gateway' : 'Cannot connect to Gateway')
            setShowSettings(true)
          }
          return
        }
        pollFailCountRef.current = 0
        setConnectionError(null)
        const data = await res.json()
        const sessions: any[] = data.sessions ?? []
        if (sessions.length === 0) {
          pollFailCountRef.current++
          if (pollFailCountRef.current >= 6) { // 30s with no agents
            setConnectionError(lang === 'he' ? 'לא נמצאו סוכנים — בדוק שה-Gateway פעיל ויש סוכנים מוגדרים' : 'No agents found — check Gateway is running and agents are configured')
          }
          return
        }

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
          setAgentsLoaded(true)
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
            const { pos: newPos, room: newRoom } = getTargetTileForAgent(a.def.id, newState)
            a.room = newRoom
            const [ntx, nty] = newPos
            // Generate L-shaped walk path for smooth movement between rooms
            if (Math.abs(a.x - ntx) > 0.5 || Math.abs(a.y - nty) > 0.5) {
              a.path = {
                waypoints: findPath([Math.round(a.x), Math.round(a.y)], [ntx, nty]),
                currentWaypoint: 0,
              }
            }
            a.tx = ntx
            a.ty = nty
            defsChanged = true

            // Notification: agent finished working (working/active → idle/offline)
            if ((oldState === 'working' || oldState === 'active') && (newState === 'idle' || newState === 'offline')) {
              const notif: OfficeNotification = {
                id: `${a.def.id}-${Date.now()}`,
                agentName: a.def.name,
                agentEmoji: a.def.emoji,
                message: i18nRef.current.taskCompleted,
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
      } catch (err) {
        pollFailCountRef.current++
        if (pollFailCountRef.current >= 3) {
          setConnectionError(lang === 'he' ? 'לא ניתן להתחבר ל-Gateway — בדוק את הכתובת' : 'Cannot reach Gateway — check URL')
          setShowSettings(true)
        }
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

      // Move agents along paths (waypoint-based) or lerp to final target
      const agents = agentsRef.current
      const deltaTime = 1 / 60 // ~60fps
      for (const a of agents) {
        if (a.path && a.path.currentWaypoint < a.path.waypoints.length) {
          // Walk along waypoints at constant speed
          const [wx, wy] = a.path.waypoints[a.path.currentWaypoint]
          const dx = wx - a.x
          const dy = wy - a.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 0.15) {
            // Reached waypoint — advance to next
            a.path.currentWaypoint++
            if (a.path.currentWaypoint >= a.path.waypoints.length) {
              // Path complete — snap to final target
              a.x = a.tx
              a.y = a.ty
              a.path = null
            }
          } else {
            const step = AGENT_MOVE_SPEED * deltaTime
            const move = Math.min(step, dist)
            a.x += (dx / dist) * move
            a.y += (dy / dist) * move
          }
        } else {
          // No path — lerp to target (fallback for initial placement)
          const dx = a.tx - a.x
          const dy = a.ty - a.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist > 0.3) {
            a.x += dx * 0.08
            a.y += dy * 0.08
          } else {
            a.x = a.tx
            a.y = a.ty
            a.path = null
          }
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
      const tr = i18nRef.current
      drawScene(offCtx, w, h, t, agents, hoverAgentIdRef.current, selectedIdRef.current, panRef.current.x, panRef.current.y, fonts, decorationsRef.current, editState, agentDefsRef.current, { loungeZone: tr.loungeZone, workZone: tr.workZone, errorZone: tr.errorZone, virtualOffice: `🏢 ${tr.virtualOffice}`, active: tr.active, working: tr.working, idle: tr.idle, offline: tr.offline, error: tr.error, editMode: tr.editMode })

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

  const wasPanningRef = useRef(false)
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Skip click after pan drag
    if (wasPanningRef.current) { wasPanningRef.current = false; return }
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

  // Pan-by-drag state
  const panDragRef = useRef<{ startX: number; startY: number; startPanX: number; startPanY: number } | null>(null)

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const [mx, my] = screenToCanvas(e.clientX, e.clientY, rect)
    const { ox, oy } = originRef.current

    // Edit mode: drag decorations
    if (editModeRef.current) {
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
        return
      }
    }

    // Normal mode: check if clicking an agent (for drag & drop seating)
    const agent = hitTestAgent(mx, my, agentsRef.current, ox, oy)
    if (agent && editModeRef.current) {
      // Start agent drag in edit mode
      dragAgentRef.current = { agentId: agent.def.id, startX: mx, startY: my }
      e.currentTarget.style.cursor = 'move'
      e.preventDefault()
      return
    }
    if (!agent) {
      panDragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startPanX: panRef.current.x,
        startPanY: panRef.current.y,
      }
      e.currentTarget.style.cursor = 'grabbing'
    }
  }, [screenToCanvas])

  const handleMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Agent drag (edit mode) — move agent sprite to follow cursor
    if (dragAgentRef.current) {
      const rect = e.currentTarget.getBoundingClientRect()
      const [mx, my] = screenToCanvas(e.clientX, e.clientY, rect)
      const { ox, oy } = originRef.current
      // Convert screen to tile coords for agent position
      const tileX = (mx - ox) / TILE_W + (my - oy) / TILE_H
      const tileY = (my - oy) / TILE_H - (mx - ox) / TILE_W
      const agent = agentsRef.current.find(a => a.def.id === dragAgentRef.current!.agentId)
      if (agent) {
        agent.x = tileX
        agent.y = tileY
        agent.path = null // cancel any active path
      }
      e.currentTarget.style.cursor = 'move'
      return
    }

    // Pan drag (normal mode)
    if (panDragRef.current) {
      const dx = (e.clientX - panDragRef.current.startX) / scaleRef.current
      const dy = (e.clientY - panDragRef.current.startY) / scaleRef.current
      panRef.current.x = panDragRef.current.startPanX + dx
      panRef.current.y = panDragRef.current.startPanY + dy
      clampPan(panRef.current)
      e.currentTarget.style.cursor = 'grabbing'
      return
    }

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

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Agent drag drop — save new seating position
    if (dragAgentRef.current) {
      const agent = agentsRef.current.find(a => a.def.id === dragAgentRef.current!.agentId)
      if (agent) {
        const col = Math.round(agent.x)
        const row = Math.round(agent.y)
        const room = getRoomAt(col, row)
        const roomId = room?.id ?? 'openspace'
        // Snap to grid
        agent.x = col
        agent.y = row
        agent.tx = col
        agent.ty = row
        agent.room = roomId
        agent.path = null
        // Save to backend
        const override = { room: roomId, col, row }
        seatingOverridesRef.current[agent.def.id] = override
        _seatingOverrides[agent.def.id] = override
        const backendBase = window.location.port === '5173' ? 'http://localhost:3001' : ''
        fetch(`${backendBase}/api/seating`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId: agent.def.id, ...override }),
        }).catch(err => console.error('Failed to save seating:', err))
      }
      dragAgentRef.current = null
      e.currentTarget.style.cursor = 'default'
      return
    }
    if (panDragRef.current) {
      const dx = Math.abs(e.clientX - panDragRef.current.startX)
      const dy = Math.abs(e.clientY - panDragRef.current.startY)
      if (dx > 5 || dy > 5) wasPanningRef.current = true
      panDragRef.current = null
      e.currentTarget.style.cursor = 'default'
    }
    if (dragRef.current) {
      if (dragRef.current.moved) {
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
    setConnectionError(null)
    pollFailCountRef.current = 0
    discoveredRef.current = false
    setAgentsLoaded(false)
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
      .map((m: any, i: number) => {
        const text = (m.text || m.content || m.preview || '').substring(0, 2000)
        // Detect inter-agent messages (from sessions_send)
        const interAgentMatch = text.match(/^\[Inter-session message\] sourceSession=agent:([^:\s]+)/)
        const isInterAgent = interAgentMatch || text.startsWith('[Inter-session')
        const senderName = interAgentMatch?.[1] || undefined
        // Clean inter-agent prefix from displayed text
        const cleanText = isInterAgent
          ? text.replace(/^\[Inter-session message\][^\n]*\n?/, '').trim()
          : text
        return {
          id: m.id || `hist-${i}-${m.timestamp || i}`,
          role: (isInterAgent ? 'agent' : m.role) as 'user' | 'assistant' | 'agent',
          text: cleanText,
          ts: m.timestamp ? new Date(m.timestamp).getTime() : Date.now() - (history.length - i) * 1000,
          source: m.channel || m.source || undefined,
          senderName,
        }
      })
      .filter((m: ChatMessage) => m.text.length > 0)
      .filter(isVisibleMessage)
  }, [gatewayToken, gatewayUrl, getBackendBase])

  const selectedAgent = agentDefs.find(a => a.id === selectedId) ?? null

    // Show settings screen
  if (showSettings) {
    return <SettingsScreen onConnect={handleConnect} t={t} dir={dir} toggleLang={toggleLang} lang={lang} error={connectionError} />
  }

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden', direction: dir as any }}>
      {/* Global pixel art styles */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600;700&display=swap');
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
      {(!canvasReady || !agentsLoaded) && !showSettings && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 50,
          background: '#1a1a2e', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 20,
          fontFamily: '"Heebo", "Segoe UI", sans-serif',
        }}>
          <div style={{ fontSize: 56 }}>🏢</div>
          <div style={{ color: '#c0c0e0', fontSize: 18, fontWeight: 600 }}>{t.loading}</div>
          <div style={{
            width: 200, height: 6, background: '#2a2a4a', borderRadius: 3, overflow: 'hidden',
          }}>
            <div style={{
              width: '100%', height: '100%', background: 'linear-gradient(90deg, #4a6aff, #7a9aff)',
              borderRadius: 3, animation: 'loading 1.5s ease-in-out infinite',
            }} />
          </div>
          <div style={{ color: '#7a7aaa', fontSize: 13 }}>{t.connectingAgents}</div>
        </div>
      )}
      {/* Language toggle — main UI */}
      <button onClick={toggleLang} style={{
        position: 'absolute', top: 12, left: 12, zIndex: 40,
        background: 'rgba(26, 26, 46, 0.8)', border: '1px solid #3a3a5c',
        borderRadius: 8, padding: '6px 12px', color: '#c0c0e0', fontSize: 13,
        cursor: 'pointer', fontFamily: '"Heebo", sans-serif', backdropFilter: 'blur(8px)',
        transition: 'background 0.2s',
      }}>{lang === 'he' ? 'EN' : 'עב'}</button>
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
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
              fontFamily: '"Heebo", "Segoe UI", sans-serif',
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
          color: '#aaa', fontFamily: '"Heebo", "Segoe UI", sans-serif',
          boxShadow: 'inset -2px -2px 0 #0a0a1a, inset 2px 2px 0 #2a2a4a',
        }}
        title={t.settings}
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
          fontFamily: '"Heebo", "Segoe UI", sans-serif',
          boxShadow: 'inset -2px -2px 0 #0a0a1a, inset 2px 2px 0 #2a2a4a',
        }}
        title={soundEnabled ? t.muteSound : t.enableSound}
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
          fontFamily: '"Heebo", "Segoe UI", sans-serif',
          boxShadow: 'inset -2px -2px 0 #0a0a1a, inset 2px 2px 0 #2a2a4a',
          zIndex: 20,
        }}
        title={dashboardMode ? t.backToOffice : t.dashboard}
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
          fontFamily: '"Heebo", "Segoe UI", sans-serif',
          boxShadow: 'inset -2px -2px 0 #0a0a1a, inset 2px 2px 0 #2a2a4a',
        }}
      >
        {t.designOffice}
      </button>

      {/* Edit mode toolbar */}
      {editMode && (
        <div style={{
          position: 'absolute', top: 52, left: 12,
          background: 'rgba(30,30,55,0.95)', border: '2px solid #3a3a5c',
          borderRadius: 0, padding: '8px 12px', display: 'flex', gap: 8,
          alignItems: 'center', direction: 'rtl',
          fontFamily: '"Heebo", "Segoe UI", sans-serif',
          boxShadow: 'inset -2px -2px 0 #0a0a1a, inset 2px 2px 0 #2a2a4a',
        }}>
          <span style={{ color: '#aaf', fontSize: 8, fontWeight: 600 }}>{t.editMode}</span>
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
                fontFamily: '"Heebo", "Segoe UI", sans-serif',
                boxShadow: 'inset -2px -2px 0 #0a0a1a, inset 2px 2px 0 #4a2a2a',
              }}
            >
              {t.delete}
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
              fontFamily: '"Heebo", "Segoe UI", sans-serif',
              boxShadow: 'inset -2px -2px 0 #0a0a1a, inset 2px 2px 0 #2a2a4a',
            }}
          >
            {t.reset}
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
          fontFamily: '"Heebo", "Segoe UI", sans-serif',
          boxShadow: 'inset -2px -2px 0 #0a0a1a, inset 2px 2px 0 #2a2a4a',
        }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4,
          }}>
            {getDecoTypes().map(dt => (
              <button
                key={dt.type}
                onClick={() => setPlacementType(prev => prev === dt.type ? null : dt.type)}
                style={{
                  background: placementType === dt.type ? 'rgba(100,100,255,0.4)' : 'rgba(255,255,255,0.05)',
                  border: placementType === dt.type ? '2px solid rgba(100,100,255,0.6)' : '2px solid transparent',
                  borderRadius: 0, padding: '6px 4px', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  color: '#ccc', fontSize: 7, fontFamily: '"Heebo", "Segoe UI", sans-serif',
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
          fontFamily: '"Heebo", "Segoe UI", sans-serif',
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
        fontFamily: '"Heebo", "Segoe UI", sans-serif',
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
                  {STATE_META[selectedAgent.state].dot} {t[selectedAgent.state]}
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#888', display: 'flex', gap: 8, marginTop: 2 }}>
                <span>{(() => { const r = ROOM_MAP.get(getWorkRoom(selectedAgent.id)); return r ? `${r.emoji} ${r.label}` : '🏢 Office' })()}</span>
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
            t={t}
          />
        </div>
      )}
    </div>
  )
}

let _i18nForTimeAgo: typeof translations[Lang] = translations.he
function timeAgo(ts: number | undefined): string {
  const t = _i18nForTimeAgo
  if (!ts) return t.unknown
  const diff = Date.now() - ts
  if (diff < 60_000) return t.now
  if (diff < 3_600_000) return t.minutesAgo.replace('{n}', String(Math.floor(diff / 60_000)))
  if (diff < 86_400_000) return t.hoursAgo.replace('{n}', String(Math.floor(diff / 3_600_000)))
  return t.daysAgo.replace('{n}', String(Math.floor(diff / 86_400_000)))
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
    <InfoBox label={_i18nForTimeAgo.currentTask}>
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
          {expanded ? '▲' : '▼'}
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

function ChatInput({ agentId, agentColor, compact, onSend, onFetchHistory, t }: {
  agentId: string
  agentColor: string
  compact?: boolean
  onSend?: (agentId: string, message: string) => Promise<void> | void
  onFetchHistory?: (agentId: string, after?: number) => Promise<ChatMessage[]>
  t: typeof translations[Lang]
}) {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<SendStatus>('idle')
  const [isRecording, setIsRecording] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
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
          const deduped = deduplicateMessages(history)
          globalChatCache[agentId] = deduped
          setMessages(deduped)
        }
      }).catch(() => {})
    }
  }, [agentId, onFetchHistory])

  // Auto-scroll to bottom — instant on first load, no scroll animation
  const prevMsgCountRef = useRef(0)
  useEffect(() => {
    if (!scrollRef.current) return
    const el = scrollRef.current
    // Only auto-scroll if user is near bottom (within 150px) or it's first load
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150
    const isFirstLoad = prevMsgCountRef.current === 0 && messages.length > 0
    if (isNearBottom || isFirstLoad) {
      el.scrollTop = el.scrollHeight
    }
    prevMsgCountRef.current = messages.length
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
            const existingTexts = new Set(current.map(m => `${m.role}:${m.text.substring(0, 100)}`))
            const newMsgs = history.filter(m => {
              if (existingIds.has(m.id)) return false
              // Deduplicate by role+text — prevents duplicates from WS + poll race
              const textKey = `${m.role}:${m.text.substring(0, 100)}`
              if (existingTexts.has(textKey)) return false
              return m.ts > lastTs
            })
            if (newMsgs.length > 0) {
              const merged = deduplicateMessages([...current, ...newMsgs])
              globalChatCache[agentId] = merged
              setMessages(merged)
              if (newMsgs[newMsgs.length - 1]?.role === 'assistant') {
                setPolling(false)
                setStreamText('')
              }
            }
          } else {
            const deduped = deduplicateMessages(history)
            globalChatCache[agentId] = deduped
            setMessages(deduped)
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

  // Voice recording
  const handleMicToggle = useCallback(async () => {
    if (isRecording) {
      // Stop recording
      mediaRecorderRef.current?.stop()
      setIsRecording(false)
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
      audioChunksRef.current = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        if (blob.size < 100) return
        // Transcribe
        setStatus('sending')
        try {
          const backendBase = window.location.port === '5173' ? 'http://localhost:3001' : ''
          const form = new FormData()
          form.append('audio', blob, 'recording.webm')
          const res = await fetch(`${backendBase}/api/transcribe`, { method: 'POST', body: form })
          const data = await res.json()
          if (data.ok && data.text) {
            setText(prev => prev ? `${prev} ${data.text}` : data.text)
          }
        } catch (err) { console.error('Transcription failed:', err) }
        setStatus('idle')
      }
      recorder.start()
      mediaRecorderRef.current = recorder
      setIsRecording(true)
    } catch (err) { console.error('Mic access denied:', err) }
  }, [isRecording])

  // File attachment
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // For images, convert to base64 and send as text with markdown image
    if (file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        const attachText = `📎 [${file.name}]\n![${file.name}](${dataUrl})`
        setText(prev => prev ? `${prev}\n${attachText}` : attachText)
      }
      reader.readAsDataURL(file)
    } else {
      setText(prev => prev ? `${prev}\n📎 ${file.name}` : `📎 ${file.name}`)
    }
    e.target.value = '' // reset
  }, [])

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

      }}>
        {messages.length === 0 && !streamText && (
          <div style={{ textAlign: 'center', color: '#555', fontSize: 13, marginTop: 40 }}>
            💬 {t.sendMessage}
          </div>
        )}
        {messages.map(msg => {
          const isAgent = msg.role === 'agent'
          const isUser = msg.role === 'user'
          const align = isUser ? 'flex-start' : isAgent ? 'center' : 'flex-end'
          const bgColor = isUser ? 'rgba(60, 60, 120, 0.5)'
            : isAgent ? 'rgba(255, 165, 0, 0.15)' // orange tint for inter-agent
            : 'rgba(255,255,255,0.06)'
          const borderColor = isUser ? '1px solid rgba(80,80,150,0.3)'
            : isAgent ? '1px solid rgba(255, 165, 0, 0.3)'
            : `1px solid ${agentColor}33`
          const borderRadius = isUser ? '12px 12px 4px 12px'
            : isAgent ? '8px' : '12px 12px 12px 4px'
          return (
          <div key={msg.id} style={{
            alignSelf: align,
            maxWidth: isAgent ? '90%' : '80%',
          }}>
            {isAgent && msg.senderName && (
              <div style={{ fontSize: 10, color: '#f0a030', marginBottom: 2, textAlign: 'center' }}>
                🤖 {msg.senderName}
              </div>
            )}
            <div style={{
              padding: '8px 12px',
              borderRadius,
              background: bgColor,
              border: borderColor,
              color: '#e0e0e0', fontSize: 13, lineHeight: 1.6, wordBreak: 'break-word',
            }}>
              {renderMarkdown(msg.text)}
            </div>
            <div style={{
              fontSize: 10, color: '#666', marginTop: 2,
              textAlign: isUser ? 'left' : 'right',
              padding: '0 4px', display: 'flex', gap: 3,
              justifyContent: isUser ? 'flex-start' : 'flex-end',
            }}>
              {msg.ts ? formatTime(msg.ts) : ''}
              {isUser && msg.id.startsWith('local-') && ' ✓✓'}
            </div>
          </div>
        )})}
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
          placeholder={t.typeMessage}
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
        {/* Attachment button */}
        <input type="file" ref={fileInputRef} onChange={handleFileSelect} style={{ display: 'none' }}
          accept="image/*,video/*,.pdf,.doc,.docx,.txt" />
        <button
          onClick={() => fileInputRef.current?.click()}
          style={{
            width: 36, height: 36, borderRadius: 8, border: 'none',
            background: 'rgba(255,255,255,0.06)', color: '#888',
            fontSize: 18, cursor: 'pointer', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.2s',
          }}
          title={t.attachFile}
        >📎</button>
        {/* Mic button */}
        <button
          onClick={handleMicToggle}
          style={{
            width: 36, height: 36, borderRadius: 8, border: 'none',
            background: isRecording ? '#ef4444' : 'rgba(255,255,255,0.06)',
            color: isRecording ? '#fff' : '#888',
            fontSize: 18, cursor: 'pointer', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.3s',
            animation: isRecording ? 'chatBlink 1s ease-in-out infinite' : 'none',
          }}
          title={isRecording ? t.stopRecording : t.recordVoice}
        >{isRecording ? '⏹' : '🎤'}</button>
        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!text.trim() || status === 'sending'}
          style={{
            width: 40, height: 40, borderRadius: 8,
            border: 'none',
            background: text.trim() && status !== 'sending' ? '#22c55e' : 'rgba(255,255,255,0.08)',
            color: '#fff', fontSize: 18,
            cursor: text.trim() && status !== 'sending' ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, transition: 'background 0.3s, transform 0.15s',
            transform: text.trim() ? 'scale(1.05)' : 'scale(1)',
          }}
          title={t.send}
        >
          {status === 'sending' ? (
            <span style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'chatSpin 0.6s linear infinite' }} />
          ) : '▶'}
        </button>
      </div>
    </div>
  )
}
