import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CUISINES, getRestaurant, RESTAURANTS, searchRestaurants, SORT_KEYS } from '../../src/server/catalog.js';
import { loadConfig } from '../../src/server/config.js';
import { createOrderToken, orderStatus, STAGES, verifyOrderToken } from '../../src/server/orders.js';
import { CartError, COUPONS, FREE_DELIVERY_ABOVE, priceCart, resolveCart } from '../../src/server/pricing.js';

const KEY = Buffer.from('k'.repeat(32));
const cartError = (fn) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(CartError);
    return err.code;
  }
  throw new Error('expected a CartError');
};

describe('catalog', () => {
  it('has unique restaurant and item ids, integer paise prices and sane ratings', () => {
    const ids = RESTAURANTS.map((r) => r.id);
    const items = RESTAURANTS.flatMap((r) => r.menu.map((m) => m.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(items).size).toBe(items.length);
    for (const r of RESTAURANTS) {
      expect(r.rating).toBeGreaterThanOrEqual(0);
      expect(r.rating).toBeLessThanOrEqual(5);
      for (const m of r.menu) expect(Number.isInteger(m.price) && m.price > 0).toBe(true);
      if (r.pureVeg) expect(r.menu.every((m) => m.veg)).toBe(true);
    }
    expect(CUISINES).toEqual([...CUISINES].sort());
  });

  it('searches names, areas, cuisines and dishes case-insensitively', () => {
    expect(searchRestaurants({ q: 'MISAL' }).map((r) => r.id)).toEqual(['misal-mandal']);
    expect(searchRestaurants({ q: 'baner' }).map((r) => r.id)).toEqual(['tawa-junction']);
    expect(searchRestaurants({ q: 'tiramisu' }).map((r) => r.id)).toEqual(['crust-and-co']);
    expect(searchRestaurants({ q: 'nothing-like-this' })).toEqual([]);
    expect(searchRestaurants().length).toBe(RESTAURANTS.length);
  });

  it('filters by cuisine, pure veg and rating and never leaks menus in summaries', () => {
    expect(searchRestaurants({ cuisine: 'Seafood' }).map((r) => r.id)).toEqual(['coastal-curry-co']);
    const veg = searchRestaurants({ veg: true });
    expect(veg.length).toBeGreaterThan(0);
    expect(veg.every((r) => r.pureVeg)).toBe(true);
    expect(searchRestaurants({ minRating: 4.5 }).every((r) => r.rating >= 4.5)).toBe(true);
    expect(veg[0].menu).toBeUndefined();
    expect(Array.isArray(veg[0].bestsellers)).toBe(true);
  });

  it.each(SORT_KEYS)('sorts by %s deterministically', (sort) => {
    const list = searchRestaurants({ sort });
    expect(list).toHaveLength(RESTAURANTS.length);
    if (sort === 'rating') expect(list[0].rating).toBe(Math.max(...RESTAURANTS.map((r) => r.rating)));
    if (sort === 'eta') expect(list[0].etaMinutes).toBe(Math.min(...RESTAURANTS.map((r) => r.etaMinutes)));
    if (sort === 'cost_asc') expect(list[0].costForTwo).toBeLessThanOrEqual(list.at(-1).costForTwo);
    if (sort === 'cost_desc') expect(list[0].costForTwo).toBeGreaterThanOrEqual(list.at(-1).costForTwo);
  });

  it('falls back to relevance for an unknown sort and resolves ids', () => {
    expect(searchRestaurants({ sort: 'bogus' }).map((r) => r.id)).toEqual(RESTAURANTS.map((r) => r.id));
    expect(getRestaurant('dosa-district').name).toBe('Dosa District');
    expect(getRestaurant('nope')).toBeNull();
  });
});

describe('cart validation', () => {
  const ok = { restaurantId: 'dosa-district', items: [{ id: 'dd-masala-dosa', qty: 1 }] };
  it.each([
    [null, 'invalid_body'],
    [[], 'invalid_body'],
    [{ restaurantId: 7 }, 'unknown_restaurant'],
    [{ restaurantId: 'ghost' }, 'unknown_restaurant'],
    [{ restaurantId: 'dosa-district', items: [] }, 'empty_cart'],
    [{ restaurantId: 'dosa-district' }, 'empty_cart'],
    [{ restaurantId: 'dosa-district', items: Array.from({ length: 26 }, () => ({ id: 'dd-masala-dosa', qty: 1 })) }, 'too_many_lines'],
    [{ restaurantId: 'dosa-district', items: [null] }, 'invalid_line'],
    [{ restaurantId: 'dosa-district', items: [{ id: 1, qty: 1 }] }, 'invalid_line'],
    [{ restaurantId: 'dosa-district', items: [{ id: 'dd-masala-dosa', qty: 0 }] }, 'invalid_quantity'],
    [{ restaurantId: 'dosa-district', items: [{ id: 'dd-masala-dosa', qty: 1.5 }] }, 'invalid_quantity'],
    [{ restaurantId: 'dosa-district', items: [{ id: 'dd-masala-dosa', qty: 21 }] }, 'invalid_quantity'],
    [{ restaurantId: 'dosa-district', items: [{ id: 'dd-masala-dosa', qty: 15 }, { id: 'dd-masala-dosa', qty: 6 }] }, 'invalid_quantity'],
    [{ restaurantId: 'dosa-district', items: [{ id: 'tj-dal-makhani', qty: 1 }] }, 'unknown_item'],
    [{ ...ok, coupon: 42 }, 'invalid_coupon'],
    [{ ...ok, coupon: 'X'.repeat(21) }, 'invalid_coupon'],
  ])('rejects %j with %s', (body, code) => {
    expect(cartError(() => resolveCart(body))).toBe(code);
  });

  it('merges duplicate lines and normalises coupon codes', () => {
    const cart = resolveCart({ ...ok, items: [...ok.items, { id: 'dd-masala-dosa', qty: 2 }], coupon: ' freedel ' });
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0].qty).toBe(3);
    expect(cart.coupon).toBe('FREEDEL');
    expect(resolveCart({ ...ok, coupon: '' }).coupon).toBeNull();
    expect(resolveCart({ ...ok, coupon: null }).coupon).toBeNull();
  });
});

