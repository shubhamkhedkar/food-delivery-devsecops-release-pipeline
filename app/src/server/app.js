// HTTP request handler: routing, input validation, security headers, rate limiting and metrics.
import { CUISINES, getRestaurant, searchRestaurants, SORT_KEYS } from './catalog.js';
import { createOrderToken, orderStatus, verifyOrderToken } from './orders.js';
import { CartError, COUPONS, priceCart, resolveCart } from './pricing.js';
import { clientIp, createRateLimiter, securityHeaders } from './security.js';

const SLUG = /^[a-z0-9-]{1,40}$/;
const NAME = /^[\p{L}\p{M} .'-]{2,40}$/u;
const MAX_QUERY = 60;

class HttpError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

function readJson(req, maxBytes) {
  const type = String(req.headers['content-type'] ?? '');
  if (!type.toLowerCase().startsWith('application/json')) {
    return Promise.reject(new HttpError(415, 'unsupported_media_type'));
  }
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > maxBytes) return Promise.reject(new HttpError(413, 'payload_too_large', { max: maxBytes }));
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return; // keep draining so the 413 can be delivered, but stop buffering
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        reject(new HttpError(413, 'payload_too_large', { max: maxBytes }));
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

export function createHandler({ cfg, metrics, files, state = { draining: false }, logger = console, now = () => Date.now() }) {
  const baseHeaders = securityHeaders({ hsts: cfg.hsts });
  const limiter = createRateLimiter({ perMinute: cfg.rateLimitPerMinute });
  const index = files.get('/index.html');

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { ...baseHeaders, ...headers });
    res.end(body);
  };
  const json = (res, status, data, headers = {}) =>
    send(res, status, JSON.stringify(data), {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    });
  const asset = (req, res, file) => {
    if (req.headers['if-none-match'] === file.etag) return send(res, 304, undefined, { etag: file.etag });
    return send(res, 200, req.method === 'HEAD' ? undefined : file.body, {
      'content-type': file.type,
      'cache-control': file.cacheControl,
      etag: file.etag,
    });
  };
  const methods = (req, allowed) => {
    if (!allowed.includes(req.method)) throw new HttpError(405, 'method_not_allowed', { allow: allowed.join(', ') });
  };

  function listRestaurants(res, params) {
    const sort = params.get('sort') ?? 'relevance';
    const cuisine = params.get('cuisine') ?? '';
    const q = (params.get('q') ?? '').trim();
    const minRating = Number(params.get('minRating') ?? 0);
    if (!SORT_KEYS.includes(sort)) throw new HttpError(400, 'invalid_sort', { allowed: SORT_KEYS });
    if (cuisine && !CUISINES.includes(cuisine)) throw new HttpError(400, 'invalid_cuisine');
    if (q.length > MAX_QUERY) throw new HttpError(400, 'query_too_long', { max: MAX_QUERY });
    if (!Number.isFinite(minRating) || minRating < 0 || minRating > 5) throw new HttpError(400, 'invalid_min_rating');
    const restaurants = searchRestaurants({ q, cuisine, veg: params.get('veg') === 'true', minRating, sort });
    json(res, 200, { city: cfg.city, count: restaurants.length, restaurants }, { 'cache-control': 'public, max-age=30' });
  }

  async function api(req, res, url) {
    const wait = limiter.take(clientIp(req, cfg.trustProxy));
    if (wait > 0) {
      metrics.rateLimited.inc();
      json(res, 429, { error: 'rate_limited' }, { 'retry-after': String(wait) });
      return 'api_rate_limited';
    }
    const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
    const [, resource, id, extra] = parts;

    if (resource === 'meta' && parts.length === 2) {
      methods(req, ['GET', 'HEAD']);
      const coupons = Object.entries(COUPONS).map(([code, c]) => ({ code, label: c.label }));
      json(res, 200, { city: cfg.city, cuisines: CUISINES, sorts: SORT_KEYS, coupons }, { 'cache-control': 'public, max-age=300' });
      return 'api_meta';
    }
    if (resource === 'restaurants' && parts.length === 2) {
      methods(req, ['GET', 'HEAD']);
      listRestaurants(res, url.searchParams);
      return 'api_restaurants';
    }
    if (resource === 'restaurants' && parts.length === 3 && extra === undefined) {
      methods(req, ['GET', 'HEAD']);
      const restaurant = SLUG.test(id) ? getRestaurant(id) : null;
      if (!restaurant) throw new HttpError(404, 'unknown_restaurant');
      json(res, 200, restaurant, { 'cache-control': 'public, max-age=60' });
      return 'api_restaurant';
    }
    if (resource === 'quote' && parts.length === 2) {
      methods(req, ['POST']);
      const quote = priceCart(resolveCart(await readJson(req, cfg.maxBodyBytes)));
      metrics.quotes.inc({ outcome: 'priced' });
      json(res, 200, quote);
      return 'api_quote';
    }
    if (resource === 'orders' && parts.length === 2) {
      methods(req, ['POST']);
      const body = await readJson(req, cfg.maxBodyBytes);
      const name = typeof body?.customerName === 'string' ? body.customerName.trim() : '';
      if (!NAME.test(name)) throw new HttpError(400, 'invalid_customer_name');
      const cart = resolveCart(body);
      const quote = priceCart(cart);
      if (quote.coupon && !quote.coupon.applied) throw new HttpError(409, 'coupon_not_applicable', { coupon: quote.coupon });
      const token = createOrderToken(cfg.signingKey, quote, { now: now(), etaMinutes: cart.restaurant.etaMinutes, name });
      metrics.orders.inc({ restaurant: cart.restaurant.id });
      metrics.orderValue.observe({}, quote.total);
      if (quote.coupon) metrics.coupons.inc({ code: quote.coupon.code });
      json(res, 201, { orderId: token, quote, ...orderStatus(verifyOrderToken(cfg.signingKey, token), now()) }, {
        location: `/api/orders/${token}`,
      });
      return 'api_order_create';
    }
    if (resource === 'orders' && parts.length === 3) {
      methods(req, ['GET', 'HEAD']);
      const order = verifyOrderToken(cfg.signingKey, id);
      if (!order) throw new HttpError(404, 'unknown_order');
      json(res, 200, { orderId: id, ...orderStatus(order, now()) });
      return 'api_order_status';
    }
    throw new HttpError(404, 'not_found');
  }

  async function route(req, res, url) {
    const path = url.pathname;
    if (path === '/healthz/live') return json(res, 200, { status: 'ok' }), 'live';
    if (path === '/healthz/ready') {
      json(res, state.draining ? 503 : 200, { status: state.draining ? 'draining' : 'ready', signingKey: cfg.signingKeySource });
      return 'ready';
    }
    if (path === '/metrics') {
      send(res, 200, metrics.render(), { 'content-type': 'text/plain; version=0.0.4; charset=utf-8', 'cache-control': 'no-store' });
      return 'metrics';
    }
    if (path === '/version') {
      json(res, 200, { version: cfg.version, commit: cfg.commit });
      return 'version';
    }
    if (path.startsWith('/api/')) return api(req, res, url);

    methods(req, ['GET', 'HEAD']);
    const file = files.get(path === '/' ? '/index.html' : path);
    if (file) {
      asset(req, res, file);
      return 'static';
    }
    // Client-side routes (no file extension) get the SPA shell; everything else is a 404.
    if (index && !path.slice(path.lastIndexOf('/')).includes('.')) {
      asset(req, res, index);
      return 'spa';
    }
    send(res, 404, 'Not found\n', { 'content-type': 'text/plain; charset=utf-8' });
    return 'not_found';
  }

  return async function handler(req, res) {
    const started = process.hrtime.bigint();
    let routeName = 'unknown';
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      routeName = await route(req, res, url);
    } catch (err) {
      if (err instanceof HttpError || err instanceof CartError) {
        if (routeName === 'unknown') routeName = 'rejected';
        if (err instanceof CartError) metrics.quotes.inc({ outcome: 'rejected' });
        const { allow, ...extra } = err instanceof HttpError ? err.extra : err.detail;
        const headers = allow ? { allow } : {};
        if (err.status === 413) headers.connection = 'close';
        json(res, err.status, { error: err.code, ...extra }, headers);
      } else {
        logger.error(JSON.stringify({ level: 'error', msg: 'request failed', error: err.message }));
        if (!res.headersSent) json(res, 500, { error: 'internal_error' });
        else res.destroy();
      }
    } finally {
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      metrics.requests.inc({ route: routeName, method: req.method, code: String(res.statusCode) });
      metrics.duration.observe({ route: routeName }, seconds);
    }
  };
}
