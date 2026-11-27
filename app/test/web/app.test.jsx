// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CUISINES, getRestaurant, searchRestaurants, SORT_KEYS } from '../../src/server/catalog.js';
import { COUPONS, priceCart, resolveCart } from '../../src/server/pricing.js';
import App from '../../src/web/App.jsx';

// A fake backend built from the real catalog and pricing modules, so the UI is tested against real numbers.
function fakeBackend({ failOrders = null, status = 'placed' } = {}) {
  const calls = [];
  const reply = (body, code = 200) => new Response(JSON.stringify(body), { status: code });
  const fetchMock = vi.fn(async (path, init = {}) => {
    const url = new URL(path, 'http://test');
    calls.push(`${init.method ?? 'GET'} ${url.pathname}${url.search}`);
    if (url.pathname === '/api/meta') {
      return reply({ city: 'Pune', cuisines: CUISINES, sorts: SORT_KEYS, coupons: Object.entries(COUPONS).map(([code, c]) => ({ code, label: c.label })) });
    }
    if (url.pathname === '/api/restaurants') {
      const p = url.searchParams;
      return reply({ restaurants: searchRestaurants({ q: p.get('q') ?? '', cuisine: p.get('cuisine') ?? '', veg: p.get('veg') === 'true', sort: p.get('sort') ?? 'relevance' }) });
    }
    if (url.pathname.startsWith('/api/restaurants/')) return reply(getRestaurant(decodeURIComponent(url.pathname.split('/')[3])));
    if (url.pathname === '/api/quote') return reply(priceCart(resolveCart(JSON.parse(init.body))));
    if (url.pathname === '/api/orders' && init.method === 'POST') {
      if (failOrders) return reply({ error: failOrders }, 400);
      const body = JSON.parse(init.body);
      const q = priceCart(resolveCart(body));
      return reply({ orderId: 'tok-1', quote: q, customer: body.customerName, total: q.total, items: 2, status, minutesRemaining: 24, stages: ['placed', 'preparing', 'out_for_delivery', 'delivered'] }, 201);
    }
    if (url.pathname === '/api/orders/tok-1') return reply({ status: 'out_for_delivery', minutesRemaining: 9 });
    return reply({ error: 'not_found' }, 404);
  });
  return { fetchMock, calls };
}

