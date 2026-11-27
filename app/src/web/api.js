// Thin fetch wrapper: JSON in, JSON out, API errors surfaced as ApiError with the server's code.
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? `http_${status}`);
    this.status = status;
    this.body = body;
  }
}

async function request(path, { method = 'GET', body, signal } = {}) {
  const res = await fetch(path, {
    method,
    signal,
    headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const api = {
  meta: (signal) => request('/api/meta', { signal }),
  restaurants: (filters, signal) => {
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.cuisine) params.set('cuisine', filters.cuisine);
    if (filters.veg) params.set('veg', 'true');
    if (filters.sort && filters.sort !== 'relevance') params.set('sort', filters.sort);
    const qs = params.toString();
    return request(`/api/restaurants${qs ? `?${qs}` : ''}`, { signal });
  },
  restaurant: (id, signal) => request(`/api/restaurants/${encodeURIComponent(id)}`, { signal }),
  quote: (cart) => request('/api/quote', { method: 'POST', body: cart }),
  placeOrder: (order) => request('/api/orders', { method: 'POST', body: order }),
  order: (id, signal) => request(`/api/orders/${encodeURIComponent(id)}`, { signal }),
};
