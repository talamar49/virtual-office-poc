/**
 * WebSocket Handler
 * 
 * Manages client connections, sends initial state, broadcasts updates.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { getFullState } from '../services/status-poller.js';

const clients = new Set<WebSocket>();
let wss: WebSocketServer | null = null;

export function initWebSocket(server: Server): void {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    clients.add(ws);
    const ip = req.socket.remoteAddress ?? 'unknown';
    console.log(`[WS] Client connected from ${ip} (${clients.size} total)`);

    // Send full state on connect
    sendToClient(ws, { type: 'agents:init', data: getFullState() });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'ping') {
          sendToClient(ws, { type: 'pong', timestamp: Date.now() });
        }
      } catch { /* ignore */ }
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`[WS] Client disconnected (${clients.size} total)`);
    });

    ws.on('error', (err) => {
      console.error('[WS] Client error:', err.message);
      clients.delete(ws);
    });
  });

  console.log('[WS] WebSocket server initialized on /ws');
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
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

export function getClientCount(): number {
  return clients.size;
}

export function closeAllConnections(): void {
  for (const client of clients) {
    client.close(1001, 'Server shutting down');
  }
  clients.clear();
  wss?.close();
  console.log('[WS] All connections closed');
}
