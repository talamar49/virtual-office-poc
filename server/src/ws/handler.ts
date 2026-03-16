/**
 * WebSocket Handler
 * 
 * Manages client connections with:
 * - Server-side heartbeat (ping every 30s, drop dead clients)
 * - Full state on connect/reconnect
 * - Reconnection-friendly: clients get full state on every connect
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { getFullState } from '../services/status-poller.js';

// --- Config ---
const HEARTBEAT_INTERVAL_MS = 30_000;
const CLIENT_TIMEOUT_MS = 45_000; // drop if no pong in 45s

// --- Client tracking ---
interface ClientInfo {
  ws: WebSocket;
  ip: string;
  connectedAt: number;
  lastPong: number;
  isAlive: boolean;
}

const clients = new Map<WebSocket, ClientInfo>();
let wss: WebSocketServer | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

export function initWebSocket(server: Server): void {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress ?? 'unknown';
    const now = Date.now();

    const info: ClientInfo = {
      ws,
      ip,
      connectedAt: now,
      lastPong: now,
      isAlive: true,
    };
    clients.set(ws, info);

    console.log(`[WS] Client connected from ${ip} (${clients.size} total)`);

    // Send full state immediately — works for both fresh connect and reconnect
    sendToClient(ws, {
      type: 'agents:init',
      data: getFullState(),
      serverTime: Date.now(),
    });

    // Handle client messages
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        handleClientMessage(ws, msg);
      } catch { /* ignore malformed */ }
    });

    // ws-level pong (response to our ping)
    ws.on('pong', () => {
      const ci = clients.get(ws);
      if (ci) {
        ci.isAlive = true;
        ci.lastPong = Date.now();
      }
    });

    ws.on('close', (code, reason) => {
      clients.delete(ws);
      console.log(`[WS] Client disconnected from ${ip} (code=${code}, ${clients.size} total)`);
    });

    ws.on('error', (err) => {
      console.error(`[WS] Client error (${ip}):`, err.message);
      clients.delete(ws);
    });
  });

  // Start server-side heartbeat
  startHeartbeat();

  console.log(`[WS] WebSocket server initialized on /ws (heartbeat every ${HEARTBEAT_INTERVAL_MS / 1000}s)`);
}

/**
 * Handle application-level messages from clients
 */
function handleClientMessage(ws: WebSocket, msg: any): void {
  const ci = clients.get(ws);

  switch (msg.type) {
    case 'ping':
      // Application-level ping (in addition to ws-level)
      sendToClient(ws, { type: 'pong', timestamp: Date.now() });
      if (ci) { ci.isAlive = true; ci.lastPong = Date.now(); }
      break;

    case 'reconnect':
      // Client explicitly requests full state (e.g. after reconnecting)
      sendToClient(ws, {
        type: 'agents:init',
        data: getFullState(),
        serverTime: Date.now(),
      });
      break;

    default:
      break;
  }
}

/**
 * Server-side heartbeat: ping all clients, drop dead ones.
 * This detects broken connections (e.g. network drop without close frame).
 */
function startHeartbeat(): void {
  if (heartbeatTimer) return;

  heartbeatTimer = setInterval(() => {
    for (const [ws, info] of clients) {
      if (!info.isAlive) {
        // Didn't respond to last ping — terminate
        console.log(`[WS] Client ${info.ip} timed out — terminating`);
        ws.terminate();
        clients.delete(ws);
        continue;
      }

      // Mark as not alive, send ping — expect pong before next check
      info.isAlive = false;
      ws.ping();
    }

    // Also broadcast a heartbeat message so clients know connection is alive
    broadcast('heartbeat', { timestamp: Date.now(), clients: clients.size });
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function sendToClient(ws: WebSocket, data: object): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

/** Broadcast to all connected clients — passed to the poller */
export function broadcast(type: string, data: unknown): void {
  if (clients.size === 0) return;
  const message = JSON.stringify({ type, data });
  for (const [ws] of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
}

export function getClientCount(): number {
  return clients.size;
}

/** Get connection stats for health endpoint */
export function getWsStats() {
  const now = Date.now();
  const clientList = Array.from(clients.values()).map((ci) => ({
    ip: ci.ip,
    connectedAt: new Date(ci.connectedAt).toISOString(),
    uptimeMs: now - ci.connectedAt,
    lastPong: new Date(ci.lastPong).toISOString(),
    isAlive: ci.isAlive,
  }));

  return {
    total: clients.size,
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    clients: clientList,
  };
}

export function closeAllConnections(): void {
  stopHeartbeat();
  for (const [ws] of clients) {
    ws.close(1001, 'Server shutting down');
  }
  clients.clear();
  wss?.close();
  console.log('[WS] All connections closed');
}
