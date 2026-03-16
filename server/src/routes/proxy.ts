/**
 * Gateway Proxy Routes — v2
 * 
 * Generic proxy that forwards requests to any OpenClaw Gateway.
 * The user's token + URL come from request headers, NOT from server .env.
 * This solves CORS — the browser talks to our backend, we talk to the Gateway.
 * 
 * Features:
 * - Routing validation (agentId ↔ sessionKey match)
 * - Chat history persistence (in-memory, merged with Gateway history)
 * - Response watcher → WebSocket streaming
 */

import { Router, type Request, type Response } from 'express';
import { broadcast } from '../ws/handler.js';

export const proxyRouter: ReturnType<typeof Router> = Router();

const PROXY_TIMEOUT_MS = 15_000;

// ── Input Validation Helpers ──

/** Clamp a numeric body param to [min, max], fallback to defaultVal */
function toPositiveInt(val: unknown, defaultVal: number, max: number): number {
  const n = parseInt(String(val ?? ''), 10);
  if (isNaN(n) || n <= 0) return defaultVal;
  return Math.min(n, max);
}

/** Validate sessionKey format: agent:...  or alphanumeric/colon/dash */
function isValidSessionKey(key: unknown): key is string {
  return typeof key === 'string' && /^[a-zA-Z0-9:_-]{1,512}$/.test(key.trim());
}

/** Validate agentId: alphanumeric + dash/underscore, max 64 chars */
function isValidAgentId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(id.trim());
}

/** Sanitize free-text message: strip null bytes, cap length */
function sanitizeMessage(msg: unknown, maxLen = 10_000): string {
  if (typeof msg !== 'string') return '';
  return msg.replace(/\0/g, '').slice(0, maxLen);
}

/** Validate gateway URL — http/https only */
function isValidGatewayUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

// ── Chat History Store ──
// In-memory store that keeps all chat messages per agent.
// Merges office-chat messages with Gateway session history.

interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;     // ISO string
  source: 'office' | 'gateway';  // where the message came from
}

const chatHistory = new Map<string, StoredMessage[]>();
const MAX_HISTORY_PER_AGENT = 200;

function addMessage(agentId: string, msg: StoredMessage): void {
  if (!chatHistory.has(agentId)) chatHistory.set(agentId, []);
  const history = chatHistory.get(agentId)!;

  // Deduplicate by id
  if (history.some(m => m.id === msg.id)) return;

  history.push(msg);

  // Trim old messages
  if (history.length > MAX_HISTORY_PER_AGENT) {
    history.splice(0, history.length - MAX_HISTORY_PER_AGENT);
  }
}

function getHistory(agentId: string): StoredMessage[] {
  return chatHistory.get(agentId) ?? [];
}

/**
 * Merge Gateway history into local store.
 * Gateway messages get source='gateway', office messages keep source='office'.
 */
function mergeGatewayHistory(agentId: string, gatewayMessages: any[]): StoredMessage[] {
  for (const m of gatewayMessages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;

    let text = '';
    if (typeof m.content === 'string') {
      text = m.content;
    } else if (Array.isArray(m.content)) {
      const textBlock = m.content.find((b: any) => b.type === 'text');
      text = textBlock?.text ?? '';
    } else if (m.text) {
      text = m.text;
    } else if (m.preview) {
      text = m.preview;
    }

    if (!text.trim()) continue;

    const ts = m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString();
    const id = `gw-${ts}-${m.role}-${text.substring(0, 20)}`;

    addMessage(agentId, {
      id,
      role: m.role,
      text: text.substring(0, 2000),
      timestamp: ts,
      source: 'gateway',
    });
  }

  // Sort by timestamp
  const history = getHistory(agentId);
  history.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return history;
}

// ── Response Watcher — polls for agent replies after sending a message ──

interface WatcherState {
  timer: ReturnType<typeof setTimeout> | null;
  baselineCount: number;
  pollCount: number;
}

const activeWatchers = new Map<string, WatcherState>();
const MAX_POLLS = 20;          // max 20 polls × 1.5s = 30s watch window
const POLL_INTERVAL_MS = 1_500;

/**
 * After sending a message to an agent, poll their session history
 * for a new assistant response. When found, store it and broadcast via WebSocket.
 */
