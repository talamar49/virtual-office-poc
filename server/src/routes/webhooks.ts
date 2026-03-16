/**
 * Webhook Routes
 * 
 * Receives external events (GitHub commits, CI results, etc.)
 * and converts them into office notifications + activity log entries.
 * 
 * Supports:
 * - Generic webhook: POST /api/webhooks
 * - GitHub webhook: POST /api/webhooks/github
 * - CI webhook: POST /api/webhooks/ci
 */

import { Router, type Request, type Response } from 'express';
import { evaluateTransition, type NotificationType } from '../services/notifications.js';
import { recordActivity } from '../services/activity-log.js';
import { broadcast } from '../ws/handler.js';

export const webhookRouter: ReturnType<typeof Router> = Router();

// --- Webhook secret validation ---
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

function validateSecret(req: Request): boolean {
  if (!WEBHOOK_SECRET) return true; // no secret configured = allow all
  const provided = req.headers['x-webhook-secret'] as string | undefined;
  return provided === WEBHOOK_SECRET;
}

// --- Types ---

interface WebhookEvent {
  id: string;
  source: string;
  type: string;
  title: string;
  message: string;
  agentId?: string;
  priority?: 'high' | 'medium' | 'low';
  metadata?: Record<string, unknown>;
  timestamp: number;
}

const MAX_EVENTS = 500;
const webhookEvents: WebhookEvent[] = [];
let eventCounter = 0;

function storeEvent(event: Omit<WebhookEvent, 'id' | 'timestamp'>): WebhookEvent {
  const full: WebhookEvent = {
    ...event,
    id: `wh-${++eventCounter}-${Date.now()}`,
    timestamp: Date.now(),
  };
  webhookEvents.push(full);
  if (webhookEvents.length > MAX_EVENTS) {
    webhookEvents.splice(0, webhookEvents.length - MAX_EVENTS);
  }
  return full;
}

/**
 * POST /api/webhooks
 * 
 * Generic webhook. Body:
 * {
 *   source: "github" | "ci" | "custom" | ...,
 *   type: "commit" | "pr" | "build" | "deploy" | "alert" | ...,
 *   title: "Short title",
 *   message: "Detailed message",
 *   agentId?: "itai",           // optional: associate with specific agent
 *   priority?: "high" | "medium" | "low",
 *   metadata?: { ... }          // any extra data
 * }
 */
webhookRouter.post('/', (req: Request, res: Response) => {
  if (!validateSecret(req)) {
    res.status(401).json({ error: 'Invalid webhook secret' });
    return;
  }

  const { source, type, title, message, agentId, priority, metadata } = req.body ?? {};

  if (!source || !type || !title) {
    res.status(400).json({ error: 'Required fields: source, type, title' });
    return;
  }

  const event = storeEvent({
    source,
    type,
    title,
    message: message || title,
    agentId,
    priority: priority || 'medium',
    metadata,
  });

  // Record in activity log
  recordActivity({
    agentId: agentId || 'system',
    agentName: source,
    agentEmoji: getSourceEmoji(source),
    type: 'state-change',
    detail: `[webhook] ${title}`,
    timestamp: Date.now(),
  });

  // Broadcast to WebSocket clients
  broadcast('webhook', event);

  // Also broadcast as notification
  broadcast('notification', {
    id: event.id,
    type: mapWebhookToNotifType(type),
    priority: event.priority,
    agentId: agentId || 'system',
    agentName: source,
    agentEmoji: getSourceEmoji(source),
    title,
    message: event.message,
    timestamp: event.timestamp,
    read: false,
  });

  res.json({ ok: true, eventId: event.id });
});

/**
 * POST /api/webhooks/github
 * 
 * Parses GitHub webhook payload format.
 * Supports: push, pull_request, workflow_run, issues
 */
