// Response hardening and a per-client token-bucket rate limiter for /api.

export function securityHeaders({ hsts }) {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  const headers = {
    'content-security-policy': csp,
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
  };
  if (hsts) headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
  return headers;
}

export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  }
  return req.socket?.remoteAddress ?? 'unknown';
}

export function createRateLimiter({ perMinute, now = () => Date.now(), maxClients = 10000 }) {
  const buckets = new Map();
  const refillPerMs = perMinute / 60000;
  return {
    // Returns 0 when allowed, otherwise the seconds to wait before retrying.
    take(key) {
      const t = now();
      let b = buckets.get(key);
      if (!b) {
        if (buckets.size >= maxClients) buckets.delete(buckets.keys().next().value);
        b = { tokens: perMinute, at: t };
        buckets.set(key, b);
      }
      b.tokens = Math.min(perMinute, b.tokens + (t - b.at) * refillPerMs);
      b.at = t;
      if (b.tokens >= 1) {
        b.tokens -= 1;
        return 0;
      }
      return Math.ceil((1 - b.tokens) / refillPerMs / 1000);
    },
    size: () => buckets.size,
  };
}