function startResponseWatcher(
  agentId: string,
  sessionKey: string,
  gatewayToken: string,
  gatewayUrl: string,
) {
  // Cancel existing watcher for this agent (if any)
  const existing = activeWatchers.get(agentId);
  if (existing?.timer) clearTimeout(existing.timer);

  const state: WatcherState = {
    timer: null,
    baselineCount: -1, // -1 means "first poll — establish baseline"
    pollCount: 0,
  };
  activeWatchers.set(agentId, state);

  async function poll() {
    state.pollCount++;
    if (state.pollCount > MAX_POLLS) {
      activeWatchers.delete(agentId);
      broadcast('chat:timeout', { agentId });
      return;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8_000);

      const res = await fetch(`${gatewayUrl}/tools/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${gatewayToken}`,
        },
        body: JSON.stringify({
          tool: 'sessions_history',
          args: { sessionKey, limit: 5, includeTools: false },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      if (!res.ok) {
        state.timer = setTimeout(poll, POLL_INTERVAL_MS);
        return;
      }

      const data = await res.json();
      const messages: any[] =
        data?.result?.details?.messages ??
        data?.result?.messages ??
        (Array.isArray(data?.result) ? data.result : []);

      // Internal message patterns to filter out
      const INTERNAL_PATTERNS = [
        /agent-to-agent announce/i,
        /ANNOUNCE_SKIP/,
        /HEARTBEAT_OK/,
        /NO_REPLY/,
        /^\[Inter-session message\]/,
        /^\[.*announce.*step\]/i,
      ];

      function isInternalMessage(text: string): boolean {
        return INTERNAL_PATTERNS.some(p => p.test(text.trim()));
      }

      function extractText(m: any): string {
        if (typeof m.content === 'string') return m.content.trim();
        if (Array.isArray(m.content)) {
          const tb = m.content.find((b: any) => b.type === 'text');
          return tb?.text?.trim() ?? '';
        }
        return m.text?.trim() ?? m.preview?.trim() ?? '';
      }

      // Filter to assistant text messages, excluding internal/system messages
      const assistantMsgs = messages.filter((m: any) => {
        if (m.role !== 'assistant') return false;
        const text = extractText(m);
        if (!text) return false;
        if (isInternalMessage(text)) return false;
        return true;
      });

      // First poll — establish baseline
      if (state.baselineCount === -1) {
        state.baselineCount = assistantMsgs.length;
        state.timer = setTimeout(poll, POLL_INTERVAL_MS);
        return;
      }

      // Check for new assistant messages
      if (assistantMsgs.length > state.baselineCount) {
        const newMsgs = assistantMsgs.slice(state.baselineCount);

        for (const msg of newMsgs) {
          let text = '';
          if (typeof msg.content === 'string') {
            text = msg.content;
          } else if (Array.isArray(msg.content)) {
            const textBlock = msg.content.find((b: any) => b.type === 'text');
            text = textBlock?.text ?? '';
          } else {
            text = msg.text ?? msg.preview ?? '';
          }

          if (text.trim()) {
            const ts = msg.timestamp ? new Date(msg.timestamp).toISOString() : new Date().toISOString();
            const stored: StoredMessage = {
              id: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              role: 'assistant',
              text: text.substring(0, 2000),
              timestamp: ts,
              source: 'gateway',
            };

            // Store in history
            addMessage(agentId, stored);

            // Broadcast to all WebSocket clients
            broadcast('chat:response', {
              agentId,
              message: stored,
            });
          }
        }

        // Done watching
        activeWatchers.delete(agentId);
        return;
      }

      // No new messages yet — keep polling
      state.timer = setTimeout(poll, POLL_INTERVAL_MS);
    } catch (err) {
      console.warn(`[Watcher] Poll error for ${agentId}:`, (err as Error).message);
      state.timer = setTimeout(poll, POLL_INTERVAL_MS);
    }
  }

  // Start first poll after a short delay
  state.timer = setTimeout(poll, POLL_INTERVAL_MS);
}


// ── Routes ──

/**
 * POST /api/proxy/sessions
 */
proxyRouter.post('/sessions', async (req: Request, res: Response) => {
  const gatewayToken = req.headers['x-gateway-token'] as string | undefined;
  const gatewayUrl = req.headers['x-gateway-url'] as string | undefined;

  if (!gatewayToken) {
    res.status(400).json({ error: 'Missing X-Gateway-Token header' });
    return;
  }
  if (!gatewayUrl) {
    res.status(400).json({ error: 'Missing X-Gateway-URL header' });
    return;
  }

  // Validate URL format
  if (!isValidGatewayUrl(gatewayUrl)) {
    res.status(400).json({ error: 'Invalid X-Gateway-URL — must be a valid http/https URL' });
    return;
  }

  const activeMinutes = toPositiveInt(req.body?.activeMinutes, 120, 1440); // max 24h
  const messageLimit = toPositiveInt(req.body?.messageLimit, 1, 50);       // max 50

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

    const gatewayRes = await fetch(`${gatewayUrl}/tools/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${gatewayToken}`,
      },
      body: JSON.stringify({
        tool: 'sessions_list',
        args: { activeMinutes, messageLimit },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!gatewayRes.ok) {
      const errorText = await gatewayRes.text().catch(() => '');
      res.status(gatewayRes.status).json({
        error: `Gateway responded ${gatewayRes.status}`,
        detail: errorText.substring(0, 500),
      });
      return;
    }

    const data = await gatewayRes.json();
    const sessions =
      data?.result?.details?.sessions ??
      data?.sessions ??
      data?.result?.sessions ??
      [];

    res.json({ ok: true, sessions });
  } catch (err: any) {
    if (err.name === 'AbortError') {
      res.status(504).json({ error: `Gateway request timed out (${PROXY_TIMEOUT_MS}ms)` });
      return;
    }
    const message = err.cause?.code === 'ECONNREFUSED'
      ? `Cannot connect to Gateway at ${gatewayUrl} — is it running?`
      : err.message || 'Unknown proxy error';
    res.status(502).json({ error: message });
  }
});

/**
 * POST /api/proxy/send
 * 
 * Send a message to an agent via sessions_send.
 * Body: { sessionKey, message, agentId }
 * 
 * agentId is REQUIRED — used for routing validation and history storage.
 */
proxyRouter.post('/send', async (req: Request, res: Response) => {
  const gatewayToken = req.headers['x-gateway-token'] as string | undefined;
  const gatewayUrl = req.headers['x-gateway-url'] as string | undefined;

  if (!gatewayToken || !gatewayUrl) {
    res.status(400).json({ error: 'Missing X-Gateway-Token or X-Gateway-URL headers' });
    return;
  }

  const rawSessionKey = req.body?.sessionKey;
  const rawMessage = req.body?.message;
  const rawAgentId = req.body?.agentId;

  // Validate sessionKey
  if (!isValidSessionKey(rawSessionKey)) {
    res.status(400).json({ error: 'Missing or invalid sessionKey' });
    return;
  }
  const sessionKey = rawSessionKey.trim();

  // Validate and sanitize message
  const message = sanitizeMessage(rawMessage);
  if (!message) {
    res.status(400).json({ error: 'Missing or empty message' });
    return;
  }

  // Validate agentId (optional but must be valid if provided)
  const agentId = rawAgentId != null ? String(rawAgentId).trim() : undefined;
  if (agentId && !isValidAgentId(agentId)) {
    res.status(400).json({ error: 'Invalid agentId format' });
    return;
  }

  // Routing validation — ensure sessionKey matches intended agent
  if (agentId) {
    const keyMatch = sessionKey.match(/^agent:([^:]+)/);
    const keyAgentId = keyMatch ? keyMatch[1] : null;

    if (keyAgentId && keyAgentId !== agentId) {
      console.warn(`[Proxy] Routing mismatch! agentId="${agentId}" but sessionKey belongs to "${keyAgentId}". Blocking.`);
      res.status(400).json({
        error: `Routing mismatch: sessionKey belongs to "${keyAgentId}" but target is "${agentId}"`,
        hint: 'The frontend may have cached a stale sessionKey. Refresh the page.',
      });
      return;
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

    const gatewayRes = await fetch(`${gatewayUrl}/tools/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${gatewayToken}`,
      },
      body: JSON.stringify({
        tool: 'sessions_send',
        args: { sessionKey, message, timeoutSeconds: 0 },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!gatewayRes.ok) {
      const errorText = await gatewayRes.text().catch(() => '');
      res.status(gatewayRes.status).json({
        error: `Gateway responded ${gatewayRes.status}`,
        detail: errorText.substring(0, 500),
      });
      return;
    }

    const data = await gatewayRes.json();

    // Store the sent message in history
    const effectiveAgentId = agentId ?? sessionKey.match(/^agent:([^:]+)/)?.[1] ?? 'unknown';
    const sentMsg: StoredMessage = {
      id: `office-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'user',
      text: message.substring(0, 2000),
      timestamp: new Date().toISOString(),
      source: 'office',
    };
    addMessage(effectiveAgentId, sentMsg);

    // Mirror user message to Discord channel (so it appears in the agent's channel)
    const channelMatch = sessionKey.match(/discord:channel:(\d+)/);
    if (channelMatch) {
      const discordChannelId = channelMatch[1];
      fetch(`${gatewayUrl}/tools/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${gatewayToken}`,
        },
        body: JSON.stringify({
          tool: 'message',
          args: {
            action: 'send',
            channel: 'discord',
            target: discordChannelId,
            message: `💬 **[Virtual Office Chat]**\n${message}`,
          },
        }),
      }).catch(err => console.warn('[Proxy] Failed to mirror message to Discord:', err.message));
    }

    // Start response watcher — polls for agent's reply and broadcasts via WebSocket
    startResponseWatcher(effectiveAgentId, sessionKey, gatewayToken, gatewayUrl);

    res.json({ ok: true, result: data?.result ?? data });
  } catch (err: any) {
    if (err.name === 'AbortError') {
      res.status(504).json({ error: `Gateway request timed out (${PROXY_TIMEOUT_MS}ms)` });
      return;
    }
    const errMsg = err.cause?.code === 'ECONNREFUSED'
      ? `Cannot connect to Gateway at ${gatewayUrl} — is it running?`
      : err.message || 'Unknown proxy error';
    res.status(502).json({ error: errMsg });
  }
});

/**
 * POST /api/proxy/history
 * 
 * Fetch chat history for an agent. Merges:
 * - Local office-chat messages (stored in-memory)
 * - Gateway session history (fetched live)
 * 
 * Body: { sessionKey, agentId?, limit?, after? }
 */
proxyRouter.post('/history', async (req: Request, res: Response) => {
  const gatewayToken = req.headers['x-gateway-token'] as string | undefined;
  const gatewayUrl = req.headers['x-gateway-url'] as string | undefined;

  if (!gatewayToken || !gatewayUrl) {
    res.status(400).json({ error: 'Missing X-Gateway-Token or X-Gateway-URL headers' });
    return;
  }

  const { sessionKey, agentId, limit = 50, after } = req.body ?? {};
  if (!sessionKey) {
    res.status(400).json({ error: 'Missing sessionKey in body' });
    return;
  }

  const effectiveAgentId = agentId ?? sessionKey.match(/^agent:([^:]+)/)?.[1] ?? 'unknown';

  try {
    // Fetch fresh history from Gateway
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

    const gatewayRes = await fetch(`${gatewayUrl}/tools/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${gatewayToken}`,
      },
      body: JSON.stringify({
        tool: 'sessions_history',
        args: { sessionKey, limit, includeTools: false },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (gatewayRes.ok) {
      const data = await gatewayRes.json();
      const rawMessages =
        data?.result?.details?.messages ??
        data?.result?.messages ??
        (Array.isArray(data?.result) ? data.result : []);

      // Merge Gateway messages into local store
      if (Array.isArray(rawMessages)) {
        mergeGatewayHistory(effectiveAgentId, rawMessages);
      }
    }
  } catch (err) {
    // Gateway fetch failed — still return local history
    console.warn(`[History] Gateway fetch failed for ${effectiveAgentId}:`, (err as Error).message);
  }

  // Return merged history (local + gateway), excluding internal messages
  const INTERNAL_PATTERNS_HIST = [
    /agent-to-agent announce/i,
    /ANNOUNCE_SKIP/,
    /HEARTBEAT_OK/,
    /NO_REPLY/,
    /^\[Inter-session message\]/,
    /^\[.*announce.*step\]/i,
  ];
  let history = getHistory(effectiveAgentId).filter(
    m => !INTERNAL_PATTERNS_HIST.some(p => p.test(m.text.trim()))
  );

  // Filter by `after` timestamp if provided
  if (after) {
    const afterTs = new Date(after).getTime();
    history = history.filter(m => new Date(m.timestamp).getTime() > afterTs);
  }

  // Apply limit (from the end — most recent)
  if (history.length > limit) {
    history = history.slice(-limit);
  }

  res.json({
    ok: true,
    agentId: effectiveAgentId,
    messages: history,
    total: getHistory(effectiveAgentId).length,
  });
});

/**
 * POST /api/proxy/health
 */
proxyRouter.post('/health', async (req: Request, res: Response) => {
  const gatewayToken = req.headers['x-gateway-token'] as string | undefined;
  const gatewayUrl = req.headers['x-gateway-url'] as string | undefined;

  if (!gatewayToken || !gatewayUrl) {
    res.status(400).json({ error: 'Missing X-Gateway-Token or X-Gateway-URL headers' });
    return;
  }

  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);

    const gatewayRes = await fetch(`${gatewayUrl}/tools/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${gatewayToken}`,
      },
      body: JSON.stringify({
        tool: 'sessions_list',
        args: { activeMinutes: 1, messageLimit: 0 },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    res.json({
      ok: gatewayRes.ok,
      status: gatewayRes.status,
      latencyMs: Date.now() - start,
    });
  } catch (err: any) {
    res.json({
      ok: false,
      error: err.name === 'AbortError' ? 'timeout' : (err.message || 'connection failed'),
      latencyMs: Date.now() - start,
    });
  }
});
