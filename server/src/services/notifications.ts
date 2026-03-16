/**
 * Notifications Service
 * 
 * Server-side notification queue for agent state transitions.
 * Clients can poll for unread notifications or receive them via WebSocket.
 * 
 * Notification triggers:
 * - Agent finishes work (working/talking → idle/offline)
 * - Agent enters error state (any → error)
 * - Agent recovers from error (error → any other)
 * - Agent comes online (offline → working/talking/idle)
 */

export type NotificationType = 'task-complete' | 'error' | 'recovery' | 'online' | 'offline';
export type NotificationPriority = 'high' | 'medium' | 'low';

export interface Notification {
  id: string;
  type: NotificationType;
  priority: NotificationPriority;
  agentId: string;
  agentName: string;
  agentEmoji: string;
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
}

const MAX_NOTIFICATIONS = 200;
const notifications: Notification[] = [];
let notifCounter = 0;

/**
 * Determine notification from state transition
 */
export function evaluateTransition(
  agentId: string,
  agentName: string,
  agentEmoji: string,
  fromState: string,
  toState: string,
): Notification | null {
  let type: NotificationType;
  let priority: NotificationPriority;
  let title: string;
  let message: string;

  const isWorking = (s: string) => s === 'working' || s === 'talking';

  if (isWorking(fromState) && (toState === 'idle' || toState === 'offline')) {
    type = 'task-complete';
    priority = 'medium';
    title = `${agentName} סיים משימה`;
    message = `${agentEmoji} ${agentName} עבר מ-${fromState} ל-${toState}`;
  } else if (toState === 'error') {
    type = 'error';
    priority = 'high';
    title = `⚠️ ${agentName} — שגיאה!`;
    message = `${agentEmoji} ${agentName} נכנס למצב שגיאה (abortedLastRun)`;
  } else if (fromState === 'error' && toState !== 'error') {
    type = 'recovery';
    priority = 'medium';
    title = `✅ ${agentName} התאושש`;
    message = `${agentEmoji} ${agentName} חזר לפעילות אחרי שגיאה`;
  } else if (fromState === 'offline' && toState !== 'offline') {
    type = 'online';
    priority = 'low';
    title = `${agentName} מחובר`;
    message = `${agentEmoji} ${agentName} חזר לפעילות`;
  } else if (toState === 'offline' && fromState !== 'offline') {
    type = 'offline';
    priority = 'low';
    title = `${agentName} התנתק`;
    message = `${agentEmoji} ${agentName} לא פעיל`;
  } else {
    return null; // No notification for this transition
  }

  const notif: Notification = {
    id: `notif-${++notifCounter}-${Date.now()}`,
    type,
    priority,
    agentId,
    agentName,
    agentEmoji,
    title,
    message,
    timestamp: Date.now(),
    read: false,
  };

  notifications.push(notif);
  if (notifications.length > MAX_NOTIFICATIONS) {
    notifications.splice(0, notifications.length - MAX_NOTIFICATIONS);
  }

  return notif;
}

/**
 * Get all notifications (newest first)
 */
export function getNotifications(opts: {
  limit?: number;
  unreadOnly?: boolean;
  type?: NotificationType;
  agentId?: string;
  since?: number;
} = {}): Notification[] {
  let result = [...notifications];

  if (opts.unreadOnly) result = result.filter((n) => !n.read);
  if (opts.type) result = result.filter((n) => n.type === opts.type);
  if (opts.agentId) result = result.filter((n) => n.agentId === opts.agentId);
  if (opts.since) result = result.filter((n) => n.timestamp > opts.since!);

  const limit = opts.limit ?? 50;
  return result.slice(-limit).reverse();
}

/**
 * Mark notification(s) as read
 */
export function markRead(ids: string[]): number {
  let count = 0;
  const idSet = new Set(ids);
  for (const n of notifications) {
    if (idSet.has(n.id) && !n.read) {
      n.read = true;
      count++;
    }
  }
  return count;
}

/**
 * Mark all notifications as read
 */
export function markAllRead(): number {
  let count = 0;
  for (const n of notifications) {
    if (!n.read) { n.read = true; count++; }
  }
  return count;
}

/**
 * Get notification stats
 */
export function getNotificationStats() {
  const unread = notifications.filter((n) => !n.read).length;
  const byType: Record<string, number> = {};
  const byPriority: Record<string, number> = {};

  for (const n of notifications) {
    byType[n.type] = (byType[n.type] ?? 0) + 1;
    if (!n.read) byPriority[n.priority] = (byPriority[n.priority] ?? 0) + 1;
  }

  return {
    total: notifications.length,
    unread,
    maxCapacity: MAX_NOTIFICATIONS,
    byType,
    unreadByPriority: byPriority,
  };
}
