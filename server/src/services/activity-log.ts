/**
 * Activity Log — tracks agent state changes
 * 
 * Ring buffer with configurable max size.
 * Used by the poller to record transitions and by the API to serve history.
 */

export interface ActivityEvent {
  id: string;
  agentId: string;
  agentName: string;
  agentEmoji: string;
  type: 'state-change' | 'zone-change' | 'error' | 'recovery';
  fromState?: string;
  toState?: string;
  fromZone?: string;
  toZone?: string;
  detail?: string;
  timestamp: number;
}

const MAX_EVENTS = 1000;
const events: ActivityEvent[] = [];
let eventCounter = 0;

/**
 * Record an activity event
 */
export function recordActivity(event: Omit<ActivityEvent, 'id'>): ActivityEvent {
  const full: ActivityEvent = {
    ...event,
    id: `evt-${++eventCounter}-${Date.now()}`,
  };
  events.push(full);

  // Trim ring buffer
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }

  return full;
}

/**
 * Get recent activity (newest first)
 */
export function getRecentActivity(limit = 50): ActivityEvent[] {
  return events.slice(-limit).reverse();
}

/**
 * Get activity for a specific agent (newest first)
 */
export function getAgentActivity(agentId: string, limit = 50): ActivityEvent[] {
  return events
    .filter((e) => e.agentId === agentId)
    .slice(-limit)
    .reverse();
}

/**
 * Get activity since a timestamp
 */
export function getActivitySince(since: number, limit = 100): ActivityEvent[] {
  return events
    .filter((e) => e.timestamp > since)
    .slice(-limit)
    .reverse();
}

/**
 * Get activity stats
 */
export function getActivityStats() {
  const now = Date.now();
  const last5min = events.filter((e) => now - e.timestamp < 5 * 60_000).length;
  const lastHour = events.filter((e) => now - e.timestamp < 60 * 60_000).length;

  // Count by type
  const byType: Record<string, number> = {};
  for (const e of events) {
    byType[e.type] = (byType[e.type] ?? 0) + 1;
  }

  return {
    total: events.length,
    maxCapacity: MAX_EVENTS,
    last5min,
    lastHour,
    byType,
  };
}

/**
 * Clear all events (for testing)
 */
export function clearActivity(): void {
  events.length = 0;
  eventCounter = 0;
}