describe('pricing', () => {
  const quote = (items, coupon, restaurantId = 'tawa-junction') => priceCart(resolveCart({ restaurantId, items, coupon }));

  it('adds packaging, delivery and 5% GST in integer paise', () => {
    const q = quote([{ id: 'tj-garlic-naan', qty: 2 }]);
    expect(q).toMatchObject({ subtotal: 13800, discount: 0, packagingFee: 2000, deliveryFee: 3500, gst: 790, total: 20090 });
    expect(q.lines[0]).toEqual({ id: 'tj-garlic-naan', name: 'Garlic Naan', qty: 2, unitPrice: 6900, lineTotal: 13800 });
  });

  it('waives delivery at the free-delivery threshold', () => {
    const q = quote([{ id: 'tj-butter-chicken', qty: 2 }]);
    expect(q.subtotal).toBeGreaterThanOrEqual(FREE_DELIVERY_ABOVE);
    expect(q.deliveryFee).toBe(0);
  });

  it('applies WELCOME50 capped at ₹100 and refuses it below ₹199', () => {
    expect(quote([{ id: 'tj-dal-makhani', qty: 1 }], 'WELCOME50')).toMatchObject({ discount: 10000, coupon: { applied: true } });
    expect(quote([{ id: 'tj-phirni', qty: 2 }], 'WELCOME50').discount).toBe(10000);
    const low = quote([{ id: 'tj-garlic-naan', qty: 1 }], 'WELCOME50');
    expect(low.discount).toBe(0);
    expect(low.coupon).toEqual({ code: 'WELCOME50', applied: false, reason: 'minimum_not_met', minimum: 19900 });
    expect(COUPONS.WELCOME50.apply(19900).discount).toBe(9950);
  });

  it('applies FLAT75 above ₹399, FREEDEL always, and flags unknown codes', () => {
    expect(quote([{ id: 'tj-butter-chicken', qty: 2 }], 'FLAT75').discount).toBe(7500);
    expect(quote([{ id: 'tj-garlic-naan', qty: 1 }], 'FLAT75').coupon.reason).toBe('minimum_not_met');
    const free = quote([{ id: 'tj-garlic-naan', qty: 1 }], 'FREEDEL');
    expect(free.deliveryFee).toBe(0);
    expect(free.coupon.applied).toBe(true);
    expect(quote([{ id: 'tj-garlic-naan', qty: 1 }], 'FREEFOOD').coupon).toEqual({ code: 'FREEFOOD', applied: false, reason: 'unknown_coupon' });
  });
});

