/**
 * Gateway Proxy Routes
 * 
 * Generic proxy that forwards requests to any OpenClaw Gateway.
 * The user's token + URL come from request headers, NOT from server .env.
 * This solves CORS — the browser talks to our backend, we talk to the Gateway.
 */

import { Router, type Request, type Response } from 'express';

export const proxyRouter: ReturnType<typeof Router> = Router();

const PROXY_TIMEOUT_MS = 15_000;

/**
 * POST /api/proxy/sessions
 * 
 * Headers:
 *   X-Gateway-Token: <user's gateway token>
 *   X-Gateway-URL: <user's gateway URL, e.g. http://127.0.0.1:18789>
 * 
 * Forwards: POST /tools/invoke { tool: "sessions_list", params: { activeMinutes, messageLimit } }
 * Returns: The Gateway's response as-is.
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
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(gatewayUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Invalid protocol');
    }
  } catch {
    res.status(400).json({ error: 'Invalid X-Gateway-URL — must be a valid http/https URL' });
    return;
  }

  const { activeMinutes = 120, messageLimit = 1 } = req.body ?? {};

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
        params: { activeMinutes, messageLimit },
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

    // Parse sessions from Gateway's nested response format
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

    // Network errors (ECONNREFUSED, DNS failures, etc.)
    const message = err.cause?.code === 'ECONNREFUSED'
      ? `Cannot connect to Gateway at ${gatewayUrl} — is it running?`
      : err.message || 'Unknown proxy error';

    res.status(502).json({ error: message });
  }
});

/**
 * POST /api/proxy/health
 * 
 * Quick connectivity check to the user's Gateway.
 * Same headers as /sessions.
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
        params: { activeMinutes: 1, messageLimit: 0 },
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
