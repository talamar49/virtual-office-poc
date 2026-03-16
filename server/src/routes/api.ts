/**
 * REST API Routes — v2
 */

import { Router } from 'express';
import { getFullState, getAgentStatus, getPollerStats } from '../services/status-poller.js';
import { checkGatewayHealth, getCircuitStatus } from '../services/gateway-client.js';
import { getClientCount, getWsStats } from '../ws/handler.js';
import { AGENT_REGISTRY, getAgentMeta } from '../config/agents.js';
import { getRecentActivity, getAgentActivity, getActivitySince, getActivityStats } from '../services/activity-log.js';
import { getRateLimitStats } from '../middleware/rate-limit.js';
import { getNotifications, markRead, markAllRead, getNotificationStats } from '../services/notifications.js';
import { getAllMetrics } from '../services/metrics.js';

export const apiRouter: ReturnType<typeof Router> = Router();

/**
 * GET /api/health
 */
apiRouter.get('/health', async (_req, res) => {
  try {
    const gateway = await checkGatewayHealth();
    const poller = getPollerStats();

    res.json({
      status: gateway.ok ? 'ok' : 'degraded',
      uptime: process.uptime(),
      wsClients: getClientCount(),
      gateway: {
        connected: gateway.ok,
        latencyMs: gateway.latencyMs,
        circuit: getCircuitStatus(),
      },
      poller,
      ws: getWsStats(),
      rateLimits: getRateLimitStats(),
      activityLog: getActivityStats(),
    });
  } catch (err) {
    res.status(503).json({ status: 'error', error: (err as Error).message });
  }
});

/**
 * GET /api/agents
 * Returns all 12 agents with current status and zone.
 */
apiRouter.get('/agents', (_req, res) => {
  const agents = getFullState();
  res.json({ count: agents.length, agents });
});

/**
 * GET /api/agents/:id
 * Detailed info for a single agent.
 */
apiRouter.get('/agents/:id', (req, res) => {
  const { id } = req.params;

  if (!AGENT_REGISTRY.has(id)) {
    res.status(404).json({ error: `Agent '${id}' not found` });
    return;
  }

  const meta = getAgentMeta(id);
  const status = getAgentStatus(id);

  res.json({
    agent: meta,
    currentStatus: status ?? {
      state: 'offline',
      zone: 'lounge',
      lastActivity: null,
      lastMessage: null,
      model: null,
      tokenUsage: 0,
      sessionKey: null,
    },
    recentActivity: getAgentActivity(id, 20),
  });
});

/**
 * GET /api/activity
 * Global activity feed. Query params: ?limit=50&since=<timestamp>
 */
apiRouter.get('/activity', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const since = parseInt(req.query.since as string) || 0;

  const events = since > 0
    ? getActivitySince(since, limit)
    : getRecentActivity(limit);

  res.json({
    count: events.length,
    events,
    stats: getActivityStats(),
  });
});

/**
 * GET /api/activity/:agentId
 * Activity for a specific agent. Query params: ?limit=50
 */
apiRouter.get('/activity/:agentId', (req, res) => {
  const { agentId } = req.params;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

  const events = getAgentActivity(agentId, limit);
  res.json({
    agentId,
    count: events.length,
    events,
  });
});

/**
 * GET /api/ws-stats
 * WebSocket connection stats.
 */
apiRouter.get('/ws-stats', (_req, res) => {
  res.json(getWsStats());
});

// ── Notifications API ──

/**
 * GET /api/notifications
 * Query params: ?limit=50&unread=true&type=error&agentId=itai&since=<ts>
 */
apiRouter.get('/notifications', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const unreadOnly = req.query.unread === 'true';
  const type = req.query.type as string | undefined;
  const agentId = req.query.agentId as string | undefined;
  const since = parseInt(req.query.since as string) || 0;

  const notifs = getNotifications({
    limit,
    unreadOnly,
    type: type as any,
    agentId,
    since: since || undefined,
  });

  res.json({
    count: notifs.length,
    notifications: notifs,
    stats: getNotificationStats(),
  });
});

/**
 * POST /api/notifications/read
 * Body: { ids: ["notif-1", "notif-2"] } or { all: true }
 */
apiRouter.post('/notifications/read', (req, res) => {
  const { ids, all } = req.body ?? {};

  if (all === true) {
    const count = markAllRead();
    res.json({ ok: true, markedRead: count });
    return;
  }

  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: 'Provide { ids: [...] } or { all: true }' });
    return;
  }

  const count = markRead(ids);
  res.json({ ok: true, markedRead: count });
});

/**
 * GET /api/notifications/stats
 * Notification statistics.
 */
apiRouter.get('/notifications/stats', (_req, res) => {
  res.json(getNotificationStats());
});

// ── Health Dashboard ──

/**
 * GET /api/dashboard
 * Comprehensive dashboard data in one call — for health monitoring UIs.
 * Returns: server status, all agents with states, recent activity, notifications, and system metrics.
 */
apiRouter.get('/dashboard', async (_req, res) => {
  try {
    const [gateway, agents, activity, notifStats, pollerStats, wsStats, rateLimits] = await Promise.all([
      checkGatewayHealth(),
      Promise.resolve(getFullState()),
      Promise.resolve(getRecentActivity(20)),
      Promise.resolve(getNotificationStats()),
      Promise.resolve(getPollerStats()),
      Promise.resolve(getWsStats()),
      Promise.resolve(getRateLimitStats()),
    ]);

    // Compute agent summary
    const stateCounts: Record<string, number> = {};
    const zoneCounts: Record<string, number> = {};
    for (const a of agents) {
      stateCounts[a.state] = (stateCounts[a.state] ?? 0) + 1;
      zoneCounts[a.zone] = (zoneCounts[a.zone] ?? 0) + 1;
    }

    const uptime = process.uptime();
    const mem = process.memoryUsage();

    res.json({
      timestamp: new Date().toISOString(),
      server: {
        status: gateway.ok ? 'ok' : 'degraded',
        uptime,
        uptimeFormatted: formatUptime(uptime),
        memory: {
          heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024 * 10) / 10,
          heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024 * 10) / 10,
          rssMB: Math.round(mem.rss / 1024 / 1024 * 10) / 10,
        },
      },
      gateway: {
        connected: gateway.ok,
        latencyMs: gateway.latencyMs,
        circuit: getCircuitStatus(),
      },
      agents: {
        total: agents.length,
        stateCounts,
        zoneCounts,
        list: agents,
      },
      activity: {
        recent: activity,
        stats: getActivityStats(),
      },
      notifications: notifStats,
      websocket: wsStats,
      poller: pollerStats,
      rateLimits,
    });
  } catch (err) {
    res.status(503).json({ error: (err as Error).message });
  }
});

// ── Metrics ──

/**
 * GET /api/metrics
 * Server metrics: response times, message counts, uptime per agent, gateway stats.
 */
apiRouter.get('/metrics', (_req, res) => {
  res.json(getAllMetrics());
});

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}
