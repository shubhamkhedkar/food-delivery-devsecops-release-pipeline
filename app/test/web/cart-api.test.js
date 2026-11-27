import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../src/web/api.js';
import { cartCount, cartLines, cartReducer, emptyCart, MAX_QTY } from '../../src/web/cart.js';
import { rupees, STAGE_LABELS } from '../../src/web/format.js';

describe('cart reducer', () => {
  it('adds, increments, caps, removes and clears', () => {
    let s = cartReducer(emptyCart, { type: 'add', restaurantId: 'a', itemId: 'x' });
    s = cartReducer(s, { type: 'add', restaurantId: 'a', itemId: 'x' });
    s = cartReducer(s, { type: 'add', restaurantId: 'a', itemId: 'y' });
    expect(s).toEqual({ restaurantId: 'a', items: { x: 2, y: 1 } });
    expect(cartCount(s)).toBe(3);
    expect(cartLines(s)).toEqual([{ id: 'x', qty: 2 }, { id: 'y', qty: 1 }]);
    s = cartReducer(s, { type: 'remove', itemId: 'x' });
    s = cartReducer(s, { type: 'remove', itemId: 'y' });
    expect(s.items).toEqual({ x: 1 });
    expect(cartReducer(s, { type: 'remove', itemId: 'x' })).toBe(emptyCart);
    expect(cartReducer(s, { type: 'clear' })).toBe(emptyCart);
    let full = emptyCart;
    for (let i = 0; i < MAX_QTY + 5; i += 1) full = cartReducer(full, { type: 'add', restaurantId: 'a', itemId: 'x' });
    expect(full.items.x).toBe(MAX_QTY);
  });

  it('starts a fresh cart when switching restaurants and rejects unknown actions', () => {
    const a = cartReducer(emptyCart, { type: 'add', restaurantId: 'a', itemId: 'x' });
    expect(cartReducer(a, { type: 'add', restaurantId: 'b', itemId: 'z' })).toEqual({ restaurantId: 'b', items: { z: 1 } });
    expect(() => cartReducer(a, { type: 'explode' })).toThrow(/unknown cart action/);
  });
});

describe('format', () => {
  it('shows paise as rupees', () => {
    expect(rupees(13900)).toBe('₹139');
    expect(rupees(20090)).toBe('₹200.9');
    expect(STAGE_LABELS.out_for_delivery).toBe('Out for delivery');
  });
});

describe('api client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('builds query strings and JSON requests', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await api.restaurants({ q: 'dosa', cuisine: 'South Indian', veg: true, sort: 'rating' });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/restaurants?q=dosa&cuisine=South+Indian&veg=true&sort=rating');
    await api.restaurants({ q: '', sort: 'relevance' });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/restaurants');
    await api.quote({ restaurantId: 'a', items: [] });
    const [, init] = fetchMock.mock.calls[2];
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ restaurantId: 'a', items: [] });
    await api.meta();
    await api.restaurant('a b');
    await api.placeOrder({});
    await api.order('t/1');
    expect(fetchMock.mock.calls.map((c) => c[0]).slice(3)).toEqual(['/api/meta', '/api/restaurants/a%20b', '/api/orders', '/api/orders/t%2F1']);
  });

  it('raises ApiError with the server error code, even for non-JSON bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"rate_limited"}', { status: 429 })));
    await expect(api.meta()).rejects.toMatchObject({ message: 'rate_limited', status: 429 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 })));
    const err = await api.meta().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('http_502');
  });
});
