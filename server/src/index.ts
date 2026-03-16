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

// CORS — restrict to known origins (dev + production)
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [
      'http://localhost:5173',   // Vite dev server
      'http://localhost:3001',   // production (same origin)
      'http://127.0.0.1:5173',
      'http://127.0.0.1:3001',
    ];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (same-origin, curl, mobile apps)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    console.warn(`[CORS] Blocked origin: ${origin}`);
    callback(new Error(`CORS: origin not allowed`));
  },
  credentials: true,
}));
app.use(express.json());
import { transcribeRouter } from './routes/transcribe.js';
import { seatingRouter } from './routes/seating.js';
import { apiLimiter, proxyLimiter } from './middleware/rate-limit.js';
app.use('/api/proxy', proxyLimiter, proxyRouter);
app.use('/api/transcribe', transcribeRouter);
app.use('/api/seating', seatingRouter);
app.use('/api', apiLimiter, apiRouter);

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
