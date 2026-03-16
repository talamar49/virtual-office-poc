# Security Audit — Virtual Office POC

> **Auditor:** עידו 🦞 — OpenClaw Expert  
> **Date:** 2026-03-16  
> **Scope:** XSS, CSRF, token handling, input validation, auth flow  
> **Files reviewed:** `server/src/`, `src/App.tsx`

---

## Executive Summary

Virtual Office is an internal tool for monitoring/chatting with OpenClaw agents. The main security surface is the **Gateway token** (grants full OpenClaw access). The architecture is sound — tokens flow via request headers, not server-side env vars — but several hardening gaps need addressing.

**Risk level: MEDIUM** (internal tool, not public-facing — lower urgency, but real risks if exposed)

---

## 🔴 HIGH — Fix First

### H1: Gateway Token Stored Unprotected in localStorage

**File:** `src/App.tsx:2692-2697`

```typescript
const [token, setToken] = useState(localStorage.getItem('gateway-token') || '')
localStorage.setItem('gateway-token', token)
localStorage.setItem('gateway-url', url)
```

**Risk:** localStorage is accessible to any JavaScript on the page. If an XSS vulnerability is ever found (or a third-party script is compromised), the Gateway token — which grants full OpenClaw access — is immediately stolen.

**Fix:**
```typescript
// Option A (simple): Use sessionStorage instead of localStorage
// Token lives only for this browser tab session
sessionStorage.setItem('gateway-token', token)

// Option B (better): Never persist the token
// Require re-entry each page load — acceptable for internal tool
// Display a clear "token expires on tab close" notice

// Option C (best for future): Move token to httpOnly cookie set by backend
// POST /api/connect { token, url } → backend sets httpOnly cookie
// Frontend never touches the raw token
```

---

### H2: Seating API Has No Authentication

**File:** `server/src/routes/seating.ts`

```typescript
// POST /api/seating — anyone can reassign any agent's seat
seatingRouter.post('/', async (req: any, res: any) => {
  const { agentId, room, col, row } = req.body;
  // No auth check at all
  assignments[agentId] = { room, col, row };
  await saveSeating(assignments);
```

**Risk:** Any user who can reach the server can arbitrarily reassign agents' seat positions. Also `DELETE /api/seating/:id` is unprotected — anyone can delete assignments.

More critically: the `agentId` input is used directly as a dictionary key written to disk with no sanitization. A malicious `agentId` like `../../../etc/passwd` could cause path traversal issues in future if the key is used in file paths.

**Fix:**
```typescript
// Add simple auth middleware for write operations
import { Request, Response, NextFunction } from 'express';

function requireGatewayAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers['x-gateway-token'];
  if (!token || typeof token !== 'string' || token.trim().length < 8) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// Apply to POST/DELETE
seatingRouter.post('/', requireGatewayAuth, async (req, res) => { ... });
seatingRouter.delete('/:id', requireGatewayAuth, async (req, res) => { ... });

// Sanitize agentId — only allow alphanumeric + dash/underscore
function isValidAgentId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}
```

---

## 🟡 MEDIUM — Fix Soon

### M1: CORS Wildcard — Accepts Requests from Any Origin

**File:** `server/src/index.ts:24`

```typescript
app.use(cors()); // wildcard — allows ALL origins
```

**Risk:** Any website can make requests to the backend (CORS bypass). For an internal tool this is a real issue — a malicious site could trick a logged-in user's browser into making requests to the Virtual Office backend.

**Fix:**
```typescript
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') ?? [
  'http://localhost:5173',  // Vite dev
  'http://localhost:3001',  // production
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  credentials: true,
}));
```

---

### M2: Gateway URL Not Validated Server-Side

**File:** `server/src/routes/proxy.ts:270-277`

```typescript
// Client-side validates URL format, but server only does:
try {
  const parsedUrl = new URL(gatewayUrl);
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Invalid protocol');
  }
} catch { ... }
```

**Risk (SSRF):** The proxy will forward requests to any URL — including `http://localhost`, `http://127.0.0.1`, `http://169.254.169.254` (AWS metadata), internal network addresses. An attacker could probe internal services via the proxy.

**Fix:**
```typescript
import { isPrivateIP } from 'private-ip'; // or implement manually

function isSafeGatewayUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    
    const hostname = url.hostname;
    // Block localhost and private IPs (unless explicitly allowed by config)
    const allowedHosts = process.env.ALLOWED_GATEWAY_HOSTS?.split(',');
    if (allowedHosts) {
      return allowedHosts.some(h => hostname === h || hostname.endsWith(`.${h}`));
    }
    return true; // If no allowlist, allow all (current behavior)
  } catch {
    return false;
  }
}
```

Note: Since the Gateway typically runs on localhost, SSRF is a lower risk here. But worth adding the allowlist anyway.

---

### M3: No Input Length/Type Validation on Proxy Routes

**File:** `server/src/routes/proxy.ts`

