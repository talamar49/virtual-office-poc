/**
 * Virtual Office v2 — Backend Server
 * 
 * Express + WebSocket server that polls OpenClaw Gateway
 * and pushes real-time agent status updates to the frontend.
 */

import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import cors from 'cors';
import { createServer } from 'http';
import { apiRouter } from './routes/api.js';
import { proxyRouter } from './routes/proxy.js';
import { initWebSocket, broadcast, closeAllConnections } from './ws/handler.js';
import { startPoller, stopPoller } from './services/status-poller.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3001');

app.use(cors());
app.use(express.json());
import { transcribeRouter } from './routes/transcribe.js';
app.use('/api', apiRouter);
app.use('/api/proxy', proxyRouter);
app.use('/api/transcribe', transcribeRouter);

// Serve frontend static files (production)
const staticDir = process.env.STATIC_DIR || path.join(__dirname, '../../dist');
app.use(express.static(staticDir));
// SPA fallback — serve index.html for all non-API routes
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api') && !req.path.startsWith('/ws')) {
    res.sendFile(path.join(staticDir, 'index.html'));
  }
});

const server = createServer(app);

initWebSocket(server);
startPoller(broadcast);

server.listen(PORT, () => {
  console.log(`🏢 Virtual Office v2 server on http://localhost:${PORT}`);
  console.log(`📡 WebSocket: ws://localhost:${PORT}/ws`);
  console.log(`📊 Health: http://localhost:${PORT}/api/health`);
  console.log(`👥 Agents: http://localhost:${PORT}/api/agents`);
});

// --- Graceful Shutdown ---

let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[Shutdown] ${signal} — shutting down gracefully...`);
  server.close(() => console.log('[Shutdown] HTTP server closed'));
  stopPoller();
  closeAllConnections();
  await new Promise((r) => setTimeout(r, 2_000));
  console.log('[Shutdown] Done.');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  console.error('[Fatal] Uncaught:', err);
  gracefulShutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  console.error('[Fatal] Unhandled rejection:', reason);
});
