import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHandler } from '../../src/server/app.js';
import { loadConfig } from '../../src/server/config.js';
import { createMetrics } from '../../src/server/metrics.js';
import { loadStatic } from '../../src/server/static.js';

function fixtureDir() {
  const dir = mkdtempSync(join(tmpdir(), 'platewise-http-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Platewise</title>');
  writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
  return dir;
}

async function boot(env = {}, { clock } = {}) {
  const cfg = loadConfig({ STATIC_DIR: fixtureDir(), RATE_LIMIT_PER_MINUTE: '1000', ORDER_SIGNING_KEY: 'k'.repeat(40), ...env });
  const metrics = createMetrics({ version: cfg.version, commit: cfg.commit, city: cfg.city });
  const state = { draining: false };
  const errors = [];
  const handler = createHandler({
    cfg,
    metrics,
    files: loadStatic(cfg.staticDir),
    state,
    logger: { error: (e) => errors.push(e) },
    now: clock ?? (() => Date.now()),
  });
  const server = createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (p, init) => fetch(base + p, init);
  const post = (p, body, headers = { 'content-type': 'application/json' }) =>
    fetch(base + p, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { server, base, state, metrics, errors, get, post };
}

const CART = { restaurantId: 'misal-mandal', items: [{ id: 'mm-misal-pav', qty: 2 }] };

describe('HTTP API', () => {
  let app;
  let t = Date.UTC(2026, 10, 27, 7, 0, 0);
  beforeAll(async () => {
    app = await boot({}, { clock: () => t });
  });
  afterAll(() => app.server.close());

  it('serves liveness, version and readiness that flips while draining', async () => {
    expect((await app.get('/healthz/live')).status).toBe(200);
    expect(await (await app.get('/version')).json()).toEqual({ version: '0.0.0-dev', commit: 'unknown' });
    expect(await (await app.get('/healthz/ready')).json()).toEqual({ status: 'ready', signingKey: 'env' });
    app.state.draining = true;
    expect((await app.get('/healthz/ready')).status).toBe(503);
    app.state.draining = false;
  });

  it('sends security headers on every response', async () => {
    const res = await app.get('/api/meta');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    const body = await res.json();
    expect(body.city).toBe('Pune');
    expect(body.coupons.map((c) => c.code)).toEqual(['WELCOME50', 'FLAT75', 'FREEDEL']);
  });

  it('lists and filters restaurants and validates query parameters', async () => {
    const all = await (await app.get('/api/restaurants')).json();
    expect(all.count).toBe(8);
    const veg = await (await app.get('/api/restaurants?veg=true&sort=rating')).json();
    expect(veg.restaurants[0].id).toBe('misal-mandal');
    const sea = await (await app.get('/api/restaurants?cuisine=Seafood&minRating=4')).json();
    expect(sea.restaurants.map((r) => r.id)).toEqual(['coastal-curry-co']);
    for (const [qs, code] of [
      ['sort=price', 'invalid_sort'],
      ['cuisine=Martian', 'invalid_cuisine'],
      [`q=${'a'.repeat(61)}`, 'query_too_long'],
      ['minRating=9', 'invalid_min_rating'],
      ['minRating=abc', 'invalid_min_rating'],
    ]) {
      const res = await app.get(`/api/restaurants?${qs}`);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(code);
    }
  });

  it('returns a restaurant with its menu or 404', async () => {
    const res = await app.get('/api/restaurants/dosa-district');
    expect((await res.json()).menu.length).toBeGreaterThan(0);
    expect((await app.get('/api/restaurants/ghost-kitchen')).status).toBe(404);
    expect((await app.get('/api/restaurants/..%2Fetc')).status).toBe(404);
    expect((await app.get('/api/restaurants/dosa-district/extra')).status).toBe(404);
  });

  it('prices a quote and rejects bad carts with a 400 and a reason', async () => {
    const res = await app.post('/api/quote', { ...CART, coupon: 'freedel' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ subtotal: 27800, deliveryFee: 0, coupon: { code: 'FREEDEL', applied: true } });
    const bad = await app.post('/api/quote', { restaurantId: 'misal-mandal', items: [{ id: 'mm-misal-pav', qty: 99 }] });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'invalid_quantity', id: 'mm-misal-pav', max: 20 });
    expect(app.metrics.quotes.get({ outcome: 'rejected' })).toBeGreaterThan(0);
  });

  it('enforces content type, JSON syntax, body size and methods', async () => {
    expect((await app.post('/api/quote', CART, { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await app.post('/api/quote', '{nope')).status).toBe(400);
    const huge = await app.post('/api/quote', { ...CART, pad: 'x'.repeat(20000) });
    expect(huge.status).toBe(413);
    const wrong = await app.get('/api/quote');
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get('allow')).toBe('POST');
    expect((await app.post('/api/meta', {})).status).toBe(405);
    expect((await app.get('/api/unknown')).status).toBe(404);
  });

  it('stops reading a chunked body that grows past the limit', async () => {
    const status = await new Promise((resolve, reject) => {
      const req = request(`${app.base}/api/quote`, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.write('{"pad":"');
      req.write('x'.repeat(20000));
      req.end('"}');
    });
    expect(status).toBe(413);
  });

  it('places an order, then tracks it through to delivery', async () => {
    const res = await app.post('/api/orders', { ...CART, coupon: 'WELCOME50', customerName: 'Priya Desai' });
    expect(res.status).toBe(201);
    const order = await res.json();
    expect(order).toMatchObject({ status: 'placed', customer: 'Priya Desai', items: 2, minutesRemaining: 24 });
    expect(res.headers.get('location')).toBe(`/api/orders/${order.orderId}`);
    t += 12 * 60_000;
    expect((await (await app.get(`/api/orders/${order.orderId}`)).json()).status).toBe('out_for_delivery');
    t += 60 * 60_000;
    expect((await (await app.get(`/api/orders/${order.orderId}`)).json()).status).toBe('delivered');
    expect(app.metrics.orders.get({ restaurant: 'misal-mandal' })).toBe(1);
    expect(app.metrics.coupons.get({ code: 'WELCOME50' })).toBe(1);
  });

  it('refuses orders without a valid name or with an unusable coupon, and unknown order ids', async () => {
    const noName = await app.post('/api/orders', { ...CART, customerName: '<script>' });
    expect((await noName.json()).error).toBe('invalid_customer_name');
    expect((await app.post('/api/orders', { ...CART })).status).toBe(400);
    const coupon = await app.post('/api/orders', { ...CART, coupon: 'FLAT75', customerName: 'Ravi' });
    expect(coupon.status).toBe(409);
    expect((await coupon.json()).coupon.reason).toBe('minimum_not_met');
    expect((await app.get('/api/orders/not-a-token')).status).toBe(404);
  });

  it('serves fingerprinted assets, the SPA shell, ETags and 404s', async () => {
    const asset = await app.get('/assets/app-abc123.js');
    expect(asset.headers.get('cache-control')).toContain('immutable');
    const again = await app.get('/assets/app-abc123.js', { headers: { 'if-none-match': asset.headers.get('etag') } });
    expect(again.status).toBe(304);
    expect(await (await app.get('/restaurants/tawa-junction')).text()).toContain('Platewise');
    expect((await app.get('/', { method: 'HEAD' })).status).toBe(200);
    expect((await app.get('/missing.png')).status).toBe(404);
    expect((await app.post('/', {})).status).toBe(405);
  });

  it('exposes Prometheus metrics', async () => {
    const text = await (await app.get('/metrics')).text();
    expect(text).toContain('platewise_http_requests_total');
    expect(text).toContain('platewise_orders_total{restaurant="misal-mandal"} 1');
  });
});

describe('rate limiting and failures', () => {
  it('returns 429 with Retry-After once a client exhausts its budget', async () => {
    const app = await boot({ RATE_LIMIT_PER_MINUTE: '2' });
    expect((await app.get('/api/meta')).status).toBe(200);
    expect((await app.get('/api/meta')).status).toBe(200);
    const res = await app.get('/api/meta');
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await app.get('/healthz/live')).status).toBe(200);
    app.server.close();
  });

  it('logs and returns 500 on unexpected errors without leaking details', async () => {
    const app = await boot({}, { clock: () => { throw new Error('clock exploded'); } });
    const res = await app.post('/api/orders', { ...CART, customerName: 'Ravi' });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'internal_error' });
    expect(app.errors[0]).toContain('clock exploded');
    app.server.close();
  });
});