let backend;
beforeEach(() => {
  backend = fakeBackend();
  vi.stubGlobal('fetch', backend.fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const openMisal = async (user) => {
  await user.click(await screen.findByRole('button', { name: 'Open Misal Mandal' }));
  return screen.findByRole('region', { name: 'Misal Mandal menu' });
};

describe('<App />', () => {
  it('lists restaurants for the city with ratings and veg badges', async () => {
    render(<App debounceMs={0} />);
    expect(await screen.findByText('Delivering in Pune')).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Restaurants' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(8);
    expect(screen.getByLabelText('Rated 4.6 out of 5')).toBeInTheDocument();
    expect(screen.getAllByText('Pure veg').length).toBeGreaterThan(0);
  });

  it('searches and filters through the API, showing an empty state when nothing matches', async () => {
    const user = userEvent.setup();
    render(<App debounceMs={0} />);
    await screen.findByRole('list', { name: 'Restaurants' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Cuisine' }), 'Seafood');
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'eta');
    await user.click(screen.getByRole('checkbox', { name: 'Pure veg' }));
    expect(await screen.findByText(/No restaurants match/)).toBeInTheDocument();
    expect(backend.calls).toContain('GET /api/restaurants?cuisine=Seafood&veg=true&sort=eta');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Cuisine' }), '');
    await user.type(screen.getByRole('searchbox', { name: 'Search restaurants or dishes' }), 'poha');
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
  });

  it('builds a cart, applies a coupon and places an order that is then tracked', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App debounceMs={0} pollMs={1000} />);
    const menu = await openMisal(user);
    await user.click(within(menu).getByRole('button', { name: 'Add Kolhapuri Misal Pav' }));
    await user.click(await within(menu).findByRole('button', { name: 'Add one more Kolhapuri Misal Pav' }));
    expect(within(menu).getByLabelText('Kolhapuri Misal Pav quantity')).toHaveTextContent('2');
    await user.click(within(menu).getByRole('button', { name: 'Add Piyush' }));
    await user.click(await within(menu).findByRole('button', { name: 'Remove one Piyush' }));
    const cart = screen.getByRole('complementary', { name: 'Cart' });
    expect(await within(cart).findByText('2 × Kolhapuri Misal Pav')).toBeInTheDocument();
    expect(screen.getByLabelText('2 items in cart')).toBeInTheDocument();

    await user.type(within(cart).getByRole('textbox', { name: 'Coupon code' }), 'welcome50');
    await user.click(within(cart).getByRole('button', { name: 'Apply' }));
    expect(await within(cart).findByText(/WELCOME50 applied/)).toBeInTheDocument();
    expect(within(cart).getByText('Discount')).toBeInTheDocument();

    await user.type(within(cart).getByRole('textbox', { name: 'Your name' }), 'Shubham');
    await user.click(within(cart).getByRole('button', { name: /Place order/ }));
    const tracker = await screen.findByRole('region', { name: 'Order status' });
    expect(within(tracker).getByText('Thanks, Shubham!')).toBeInTheDocument();
    expect(within(tracker).getByText(/2 items from Misal Mandal/)).toBeInTheDocument();
    expect(within(tracker).getByText('Arriving in about 24 min')).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(1100);
    expect(await within(tracker).findByText('Arriving in about 9 min')).toBeInTheDocument();
    await user.click(within(tracker).getByRole('button', { name: 'Order something else' }));
    expect(screen.getByLabelText('0 items in cart')).toBeInTheDocument();
  });

  it('explains coupons that do not apply and errors from order placement', async () => {
    backend = fakeBackend({ failOrders: 'invalid_customer_name' });
    vi.stubGlobal('fetch', backend.fetchMock);
    const user = userEvent.setup();
    render(<App debounceMs={0} />);
    const menu = await openMisal(user);
    await user.click(within(menu).getByRole('button', { name: 'Add Kanda Poha' }));
    const cart = screen.getByRole('complementary', { name: 'Cart' });
    await within(cart).findByText('1 × Kanda Poha');
    await user.type(within(cart).getByRole('textbox', { name: 'Coupon code' }), 'FLAT75');
    await user.click(within(cart).getByRole('button', { name: 'Apply' }));
    expect(await within(cart).findByText('Add more items to use this code.')).toBeInTheDocument();
    await user.clear(within(cart).getByRole('textbox', { name: 'Coupon code' }));
    await user.type(within(cart).getByRole('textbox', { name: 'Coupon code' }), 'NOPE');
    await user.click(within(cart).getByRole('button', { name: 'Apply' }));
    expect(await within(cart).findByText('That code does not exist.')).toBeInTheDocument();
    await user.type(within(cart).getByRole('textbox', { name: 'Your name' }), 'R2');
    await user.click(within(cart).getByRole('button', { name: /Place order/ }));
    expect(await within(cart).findByRole('alert')).toHaveTextContent('Please enter your name');
  });

  it('shows an empty cart, goes back to the list and handles a delivered order', async () => {
    backend = fakeBackend({ status: 'delivered' });
    vi.stubGlobal('fetch', backend.fetchMock);
    const user = userEvent.setup();
    render(<App debounceMs={0} />);
    expect(screen.getByText('Add dishes from a restaurant to get started.')).toBeInTheDocument();
    const menu = await openMisal(user);
    await user.click(within(menu).getByRole('button', { name: 'Add Sabudana Vada' }));
    await user.click(within(menu).getByRole('button', { name: '← All restaurants' }));
    expect(await screen.findByRole('list', { name: 'Restaurants' })).toBeInTheDocument();
    const cart = screen.getByRole('complementary', { name: 'Cart' });
    await user.type(await within(cart).findByRole('textbox', { name: 'Your name' }), 'Asha');
    await user.click(within(cart).getByRole('button', { name: /Place order/ }));
    expect(await screen.findByText('Delivered. Enjoy your meal!')).toBeInTheDocument();
  });

  it('surfaces a friendly error when the API is rate limiting', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"rate_limited"}', { status: 429 })));
    render(<App debounceMs={0} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests');
  });

  it('falls back to a generic message for unexpected failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 500 })));
    render(<App debounceMs={0} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
  });
});
