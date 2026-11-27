// Cart validation and pricing. All amounts are integer paise; rounding happens once, at GST.
import { getRestaurant } from './catalog.js';

export const LIMITS = Object.freeze({ maxLines: 25, maxQty: 20 });
export const FREE_DELIVERY_ABOVE = 49900;
export const GST_RATE = 0.05;

// Each coupon returns { discount, freeDelivery } for a given subtotal, or a reason it does not apply.
export const COUPONS = Object.freeze({
  WELCOME50: {
    label: '50% off up to ₹100 on orders above ₹199',
    apply: (subtotal) =>
      subtotal < 19900 ? { error: 'minimum_not_met', minimum: 19900 } : { discount: Math.min(Math.floor(subtotal / 2), 10000) },
  },
  FLAT75: {
    label: '₹75 off on orders above ₹399',
    apply: (subtotal) => (subtotal < 39900 ? { error: 'minimum_not_met', minimum: 39900 } : { discount: 7500 }),
  },
  FREEDEL: {
    label: 'Free delivery, no minimum',
    apply: () => ({ discount: 0, freeDelivery: true }),
  },
});

export class CartError extends Error {
  constructor(code, detail = {}) {
    super(code);
    this.code = code;
    this.detail = detail;
    this.status = 400;
  }
}

// Validate the untrusted cart payload and resolve it against the catalog.
export function resolveCart(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new CartError('invalid_body');
  const restaurant = typeof body.restaurantId === 'string' ? getRestaurant(body.restaurantId) : null;
  if (!restaurant) throw new CartError('unknown_restaurant');
  const { items } = body;
  if (!Array.isArray(items) || items.length === 0) throw new CartError('empty_cart');
  if (items.length > LIMITS.maxLines) throw new CartError('too_many_lines', { max: LIMITS.maxLines });

  const merged = new Map();
  for (const line of items) {
    if (line === null || typeof line !== 'object' || typeof line.id !== 'string') throw new CartError('invalid_line');
    if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > LIMITS.maxQty) {
      throw new CartError('invalid_quantity', { id: line.id, max: LIMITS.maxQty });
    }
    const item = restaurant.menu.find((m) => m.id === line.id);
    if (!item) throw new CartError('unknown_item', { id: line.id });
    const qty = (merged.get(item.id)?.qty ?? 0) + line.qty;
    if (qty > LIMITS.maxQty) throw new CartError('invalid_quantity', { id: line.id, max: LIMITS.maxQty });
    merged.set(item.id, { item, qty });
  }

  let coupon = null;
  if (body.coupon !== undefined && body.coupon !== null && body.coupon !== '') {
    if (typeof body.coupon !== 'string' || body.coupon.length > 20) throw new CartError('invalid_coupon');
    coupon = body.coupon.trim().toUpperCase();
  }
  return { restaurant, lines: [...merged.values()], coupon };
}

export function priceCart({ restaurant, lines, coupon }) {
  const subtotal = lines.reduce((sum, { item, qty }) => sum + item.price * qty, 0);
  let discount = 0;
  let freeDelivery = subtotal >= FREE_DELIVERY_ABOVE;
  let couponResult = null;
  if (coupon) {
    const rule = COUPONS[coupon];
    if (!rule) {
      couponResult = { code: coupon, applied: false, reason: 'unknown_coupon' };
    } else {
      const outcome = rule.apply(subtotal);
      if (outcome.error) {
        couponResult = { code: coupon, applied: false, reason: outcome.error, minimum: outcome.minimum };
      } else {
        discount = outcome.discount;
        freeDelivery = freeDelivery || Boolean(outcome.freeDelivery);
        couponResult = { code: coupon, applied: true, label: rule.label };
      }
    }
  }
  const deliveryFee = freeDelivery ? 0 : restaurant.deliveryFee;
  const packagingFee = restaurant.packagingFee;
  const gst = Math.round((subtotal - discount + packagingFee) * GST_RATE);
  const total = subtotal - discount + packagingFee + deliveryFee + gst;
  return {
    restaurantId: restaurant.id,
    lines: lines.map(({ item, qty }) => ({ id: item.id, name: item.name, qty, unitPrice: item.price, lineTotal: item.price * qty })),
    subtotal,
    discount,
    packagingFee,
    deliveryFee,
    gst,
    total,
    coupon: couponResult,
    currency: 'INR',
    unit: 'paise',
  };
}
