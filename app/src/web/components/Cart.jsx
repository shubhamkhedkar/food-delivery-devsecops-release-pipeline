import { useState } from 'react';
import { rupees } from '../format.js';

const REASONS = {
  unknown_coupon: 'That code does not exist.',
  minimum_not_met: 'Add more items to use this code.',
};

export default function Cart({ quote, restaurantName, coupons, coupon, onCoupon, onPlace, placing, error }) {
  const [code, setCode] = useState(coupon);
  const [name, setName] = useState('');
  if (!quote) {
    return (
      <aside className="cart" aria-label="Cart">
        <h2>Your cart</h2>
        <p className="muted">Add dishes from a restaurant to get started.</p>
      </aside>
    );
  }
  const row = (label, value, negative = false) => (
    <div className="row">
      <span>{label}</span>
      <span>
        {negative ? '−' : ''}
        {rupees(value)}
      </span>
    </div>
  );
  return (
    <aside className="cart" aria-label="Cart">
      <h2>Your cart</h2>
      <p className="muted">{restaurantName}</p>
      <ul>
        {quote.lines.map((l) => (
          <li key={l.id} className="row">
            <span>
              {l.qty} × {l.name}
            </span>
            <span>{rupees(l.lineTotal)}</span>
          </li>
        ))}
      </ul>
      <form
        className="coupon"
        onSubmit={(e) => {
          e.preventDefault();
          onCoupon(code.trim().toUpperCase());
        }}
      >
        <input aria-label="Coupon code" placeholder="Coupon code" maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} />
        <button type="submit">Apply</button>
      </form>
      {quote.coupon && (
        <p className={quote.coupon.applied ? 'ok' : 'warn'} role="status">
          {quote.coupon.applied ? `${quote.coupon.code} applied: ${quote.coupon.label}` : REASONS[quote.coupon.reason]}
        </p>
      )}
      <details>
        <summary>Available offers</summary>
        <ul>
          {coupons.map((c) => (
            <li key={c.code}>
              <code>{c.code}</code> {c.label}
            </li>
          ))}
        </ul>
      </details>
      <div className="bill">
        {row('Item total', quote.subtotal)}
        {quote.discount > 0 && row('Discount', quote.discount, true)}
        {row('Packaging', quote.packagingFee)}
        {row('Delivery', quote.deliveryFee)}
        {row('GST (5%)', quote.gst)}
        <div className="row total">
          <span>To pay</span>
          <span>{rupees(quote.total)}</span>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onPlace(name.trim());
        }}
      >
        <input aria-label="Your name" placeholder="Your name" required minLength={2} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="primary" disabled={placing}>
          {placing ? 'Placing order…' : `Place order · ${rupees(quote.total)}`}
        </button>
      </form>
      {error && (
        <p className="warn" role="alert">
          {error}
        </p>
      )}
    </aside>
  );
}
