// Stateless order tokens: the order is HMAC-signed into its own id, so any replica can answer
// a status lookup without a shared database. Status is derived from the time since placement.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const STAGES = Object.freeze(['placed', 'preparing', 'out_for_delivery', 'delivered']);
const TOKEN = /^[A-Za-z0-9_-]{20,1200}\.[A-Za-z0-9_-]{43}$/;

const sign = (key, payload) => createHmac('sha256', key).update(payload).digest('base64url');

export function createOrderToken(key, quote, { now = Date.now(), etaMinutes, name }) {
  const order = {
    v: 1,
    n: randomBytes(6).toString('base64url'),
    r: quote.restaurantId,
    t: quote.total,
    i: quote.lines.reduce((sum, l) => sum + l.qty, 0),
    e: etaMinutes,
    p: now,
    c: name,
  };
  const payload = Buffer.from(JSON.stringify(order)).toString('base64url');
  return `${payload}.${sign(key, payload)}`;
}

// Returns the decoded order or null for anything malformed, tampered or signed with another key.
export function verifyOrderToken(key, token) {
  if (typeof token !== 'string' || !TOKEN.test(token)) return null;
  const [payload, mac] = token.split('.');
  const expected = Buffer.from(sign(key, payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const order = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return order.v === 1 ? order : null;
  } catch {
    return null;
  }
}

// Stage boundaries as fractions of the promised ETA: 10% placed, 45% preparing, then on the way.
export function orderStatus(order, now = Date.now()) {
  const etaMs = order.e * 60_000;
  const elapsed = Math.max(0, now - order.p);
  const fraction = elapsed / etaMs;
  const stage = fraction >= 1 ? 3 : fraction >= 0.45 ? 2 : fraction >= 0.1 ? 1 : 0;
  return {
    restaurantId: order.r,
    customer: order.c,
    total: order.t,
    items: order.i,
    placedAt: new Date(order.p).toISOString(),
    etaAt: new Date(order.p + etaMs).toISOString(),
    minutesRemaining: Math.max(0, Math.ceil((etaMs - elapsed) / 60_000)),
    status: STAGES[stage],
    stages: STAGES,
  };
}
