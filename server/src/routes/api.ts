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
