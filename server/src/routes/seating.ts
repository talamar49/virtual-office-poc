/**
 * Seating API — persistent agent seat assignments
 * GET  /api/seating         → { assignments: Record<agentId, { room, col, row }> }
 * POST /api/seating         → body: { agentId, room, col, row } → saves assignment
 * DELETE /api/seating/:id   → removes assignment (agent returns to default)
 */
import { Router } from 'express';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';

export const seatingRouter: ReturnType<typeof Router> = Router();

interface SeatAssignment {
  room: string;
  col: number;
  row: number;
}

type SeatingMap = Record<string, SeatAssignment>;

const DATA_DIR = join(process.env.HOME || '/tmp', '.virtual-office');
const SEATING_FILE = join(DATA_DIR, 'seating.json');

async function loadSeating(): Promise<SeatingMap> {
  try {
    const data = await readFile(SEATING_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveSeating(map: SeatingMap): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(SEATING_FILE, JSON.stringify(map, null, 2));
}

// GET /api/seating — all assignments
seatingRouter.get('/', async (_req: any, res: any) => {
  const assignments = await loadSeating();
  res.json({ ok: true, assignments });
});

// POST /api/seating — assign agent to seat
seatingRouter.post('/', async (req: any, res: any) => {
  const { agentId, room, col, row } = req.body;
  if (!agentId || room === undefined || col === undefined || row === undefined) {
    res.status(400).json({ error: 'Missing agentId, room, col, or row' });
    return;
  }
  const assignments = await loadSeating();
  assignments[agentId] = { room, col, row };
  await saveSeating(assignments);
  res.json({ ok: true, assignment: { agentId, room, col, row } });
});

// DELETE /api/seating/:id — remove assignment
seatingRouter.delete('/:id', async (req: any, res: any) => {
  const { id } = req.params;
  const assignments = await loadSeating();
  delete assignments[id];
  await saveSeating(assignments);
  res.json({ ok: true });
});