```typescript
const { activeMinutes = 120, messageLimit = 1 } = req.body ?? {};
// activeMinutes could be -1, NaN, 999999, an object, etc.
// These are forwarded directly to the Gateway

const { sessionKey, message, agentId } = req.body ?? {};
// message has no max length — could be 100MB
// sessionKey has no format validation
```

**Fix:**
```typescript
// Validate and sanitize inputs before forwarding
function toPositiveInt(val: unknown, defaultVal: number, max: number): number {
  const n = parseInt(String(val), 10);
  if (isNaN(n) || n <= 0) return defaultVal;
  return Math.min(n, max);
}

const activeMinutes = toPositiveInt(req.body?.activeMinutes, 120, 1440); // max 24h
const messageLimit = toPositiveInt(req.body?.messageLimit, 1, 50);

// For send:
const message = String(req.body?.message ?? '').slice(0, 10_000); // max 10k chars
const sessionKey = String(req.body?.sessionKey ?? '');
if (!/^[a-zA-Z0-9:_-]{1,256}$/.test(sessionKey)) {
  res.status(400).json({ error: 'Invalid sessionKey format' });
  return;
}
```

---

### M4: Transcribe `lang` Parameter Not Validated

**File:** `server/src/routes/transcribe.ts:65`

```typescript
const lang = (req.body?.lang as string) || 'auto';
// lang is passed directly to execFile as CLI argument
```

**Risk:** While `execFile` (not `exec`) is used (good — no shell injection), the `lang` value is still passed as a CLI argument to whisper-cli. A value like `--model /etc/passwd` could potentially confuse whisper's argument parsing.

**Fix:**
```typescript
const VALID_LANGS = new Set([
  'auto', 'he', 'en', 'ar', 'fr', 'de', 'es', 'ru', 'zh', 'ja', 'pt', 'it'
]);

const rawLang = String(req.body?.lang ?? 'auto').toLowerCase().trim();
const lang = VALID_LANGS.has(rawLang) ? rawLang : 'auto';
```

---

## 🟢 LOW / INFO

### L1: No Rate Limiting

None of the proxy endpoints have rate limiting. A client could spam `/api/proxy/send` 1000 times/second, causing costs or resource exhaustion on the Gateway.

**Fix:** Add `express-rate-limit`:
```typescript
import rateLimit from 'express-rate-limit';

const proxyLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 30,               // 30 requests per minute per IP
  message: { error: 'Too many requests, slow down' },
});

app.use('/api/proxy', proxyLimiter);
```

---

### L2: No HTTPS Enforcement

The app runs on plain HTTP by default. Gateway tokens are sent over the wire unencrypted.

**Fix:** Add a note/check in startup:
```typescript
if (process.env.NODE_ENV === 'production' && !process.env.HTTPS_ENABLED) {
  console.warn('⚠️  WARNING: Running without HTTPS — Gateway tokens sent in plaintext!');
}
```

For production, put behind nginx/Caddy with TLS.

---

### L3: XSS — React Renders Safely (No Issues Found)

React's JSX escapes all interpolated values by default. No `dangerouslySetInnerHTML` usage was found in `App.tsx`. Agent names, messages, and chat content are all rendered through React — **no XSS vulnerabilities found**.

✅ This is good practice and should be maintained.

---

### L4: CSRF — Not Applicable Here

CSRF is typically a risk when:
1. The server uses cookie-based auth
2. State-changing requests rely on that cookie

Since this app uses `X-Gateway-Token` headers (not cookies), CSRF is **not applicable**. Browsers don't auto-send custom headers cross-origin.

✅ Current architecture is inherently CSRF-safe.

---

## Auth Flow Summary

```
Browser
  │
  │  X-Gateway-Token header
  ▼
Express Proxy (port 3001)
  │
  │  Bearer <token>  (forwarded)
  ▼
OpenClaw Gateway (port 18789)
```

**What's good:**
- Token flows in headers, not URLs (not leaked in logs)
- URL validation exists on proxy routes
- Token is not stored in server .env (user supplies it)
- Routing validation: agentId ↔ sessionKey mismatch is blocked

**What's missing:**
- Token not validated server-side (any string accepted)
- No rate limiting
- Seating routes unprotected

---

## Priority Fix Order

| Priority | Issue | Effort |
|----------|-------|--------|
| 🔴 HIGH | H1: Token in localStorage → sessionStorage or httpOnly cookie | 30 min |
| 🔴 HIGH | H2: Seating API unprotected → add auth middleware | 30 min |
| 🟡 MED | M1: CORS wildcard → restrict to allowed origins | 15 min |
| 🟡 MED | M3: Input validation on proxy routes | 45 min |
| 🟡 MED | M4: lang whitelist in transcribe | 10 min |
| 🟡 MED | M2: Gateway URL SSRF protection | 30 min |
| 🟢 LOW | L1: Rate limiting | 20 min |
| 🟢 LOW | L2: HTTPS warning | 5 min |

**Total estimated effort: ~3 hours**

---

_Audit by עידו 🦞 | 2026-03-16_
