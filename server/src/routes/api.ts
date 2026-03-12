/**
 * REST API Routes — v2
 */

import { Router } from 'express';
import { getFullState, getAgentStatus, getPollerStats } from '../services/status-poller.js';
import { checkGatewayHealth, getCircuitStatus } from '../services/gateway-client.js';
import { getClientCount } from '../ws/handler.js';
import { AGENT_REGISTRY, getAgentMeta } from '../config/agents.js';

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
  });
});