webhookRouter.post('/github', (req: Request, res: Response) => {
  if (!validateSecret(req)) {
    res.status(401).json({ error: 'Invalid webhook secret' });
    return;
  }

  const ghEvent = req.headers['x-github-event'] as string | undefined;
  const payload = req.body;

  if (!payload) {
    res.status(400).json({ error: 'Empty payload' });
    return;
  }

  let title: string;
  let message: string;
  let type: string;
  let priority: 'high' | 'medium' | 'low' = 'low';

  switch (ghEvent) {
    case 'push': {
      const commits = payload.commits?.length ?? 0;
      const branch = payload.ref?.replace('refs/heads/', '') ?? 'unknown';
      const pusher = payload.pusher?.name ?? 'unknown';
      title = `📦 ${commits} commit(s) pushed to ${branch}`;
      message = payload.head_commit?.message ?? title;
      type = 'commit';
      priority = branch === 'main' ? 'medium' : 'low';
      break;
    }
    case 'pull_request': {
      const action = payload.action ?? 'unknown';
      const pr = payload.pull_request;
      title = `🔀 PR #${pr?.number}: ${pr?.title ?? 'unknown'} (${action})`;
      message = pr?.body?.substring(0, 300) ?? title;
      type = 'pr';
      priority = action === 'opened' || action === 'merged' ? 'medium' : 'low';
      break;
    }
    case 'workflow_run': {
      const run = payload.workflow_run;
      const status = run?.conclusion ?? run?.status ?? 'unknown';
      title = `⚡ CI: ${run?.name ?? 'workflow'} — ${status}`;
      message = `Run #${run?.run_number ?? '?'} on ${run?.head_branch ?? 'unknown'}`;
      type = 'ci';
      priority = status === 'failure' ? 'high' : 'low';
      break;
    }
    case 'issues': {
      const issue = payload.issue;
      const action = payload.action ?? 'unknown';
      title = `📝 Issue #${issue?.number}: ${issue?.title ?? 'unknown'} (${action})`;
      message = issue?.body?.substring(0, 300) ?? title;
      type = 'issue';
      priority = 'low';
      break;
    }
    default:
      title = `🔔 GitHub: ${ghEvent ?? 'unknown event'}`;
      message = JSON.stringify(payload).substring(0, 200);
      type = ghEvent ?? 'unknown';
  }

  const event = storeEvent({
    source: 'github',
    type,
    title,
    message,
    priority,
    metadata: { ghEvent, repo: payload.repository?.full_name },
  });

  recordActivity({
    agentId: 'system',
    agentName: 'GitHub',
    agentEmoji: '🐙',
    type: 'state-change',
    detail: `[github] ${title}`,
    timestamp: Date.now(),
  });

  broadcast('webhook', event);
  broadcast('notification', {
    id: event.id,
    type: 'task-complete',
    priority: event.priority,
    agentId: 'system',
    agentName: 'GitHub',
    agentEmoji: '🐙',
    title,
    message: event.message,
    timestamp: event.timestamp,
    read: false,
  });

  res.json({ ok: true, eventId: event.id });
});

/**
 * POST /api/webhooks/ci
 * 
 * Generic CI webhook. Body:
 * { pipeline, status: "success"|"failure"|"running", branch, commit, duration?, url? }
 */
webhookRouter.post('/ci', (req: Request, res: Response) => {
  if (!validateSecret(req)) {
    res.status(401).json({ error: 'Invalid webhook secret' });
    return;
  }

  const { pipeline, status, branch, commit, duration, url } = req.body ?? {};

  if (!pipeline || !status) {
    res.status(400).json({ error: 'Required fields: pipeline, status' });
    return;
  }

  const emoji = status === 'success' ? '✅' : status === 'failure' ? '❌' : '⏳';
  const title = `${emoji} CI: ${pipeline} — ${status}`;
  const message = `Branch: ${branch ?? '?'}, Commit: ${(commit ?? '?').substring(0, 8)}${duration ? `, Duration: ${duration}s` : ''}`;
  const priority = status === 'failure' ? 'high' : 'low';

  const event = storeEvent({
    source: 'ci',
    type: 'build',
    title,
    message,
    priority,
    metadata: { pipeline, status, branch, commit, duration, url },
  });

  recordActivity({
    agentId: 'system',
    agentName: 'CI',
    agentEmoji: '⚡',
    type: status === 'failure' ? 'error' : 'state-change',
    detail: `[ci] ${title}`,
    timestamp: Date.now(),
  });

  broadcast('webhook', event);
  broadcast('notification', {
    id: event.id,
    type: status === 'failure' ? 'error' : 'task-complete',
    priority,
    agentId: 'system',
    agentName: 'CI',
    agentEmoji: '⚡',
    title,
    message,
    timestamp: event.timestamp,
    read: false,
  });

  res.json({ ok: true, eventId: event.id });
});

/**
 * GET /api/webhooks/history
 * Recent webhook events. Query: ?limit=50&source=github
 */
webhookRouter.get('/history', (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const source = req.query.source as string | undefined;

  let events = [...webhookEvents];
  if (source) events = events.filter((e) => e.source === source);

  res.json({
    count: Math.min(events.length, limit),
    events: events.slice(-limit).reverse(),
  });
});

// --- Helpers ---

function getSourceEmoji(source: string): string {
  const map: Record<string, string> = {
    github: '🐙',
    ci: '⚡',
    deploy: '🚀',
    monitor: '🛡️',
    slack: '💬',
    custom: '🔔',
  };
  return map[source] ?? '🔔';
}

function mapWebhookToNotifType(type: string): NotificationType {
  if (type === 'build' || type === 'deploy') return 'task-complete';
  if (type === 'failure' || type === 'error' || type === 'alert') return 'error';
  return 'task-complete';
}
