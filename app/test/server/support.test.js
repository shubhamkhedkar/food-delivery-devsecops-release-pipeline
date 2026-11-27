import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMetrics } from '../../src/server/metrics.js';
import { clientIp, createRateLimiter, securityHeaders } from '../../src/server/security.js';
import { loadStatic } from '../../src/server/static.js';

describe('security headers', () => {
  it('sets a strict CSP and optional HSTS', () => {
    const h = securityHeaders({ hsts: false });
    expect(h['content-security-policy']).toContain("script-src 'self'");
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['strict-transport-security']).toBeUndefined();
    expect(securityHeaders({ hsts: true })['strict-transport-security']).toMatch(/max-age=31536000/);
  });

  it('only trusts X-Forwarded-For when told to', () => {
    const req = { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }, socket: { remoteAddress: '10.0.0.2' } };
    expect(clientIp(req, false)).toBe('10.0.0.2');
    expect(clientIp(req, true)).toBe('203.0.113.9');
    expect(clientIp({ headers: {}, socket: {} }, true)).toBe('unknown');
  });
});

describe('rate limiter', () => {
  it('allows a burst, then asks the client to wait, then refills', () => {
    let t = 0;
    const limiter = createRateLimiter({ perMinute: 2, now: () => t });
    expect(limiter.take('a')).toBe(0);
    expect(limiter.take('a')).toBe(0);
    expect(limiter.take('a')).toBe(30);
    expect(limiter.take('b')).toBe(0);
    t = 30_000;
    expect(limiter.take('a')).toBe(0);
  });

  it('evicts the oldest client when the table is full', () => {
    const limiter = createRateLimiter({ perMinute: 5, maxClients: 2 });
    ['a', 'b', 'c'].forEach((k) => limiter.take(k));
    expect(limiter.size()).toBe(2);
  });
});

describe('metrics', () => {
  it('renders counters, gauges and histograms in Prometheus text format', () => {
    const m = createMetrics({ version: '1.2.3', commit: 'abc', city: 'Pune' });
    m.requests.inc({ route: 'api_meta', method: 'GET', code: '200' });
    m.requests.inc({ route: 'api_meta', method: 'GET', code: '200' });
    m.duration.observe({ route: 'api_meta' }, 0.02);
    m.orderValue.observe({}, 45000);
    m.coupons.inc({ code: 'WEIRD"\\\n' });
    m.rateLimited.inc();
    const text = m.render();
    expect(m.requests.get({ code: '200', method: 'GET', route: 'api_meta' })).toBe(2);
    expect(m.rateLimited.get()).toBe(1);
    expect(text).toContain('platewise_http_requests_total{code="200",method="GET",route="api_meta"} 2');
    expect(text).toContain('platewise_http_request_duration_seconds_bucket{route="api_meta",le="0.025"} 1');
    expect(text).toContain('platewise_order_value_paise_bucket{le="60000"} 1');
    expect(text).toContain('platewise_order_value_paise_bucket{le="40000"} 0');
    expect(text).toContain('platewise_order_value_paise_count 1');
    expect(text).toContain('code="WEIRD\\"\\\\\\n"');
    expect(text).toMatch(/platewise_build_info\{city="Pune",commit="abc",node_version="v\d+[^"]*",version="1.2.3"\} 1/);
    expect(text).toMatch(/process_resident_memory_bytes \d+/);
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('static files', () => {
  it('loads known types only, with immutable caching for fingerprinted assets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'platewise-static-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html>');
    writeFileSync(join(dir, 'assets', 'app-1.js'), 'x');
    writeFileSync(join(dir, 'notes.env'), 'SECRET=1');
    const files = loadStatic(dir);
    expect([...files.keys()].sort()).toEqual(['/assets/app-1.js', '/index.html']);
    expect(files.get('/assets/app-1.js').cacheControl).toContain('immutable');
    expect(files.get('/index.html').cacheControl).toBe('no-cache');
    expect(loadStatic(join(dir, 'missing')).size).toBe(0);
  });
});
