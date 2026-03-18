/**
 * Rate Limiter — in-memory sliding window
 * 
 * No external dependencies. Tracks requests per IP with configurable
 * windows and limits. Separate configs for API vs proxy routes.
 */

import type { Request, Response, NextFunction } from 'express';

interface RateBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateBucket>();

// Cleanup stale buckets every 60s
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) {
      buckets.delete(key);
    }
  }
}, 60_000);

interface RateLimitConfig {
  windowMs: number;   // Time window in ms
  maxRequests: number; // Max requests per window
  prefix: string;      // Key prefix for bucket isolation
}

/**
 * Create a rate limiting middleware
 */
export function rateLimit(config: RateLimitConfig) {
  const { windowMs, maxRequests, prefix } = config;

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${prefix}:${ip}`;
    const now = Date.now();

    let bucket = buckets.get(key);

    if (!bucket || now > bucket.resetAt) {
      // New window
      bucket = { count: 1, resetAt: now + windowMs };
      buckets.set(key, bucket);
    } else {
      bucket.count++;
    }

    // Set rate limit headers
    const remaining = Math.max(0, maxRequests - bucket.count);
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(bucket.resetAt / 1000));

    if (bucket.count > maxRequests) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      res.status(429).json({
        error: 'Too many requests',
        retryAfter,
        limit: maxRequests,
        windowMs,
      });
      return;
    }

    next();
  };
}

/**
 * Pre-configured limiters
 */

/** API routes: 120 requests per minute */
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  maxRequests: 120,
  prefix: 'api',
});

/** Proxy routes: 30 requests per minute (heavier — each hits Gateway) */
export const proxyLimiter = rateLimit({
  windowMs: 60_000,
  maxRequests: 30,
  prefix: 'proxy',
});

/** Health endpoint: 20 requests per minute */
export const healthLimiter = rateLimit({
  windowMs: 60_000,
  maxRequests: 20,
  prefix: 'health',
});

/**
 * Get current rate limit stats (for diagnostics)
 */
export function getRateLimitStats() {
  const now = Date.now();
  const active = Array.from(buckets.entries())
    .filter(([, b]) => now < b.resetAt)
    .map(([key, b]) => ({
      key,
      count: b.count,
      resetsIn: Math.ceil((b.resetAt - now) / 1000),
    }));

  return {
    activeBuckets: active.length,
    totalTracked: buckets.size,
    buckets: active,
  };
}
