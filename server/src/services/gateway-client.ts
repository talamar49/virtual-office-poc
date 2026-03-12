/**
 * Gateway HTTP Client
 * 
 * Communicates with OpenClaw Gateway via POST /tools/invoke.
 * Features: retry with exponential backoff, timeout, circuit breaker.
 */

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1_000;

// --- Circuit Breaker ---
let consecutiveFailures = 0;
let circuitOpenUntil = 0;
const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_RESET_MS = 30_000;

function isCircuitOpen(): boolean {
  if (consecutiveFailures < CIRCUIT_THRESHOLD) return false;
  if (Date.now() > circuitOpenUntil) return false; // half-open
  return true;
}

function recordSuccess(): void { consecutiveFailures = 0; }

function recordFailure(): void {
  consecutiveFailures++;
  if (consecutiveFailures >= CIRCUIT_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_RESET_MS;
    console.warn(`[Gateway] Circuit breaker OPEN — ${consecutiveFailures} failures. Retry in ${CIRCUIT_RESET_MS / 1000}s`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Invoke a Gateway tool with retry logic.
 * 
 * The Gateway returns: { ok, result: { content: [...], details: { sessions: [...] } } }
 * We return the parsed details object for convenience.
 */
export async function invokeTool<T = unknown>(
  tool: string,
  params: Record<string, unknown> = {},
  options: { retries?: number; timeoutMs?: number } = {}
): Promise<T> {
  const { retries = MAX_RETRIES, timeoutMs = REQUEST_TIMEOUT_MS } = options;

  if (isCircuitOpen()) {
    throw Object.assign(new Error('Circuit breaker open — Gateway unreachable'), {
      status: 503, retryable: true,
    });
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(`${GATEWAY_URL}/tools/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(GATEWAY_TOKEN ? { Authorization: `Bearer ${GATEWAY_TOKEN}` } : {}),
        },
        body: JSON.stringify({ tool, args: params }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const isRetryable = res.status >= 500 || res.status === 429;
        const error = Object.assign(
          new Error(`Gateway ${res.status}: ${res.statusText}`),
          { status: res.status, retryable: isRetryable }
        );
        if (!isRetryable || attempt === retries) { recordFailure(); throw error; }
        lastError = error;
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500;
        console.warn(`[Gateway] Attempt ${attempt + 1} failed (${res.status}). Retry in ${Math.round(delay)}ms`);
        await sleep(delay);
        continue;
      }

      const data = await res.json();
      recordSuccess();
      return data as T;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        lastError = new Error(`Gateway timeout after ${timeoutMs}ms`);
      } else if (err.status) {
        if (attempt === retries) throw err;
        lastError = err;
      } else {
        lastError = err;
      }
      if (attempt < retries) {
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500;
        console.warn(`[Gateway] Attempt ${attempt + 1}: ${(lastError as Error).message}. Retry in ${Math.round(delay)}ms`);
        await sleep(delay);
      }
    }
  }

  recordFailure();
  throw lastError ?? new Error('Gateway request failed');
}

/**
 * Fetch all active sessions.
 * Parses the Gateway's nested response format.
 */
export async function fetchSessions(activeMinutes = 120): Promise<any[]> {
  const data = await invokeTool<any>('sessions_list', {
    activeMinutes,
    messageLimit: 1,
  });

  // Gateway wraps response: { ok, result: { details: { sessions } } }
  const sessions =
    data?.result?.details?.sessions ??
    data?.sessions ??
    data?.result?.sessions ??
    [];

  return sessions;
}

/**
 * Gateway health check
 */
export async function checkGatewayHealth(): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    await invokeTool('sessions_list', { activeMinutes: 1, messageLimit: 0 }, {
      retries: 0, timeoutMs: 5_000,
    });
    return { ok: true, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}

export function getCircuitStatus() {
  return {
    failures: consecutiveFailures,
    isOpen: isCircuitOpen(),
    opensAt: CIRCUIT_THRESHOLD,
    resetsAt: circuitOpenUntil > Date.now() ? new Date(circuitOpenUntil).toISOString() : null,
  };
}
