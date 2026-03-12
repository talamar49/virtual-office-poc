/**
 * Status Poller — v2
 * 
 * Polls Gateway every 5s, diffs state, broadcasts changes.
 * Maps agents to zones: work / lounge / bugzone.
 */

import { fetchSessions } from './gateway-client.js';
import { getAgentMeta, getAllAgentIds, fromGatewayAgentId, type Zone } from '../config/agents.js';

// --- Types ---

export type AgentState = 'working' | 'talking' | 'idle' | 'offline' | 'error';

export interface AgentStatus {
  id: string;
  name: string;
  role: string;
  emoji: string;
  hasSprite: boolean;
  state: AgentState;
  zone: Zone;
  lastActivity: string | null;
  lastMessage: {
    role: string;
    preview: string;
    timestamp: string;
  } | null;
  model: string | null;
  tokenUsage: number;
  sessionKey: string | null;
}

export interface StatusUpdate {
  agentId: string;
  changes: Partial<AgentStatus>;
  previousState?: AgentState;
  previousZone?: Zone;
}

type BroadcastFn = (type: string, data: unknown) => void;

// --- Constants ---
const POLL_INTERVAL_MS = 5_000;

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;
let broadcastFn: BroadcastFn | null = null;
const stateMap = new Map<string, AgentStatus>();

// --- Status Derivation (v2 spec) ---

/**
 * Derive agent state from session data.
 * 
 * v2 rules:
 * - updatedAt < 30s + toolCall → working
 * - updatedAt < 30s + lastMsg role=user → talking
 * - updatedAt < 5min → idle
 * - updatedAt > 5min → offline
 * - abortedLastRun=true → error
 */
function deriveState(session: any): AgentState {
  // Error state takes priority
  if (session.abortedLastRun === true) return 'error';

  const age = Date.now() - (session.updatedAt ?? 0);
  if (!session.updatedAt) return 'offline';

  if (age < 30_000) {
    const lastMsg = session.messages?.[0];
    if (lastMsg?.role === 'assistant') {
      const content = lastMsg.content;
      if (Array.isArray(content)) {
        if (content.some((b: any) => b.type === 'tool_use' || b.type === 'toolCall')) return 'working';
      }
    }
    if (lastMsg?.role === 'user') return 'talking';
    return 'working'; // active within 30s = working
  }

  if (age < 5 * 60_000) return 'idle';
  return 'offline';
}

/**
 * Map state to zone
 */
function stateToZone(state: AgentState): Zone {
  switch (state) {
    case 'working':
    case 'talking':
      return 'work';
    case 'error':
      return 'bugzone';
    case 'idle':
    case 'offline':
    default:
      return 'lounge';
  }
}

/**
 * Extract last message preview
 */
function extractLastMessage(session: any): AgentStatus['lastMessage'] {
  const msg = session.messages?.[0];
  if (!msg?.content) return null;

  let preview = '';
  if (typeof msg.content === 'string') {
    preview = msg.content;
  } else if (Array.isArray(msg.content)) {
    const textBlock = msg.content.find((b: any) => b.type === 'text');
    preview = textBlock?.text ?? '';
  }

  return {
    role: msg.role ?? 'unknown',
    preview: preview.substring(0, 200),
    timestamp: msg.timestamp ? new Date(msg.timestamp).toISOString() : new Date().toISOString(),
  };
}

/**
 * Build AgentStatus from session data
 */
function buildStatus(agentId: string, session: any | null): AgentStatus {
  const meta = getAgentMeta(agentId);

  if (!session) {
    return {
      ...meta,
      state: 'offline',
      zone: 'lounge',
      lastActivity: null,
      lastMessage: null,
      model: null,
      tokenUsage: 0,
      sessionKey: null,
    };
  }

  const state = deriveState(session);
  return {
    ...meta,
    state,
    zone: stateToZone(state),
    lastActivity: session.updatedAt ? new Date(session.updatedAt).toISOString() : null,
    lastMessage: extractLastMessage(session),
    model: session.model ?? null,
    tokenUsage: session.totalTokens ?? 0,
    sessionKey: session.key ?? null,
  };
}

