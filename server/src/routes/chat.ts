/**
 * Chat History Routes
 * 
 * Fetches full conversation history for an agent via Gateway's sessions_history tool.
 * Supports pagination with cursor-based approach using message timestamps.
 */

import { Router, type Request, type Response } from 'express';
import { invokeTool } from '../services/gateway-client.js';
import { getAgentStatus } from '../services/status-poller.js';
import { AGENT_REGISTRY } from '../config/agents.js';

export const chatRouter: ReturnType<typeof Router> = Router();

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

interface ChatMessage {
  role: string;
  content: string;
  timestamp?: string;
  toolCalls?: any[];
}

/**
 * GET /api/chat/:agentId/history
 * 
 * Query params:
 *   ?limit=50       — messages per page (max 200)
 *   ?before=<ts>    — cursor: return messages before this ISO timestamp
 *   ?after=<ts>     — cursor: return messages after this ISO timestamp
 *   ?includeTools=true — include tool call details
 *   ?sessionKey=<key> — use specific session (default: agent's most recent)
 * 
 * Response:
 *   { agentId, sessionKey, messages[], pagination: { total, hasMore, nextCursor } }
 */
chatRouter.get('/:agentId/history', async (req: Request, res: Response) => {
  const { agentId } = req.params;
  const limit = Math.min(parseInt(req.query.limit as string) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const before = req.query.before as string | undefined;
  const after = req.query.after as string | undefined;
  const includeTools = req.query.includeTools === 'true';
  let sessionKey = req.query.sessionKey as string | undefined;

  // Resolve session key if not provided
  if (!sessionKey) {
    const status = getAgentStatus(agentId);
    sessionKey = status?.sessionKey ?? undefined;

    if (!sessionKey) {
      // Try looking up by known pattern
      const gatewayId = agentId === 'yogi' ? 'main' : agentId;
      sessionKey = `agent:${gatewayId}:discord:channel:unknown`;
      
      // If agent is not even in registry, 404
      if (!AGENT_REGISTRY.has(agentId) && !status) {
        res.status(404).json({ error: `Agent '${agentId}' not found or has no active session` });
        return;
      }
    }
  }

  try {
    // Call Gateway's sessions_history tool
    const data = await invokeTool<any>('sessions_history', {
      sessionKey,
      limit: limit + 1, // fetch one extra to detect hasMore
      includeTools,
    });

    // Parse response
    let messages: ChatMessage[] = parseHistoryResponse(data);

    // Apply cursor filters
    if (before) {
      const beforeTs = new Date(before).getTime();
      messages = messages.filter((m) => {
        const ts = m.timestamp ? new Date(m.timestamp).getTime() : 0;
        return ts < beforeTs;
      });
    }
    if (after) {
      const afterTs = new Date(after).getTime();
      messages = messages.filter((m) => {
        const ts = m.timestamp ? new Date(m.timestamp).getTime() : Infinity;
        return ts > afterTs;
      });
    }

    // Strip tool details if not requested
    if (!includeTools) {
      messages = messages.map((m) => {
        const { toolCalls, ...rest } = m;
        return rest;
      });
    }

    // Pagination
    const hasMore = messages.length > limit;
    if (hasMore) messages = messages.slice(0, limit);

    const nextCursor = hasMore && messages.length > 0
      ? messages[messages.length - 1].timestamp ?? null
      : null;

    res.json({
      agentId,
      sessionKey,
      messages,
      pagination: {
        count: messages.length,
        limit,
        hasMore,
        nextCursor,
      },
    });
  } catch (err: any) {
    const status = err.status ?? 500;
    res.status(status).json({
      error: `Failed to fetch chat history: ${err.message}`,
      agentId,
      sessionKey,
    });
  }
});

/**
 * Parse the Gateway's history response into a flat message array
 */
function parseHistoryResponse(data: any): ChatMessage[] {
  // Gateway responses can vary — try multiple paths
  const raw =
    data?.result?.details?.messages ??
    data?.result?.messages ??
    data?.messages ??
    [];

  if (!Array.isArray(raw)) return [];

  return raw.map((msg: any) => {
    let content = '';
    if (typeof msg.content === 'string') {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      // Extract text blocks, summarize tool calls
      const texts: string[] = [];
      const tools: any[] = [];
      for (const block of msg.content) {
        if (block.type === 'text') texts.push(block.text);
        else if (block.type === 'tool_use' || block.type === 'toolCall') {
          tools.push({ name: block.name ?? block.tool, id: block.id });
        }
      }
      content = texts.join('\n');
      if (tools.length > 0) {
        return {
          role: msg.role ?? 'unknown',
          content,
          timestamp: msg.timestamp ? new Date(msg.timestamp).toISOString() : undefined,
          toolCalls: tools,
        };
      }
    }

    return {
      role: msg.role ?? 'unknown',
      content,
      timestamp: msg.timestamp ? new Date(msg.timestamp).toISOString() : undefined,
    };
  });
}
