/**
 * Seating API — persistent agent seat assignments
 * GET  /api/seating         → { assignments: Record<agentId, { room, col, row }> }
 * POST /api/seating         → body: { agentId, room, col, row } → saves assignment
 * DELETE /api/seating/:id   → removes assignment (agent returns to default)
 *
 * Security: POST/DELETE require X-Gateway-Token header (any non-empty token)
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

export const seatingRouter: ReturnType<typeof Router> = Router();

interface SeatAssignment {
  room: string;
  col: number;
  row: number;
}

type SeatingMap = Record<string, SeatAssignment>;

const DATA_DIR = join(process.env.HOME || '/tmp', '.virtual-office');
const SEATING_FILE = join(DATA_DIR, 'seating.json');

// Allowed room names (whitelist)
const VALID_ROOMS = new Set(['work', 'lounge', 'meeting', 'reception', 'coffee']);

// agentId: only alphanumeric + dash/underscore, max 64 chars
function isValidAgentId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}

// Auth middleware — require X-Gateway-Token header for write operations
function requireToken(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers['x-gateway-token'];
  if (!token || typeof token !== 'string' || token.trim().length < 4) {
    res.status(401).json({ error: 'Unauthorized — X-Gateway-Token required' });
    return;
  }
  next();
}

async function loadSeating(): Promise<SeatingMap> {
  try {
    const data = await readFile(SEATING_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    // Validate shape — only keep entries with valid agentIds
    const clean: SeatingMap = {};
    for (const [id, val] of Object.entries(parsed)) {
      if (isValidAgentId(id) && val && typeof val === 'object') {
        clean[id] = val as SeatAssignment;
      }
    }
    return clean;
  } catch {
    return {};
  }
}

async function saveSeating(map: SeatingMap): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(SEATING_FILE, JSON.stringify(map, null, 2));
}

// GET /api/seating — all assignments (public read)
seatingRouter.get('/', async (_req: any, res: any) => {
  const assignments = await loadSeating();
  res.json({ ok: true, assignments });
});

// POST /api/seating — assign agent to seat (requires auth)
seatingRouter.post('/', requireToken, async (req: any, res: any) => {
  const { agentId, room, col, row } = req.body;

  if (!agentId || room === undefined || col === undefined || row === undefined) {
    res.status(400).json({ error: 'Missing agentId, room, col, or row' });
    return;
  }

  // Validate agentId
  if (!isValidAgentId(String(agentId))) {
    res.status(400).json({ error: 'Invalid agentId — only alphanumeric, dash, underscore allowed' });
    return;
  }

  // Validate room
  const roomStr = String(room).toLowerCase();
  if (!VALID_ROOMS.has(roomStr)) {
    res.status(400).json({ error: `Invalid room — must be one of: ${[...VALID_ROOMS].join(', ')}` });
    return;
  }

  // Validate col/row — positive integers only
  const colNum = parseInt(String(col), 10);
  const rowNum = parseInt(String(row), 10);
  if (isNaN(colNum) || colNum < 0 || colNum > 50 || isNaN(rowNum) || rowNum < 0 || rowNum > 50) {
    res.status(400).json({ error: 'Invalid col/row — must be integers 0–50' });
    return;
  }

  const assignments = await loadSeating();
  assignments[String(agentId)] = { room: roomStr, col: colNum, row: rowNum };
  await saveSeating(assignments);
  res.json({ ok: true, assignment: { agentId, room: roomStr, col: colNum, row: rowNum } });
});

// DELETE /api/seating/:id — remove assignment (requires auth)
seatingRouter.delete('/:id', requireToken, async (req: any, res: any) => {
  const { id } = req.params;

  if (!isValidAgentId(id)) {
    res.status(400).json({ error: 'Invalid agentId format' });
    return;
  }

  const assignments = await loadSeating();
  delete assignments[id];
  await saveSeating(assignments);
  res.json({ ok: true });
});