/**
 * Compute diffs between states
 */
function computeDiffs(oldS: AgentStatus, newS: AgentStatus): Partial<AgentStatus> | null {
  const changes: Partial<AgentStatus> = {};
  let hasChanges = false;

  const keys: (keyof AgentStatus)[] = ['state', 'zone', 'lastActivity', 'model', 'tokenUsage', 'sessionKey'];
  for (const key of keys) {
    if (oldS[key] !== newS[key]) {
      (changes as any)[key] = newS[key];
      hasChanges = true;
    }
  }

  if (JSON.stringify(oldS.lastMessage) !== JSON.stringify(newS.lastMessage)) {
    changes.lastMessage = newS.lastMessage;
    hasChanges = true;
  }

  return hasChanges ? changes : null;
}

/**
 * Single poll cycle
 */
async function pollCycle(): Promise<void> {
  try {
    const sessions = await fetchSessions(120);

    // Group by agent, keep most recent
    const sessionByAgent = new Map<string, any>();
    for (const session of sessions) {
      const keyParts = (session.key || '').split(':');
      const rawAgentId = keyParts[1] || 'unknown';
      const agentId = fromGatewayAgentId(rawAgentId);

      const existing = sessionByAgent.get(agentId);
      if (!existing || (session.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
        sessionByAgent.set(agentId, session);
      }
    }

    // Build statuses and diff
    const updates: StatusUpdate[] = [];
    const allIds = new Set([...getAllAgentIds(), ...sessionByAgent.keys()]);

    for (const agentId of allIds) {
      // Skip agents not in our v2 registry
      if (!getAllAgentIds().includes(agentId) && !sessionByAgent.has(agentId)) continue;

      const session = sessionByAgent.get(agentId) ?? null;
      const newStatus = buildStatus(agentId, session);
      const oldStatus = stateMap.get(agentId);

      if (!oldStatus) {
        stateMap.set(agentId, newStatus);
        updates.push({ agentId, changes: newStatus });
        continue;
      }

      const diff = computeDiffs(oldStatus, newStatus);
      if (diff) {
        updates.push({
          agentId,
          changes: diff,
          previousState: oldStatus.state,
          previousZone: oldStatus.zone,
        });
        stateMap.set(agentId, newStatus);
      }
    }

    if (updates.length > 0) {
      broadcastFn?.('agent:update', updates);
    }
  } catch (err) {
    console.error('[Poller] Poll failed:', (err as Error).message);
  }
}

/**
 * Schedule next poll
 */
function scheduleNext(): void {
  if (!isRunning) return;
  pollTimer = setTimeout(async () => {
    await pollCycle();
    scheduleNext();
  }, POLL_INTERVAL_MS);
}

// --- Public API ---

export function startPoller(broadcast: BroadcastFn): void {
  if (isRunning) return;
  broadcastFn = broadcast;
  isRunning = true;
  console.log(`[Poller] Started — polling every ${POLL_INTERVAL_MS / 1000}s`);
  pollCycle().then(() => scheduleNext());
}

export function stopPoller(): void {
  isRunning = false;
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  console.log('[Poller] Stopped');
}

export function getFullState(): AgentStatus[] {
  if (stateMap.size === 0) {
    for (const id of getAllAgentIds()) {
      stateMap.set(id, buildStatus(id, null));
    }
  }
  return Array.from(stateMap.values());
}

export function getAgentStatus(agentId: string): AgentStatus | null {
  return stateMap.get(agentId) ?? null;
}

export function getPollerStats() {
  return {
    isRunning,
    intervalMs: POLL_INTERVAL_MS,
    trackedAgents: stateMap.size,
  };
}
