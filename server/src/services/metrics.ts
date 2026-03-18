/**
 * Metrics Collection Service
 * 
 * Tracks:
 * - API response times (histogram)
 * - Message counts per agent
 * - Uptime per agent (time in working/active state)
 * - Gateway call stats
 * - Request counts by endpoint
 */

import type { Request, Response, NextFunction } from 'express';

// --- Response Time Tracking ---

interface EndpointMetric {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  last10: number[]; // ring buffer of last 10 response times
}

const endpointMetrics = new Map<string, EndpointMetric>();

function recordResponseTime(path: string, ms: number): void {
  let metric = endpointMetrics.get(path);
  if (!metric) {
    metric = { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0, avgMs: 0, last10: [] };
    endpointMetrics.set(path, metric);
  }
  metric.count++;
  metric.totalMs += ms;
  metric.minMs = Math.min(metric.minMs, ms);
  metric.maxMs = Math.max(metric.maxMs, ms);
  metric.avgMs = Math.round(metric.totalMs / metric.count * 10) / 10;
  metric.last10.push(ms);
  if (metric.last10.length > 10) metric.last10.shift();
}

/**
 * Express middleware that tracks response times
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const ms = Date.now() - start;
    // Normalize path: strip IDs to group similar endpoints
    const normalized = normalizePath(req.route?.path ?? req.path);
    recordResponseTime(normalized, ms);
  });

  next();
}

function normalizePath(path: string): string {
  // Replace UUIDs and numeric IDs with :id
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d+/g, '/:id');
}

// --- Agent Metrics ---

interface AgentMetrics {
  messageCount: number;
  lastMessageAt: number;
  totalWorkingMs: number;
  lastWorkingStart: number | null;
  stateChanges: number;
  errorCount: number;
}

const agentMetrics = new Map<string, AgentMetrics>();
const serverStartTime = Date.now();

function getOrCreateAgent(agentId: string): AgentMetrics {
  let m = agentMetrics.get(agentId);
  if (!m) {
    m = {
      messageCount: 0,
      lastMessageAt: 0,
      totalWorkingMs: 0,
      lastWorkingStart: null,
      stateChanges: 0,
      errorCount: 0,
    };
    agentMetrics.set(agentId, m);
  }
  return m;
}

/**
 * Record that an agent sent/received a message
 */
export function recordMessage(agentId: string): void {
  const m = getOrCreateAgent(agentId);
  m.messageCount++;
  m.lastMessageAt = Date.now();
}

/**
 * Record a state change for an agent
 */
export function recordStateChange(agentId: string, fromState: string, toState: string): void {
  const m = getOrCreateAgent(agentId);
  m.stateChanges++;

  const isWorking = (s: string) => s === 'working' || s === 'active' || s === 'talking';

  // Track working time
  if (!isWorking(fromState) && isWorking(toState)) {
    // Started working
    m.lastWorkingStart = Date.now();
  } else if (isWorking(fromState) && !isWorking(toState)) {
    // Stopped working
    if (m.lastWorkingStart) {
      m.totalWorkingMs += Date.now() - m.lastWorkingStart;
      m.lastWorkingStart = null;
    }
  }

  if (toState === 'error') m.errorCount++;
}

// --- Gateway Metrics ---

let gatewayCallCount = 0;
let gatewayErrorCount = 0;
let gatewayTotalMs = 0;
const gatewayLatencies: number[] = []; // last 50

export function recordGatewayCall(ms: number, success: boolean): void {
  gatewayCallCount++;
  gatewayTotalMs += ms;
  if (!success) gatewayErrorCount++;
  gatewayLatencies.push(ms);
  if (gatewayLatencies.length > 50) gatewayLatencies.shift();
}

// --- Aggregation ---

/**
 * Get all metrics — called by GET /api/metrics
 */
export function getAllMetrics() {
  const now = Date.now();
  const uptimeMs = now - serverStartTime;

  // Finalize working time for currently-working agents
  const agentList = Array.from(agentMetrics.entries()).map(([id, m]) => {
    let workingMs = m.totalWorkingMs;
    if (m.lastWorkingStart) {
      workingMs += now - m.lastWorkingStart;
    }

    return {
      agentId: id,
      messageCount: m.messageCount,
      lastMessageAt: m.lastMessageAt > 0 ? new Date(m.lastMessageAt).toISOString() : null,
      totalWorkingMs: workingMs,
      workingPercent: uptimeMs > 0 ? Math.round(workingMs / uptimeMs * 10000) / 100 : 0,
      stateChanges: m.stateChanges,
      errorCount: m.errorCount,
    };
  });

  // Endpoint metrics
  const endpoints = Array.from(endpointMetrics.entries()).map(([path, m]) => ({
    path,
    count: m.count,
    avgMs: m.avgMs,
    minMs: m.minMs === Infinity ? 0 : m.minMs,
    maxMs: m.maxMs,
    p50Ms: percentile(m.last10, 50),
    p95Ms: percentile(m.last10, 95),
  })).sort((a, b) => b.count - a.count);

  // Gateway stats
  const avgGatewayMs = gatewayCallCount > 0 ? Math.round(gatewayTotalMs / gatewayCallCount * 10) / 10 : 0;

  return {
    server: {
      uptimeMs,
      uptimeFormatted: formatDuration(uptimeMs),
      startedAt: new Date(serverStartTime).toISOString(),
    },
    agents: {
      tracked: agentList.length,
      list: agentList,
      totalMessages: agentList.reduce((s, a) => s + a.messageCount, 0),
      totalStateChanges: agentList.reduce((s, a) => s + a.stateChanges, 0),
    },
    endpoints: {
      tracked: endpoints.length,
      totalRequests: endpoints.reduce((s, e) => s + e.count, 0),
      list: endpoints,
    },
    gateway: {
      totalCalls: gatewayCallCount,
      errors: gatewayErrorCount,
      errorRate: gatewayCallCount > 0 ? Math.round(gatewayErrorCount / gatewayCallCount * 10000) / 100 : 0,
      avgLatencyMs: avgGatewayMs,
      p50LatencyMs: percentile(gatewayLatencies, 50),
      p95LatencyMs: percentile(gatewayLatencies, 95),
    },
  };
}

// --- Helpers ---

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${sec}s`);
  return parts.join(' ');
}
