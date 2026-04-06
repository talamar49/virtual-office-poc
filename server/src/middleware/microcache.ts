/**
 * Microcache middleware
 * 
 * Small in-memory cache for hot GET endpoints that are expensive to compute
 * and can tolerate tiny staleness (1-5 seconds).
 */

import type { Request, Response, NextFunction } from 'express';

interface CacheEntry {
  body: string;
  statusCode: number;
  contentType: string | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function buildKey(req: Request): string {
  return `${req.method}:${req.originalUrl}`;
}

export function microcache(ttlMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'GET') return next();

    const key = buildKey(req);
    const now = Date.now();
    const hit = cache.get(key);

    if (hit && hit.expiresAt > now) {
      res.setHeader('X-Microcache', 'HIT');
      if (hit.contentType) res.setHeader('Content-Type', hit.contentType);
      res.status(hit.statusCode).send(hit.body);
      return;
    }

    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    const store = (payload: any) => {
      const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
      cache.set(key, {
        body,
        statusCode: res.statusCode,
        contentType: String(res.getHeader('Content-Type') || 'application/json'),
        expiresAt: now + ttlMs,
      });
    };

    res.json = ((body: any) => {
      store(body);
      res.setHeader('X-Microcache', 'MISS');
      return originalJson(body);
    }) as any;

    res.send = ((body: any) => {
      if (res.statusCode < 400) {
        store(body);
      }
      res.setHeader('X-Microcache', 'MISS');
      return originalSend(body);
    }) as any;

    next();
  };
}

export function clearMicrocache(prefix?: string): number {
  if (!prefix) {
    const count = cache.size;
    cache.clear();
    return count;
  }
  let removed = 0;
  for (const key of cache.keys()) {
    if (key.includes(prefix)) {
      cache.delete(key);
      removed++;
    }
  }
  return removed;
}

export function getMicrocacheStats() {
  const now = Date.now();
  let active = 0;
  for (const entry of cache.values()) {
    if (entry.expiresAt > now) active++;
  }
  return {
    entries: cache.size,
    active,
  };
}