describe('order tokens', () => {
  const q = { restaurantId: 'misal-mandal', total: 32740, lines: [{ qty: 2 }, { qty: 1 }] };
  const now = Date.UTC(2026, 10, 27, 12, 0, 0);

  it('round-trips a signed order and rejects tampering, other keys and junk', () => {
    const token = createOrderToken(KEY, q, { now, etaMinutes: 20, name: 'Asha' });
    expect(verifyOrderToken(KEY, token)).toMatchObject({ r: 'misal-mandal', t: 32740, i: 3, e: 20, c: 'Asha', p: now });
    expect(verifyOrderToken(Buffer.from('z'.repeat(32)), token)).toBeNull();
    const [payload, mac] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), t: 1 })).toString('base64url');
    expect(verifyOrderToken(KEY, `${forged}.${mac}`)).toBeNull();
    expect(verifyOrderToken(KEY, 'abc')).toBeNull();
    expect(verifyOrderToken(KEY, 42)).toBeNull();
    expect(verifyOrderToken(KEY, `${payload}.${'A'.repeat(43)}`)).toBeNull();
  });

  it('rejects correctly signed payloads that are not version-1 JSON', async () => {
    const { createHmac } = await import('node:crypto');
    const signed = (payload) => `${payload}.${createHmac('sha256', KEY).update(payload).digest('base64url')}`;
    expect(verifyOrderToken(KEY, signed(Buffer.from('not json at all here').toString('base64url')))).toBeNull();
    expect(verifyOrderToken(KEY, signed(Buffer.from('{"v":2,"padding":"xxxxx"}').toString('base64url')))).toBeNull();
  });

  it.each([
    [0, 'placed', 20],
    [3, 'preparing', 17],
    [10, 'out_for_delivery', 10],
    [20, 'delivered', 0],
    [90, 'delivered', 0],
  ])('after %i minutes the status is %s', (minutes, status, remaining) => {
    const order = verifyOrderToken(KEY, createOrderToken(KEY, q, { now, etaMinutes: 20, name: 'Asha' }));
    const s = orderStatus(order, now + minutes * 60_000);
    expect(s).toMatchObject({ status, minutesRemaining: remaining, customer: 'Asha', items: 3, stages: STAGES });
    expect(s.etaAt).toBe(new Date(now + 20 * 60_000).toISOString());
  });
});

describe('config', () => {
  it('has development defaults with an ephemeral signing key', () => {
    const cfg = loadConfig({});
    expect(cfg).toMatchObject({ port: 8080, city: 'Pune', rateLimitPerMinute: 120, trustProxy: false, signingKeySource: 'ephemeral' });
    expect(cfg.signingKey).toHaveLength(32);
  });

  it('parses overrides', () => {
    const cfg = loadConfig({ PORT: '9000', TRUST_PROXY: 'yes', HSTS: '1', CITY: 'Mumbai', ORDER_SIGNING_KEY: 's'.repeat(40), GIT_COMMIT: 'a'.repeat(50) });
    expect(cfg).toMatchObject({ port: 9000, trustProxy: true, hsts: true, city: 'Mumbai', signingKeySource: 'env' });
    expect(cfg.commit).toHaveLength(40);
    expect(loadConfig({ TRUST_PROXY: 'no' }).trustProxy).toBe(false);
  });

  it.each([
    [{ PORT: 'eighty' }, /PORT must be an integer/],
    [{ PORT: '70000' }, /PORT must be between/],
    [{ HSTS: 'maybe' }, /HSTS must be true or false/],
    [{ ORDER_SIGNING_KEY: 'short' }, /at least 32 bytes/],
    [{ NODE_ENV: 'production' }, /ORDER_SIGNING_KEY is required/],
  ])('rejects %j', (env, err) => {
    expect(() => loadConfig(env)).toThrow(err);
  });

  it('reads the signing key from a mounted file, trimming the trailing newline', () => {
    const dir = mkdtempSync(join(tmpdir(), 'platewise-key-'));
    const file = join(dir, 'signing-key');
    writeFileSync(file, `${'f'.repeat(48)}\n`);
    const cfg = loadConfig({ NODE_ENV: 'production', ORDER_SIGNING_KEY_FILE: file, ORDER_SIGNING_KEY: 'ignored' });
    expect(cfg.signingKeySource).toBe('file');
    expect(cfg.signingKey.toString()).toBe('f'.repeat(48));
    expect(() => loadConfig({ ORDER_SIGNING_KEY_FILE: join(dir, 'missing') })).toThrow(/ENOENT/);
  });

  it('allows an explicit ephemeral key in production', () => {
    expect(loadConfig({ NODE_ENV: 'production', ALLOW_EPHEMERAL_SIGNING_KEY: 'true' }).production).toBe(true);
  });
});
