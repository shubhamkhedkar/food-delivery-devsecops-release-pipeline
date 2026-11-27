import { useEffect, useReducer, useState } from 'react';
import { api } from './api.js';
import { cartCount, cartLines, cartReducer, emptyCart } from './cart.js';
import Cart from './components/Cart.jsx';
import Filters from './components/Filters.jsx';
import Menu from './components/Menu.jsx';
import OrderTracker from './components/OrderTracker.jsx';
import RestaurantCard from './components/RestaurantCard.jsx';

const ERRORS = {
  rate_limited: 'Too many requests. Please wait a moment and try again.',
  coupon_not_applicable: 'Remove or fix the coupon before placing the order.',
  invalid_customer_name: 'Please enter your name (letters only, 2-40 characters).',
};
const message = (err) => ERRORS[err?.message] ?? 'Something went wrong. Please try again.';
const INITIAL_FILTERS = { q: '', cuisine: '', veg: false, sort: 'relevance' };

export default function App({ pollMs = 30000, debounceMs = 250 }) {
  const [meta, setMeta] = useState(null);
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [restaurants, setRestaurants] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [restaurant, setRestaurant] = useState(null);
  const [cart, dispatch] = useReducer(cartReducer, emptyCart);
  const [cartRestaurant, setCartRestaurant] = useState(null);
  const [coupon, setCoupon] = useState('');
  const [quote, setQuote] = useState(null);
  const [order, setOrder] = useState(null);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .meta(ctrl.signal)
      .then(setMeta)
      .catch((err) => err.name !== 'AbortError' && setError(message(err)));
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      api
        .restaurants(filters, ctrl.signal)
        .then((data) => setRestaurants(data.restaurants))
        .catch((err) => err.name !== 'AbortError' && setError(message(err)));
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [filters, debounceMs]);

  useEffect(() => {
    if (!openId) return undefined;
    const ctrl = new AbortController();
    api
      .restaurant(openId, ctrl.signal)
      .then(setRestaurant)
      .catch((err) => err.name !== 'AbortError' && setError(message(err)));
    return () => ctrl.abort();
  }, [openId]);

  useEffect(() => {
    if (!cart.restaurantId) return undefined;
    let live = true;
    api
      .quote({ restaurantId: cart.restaurantId, items: cartLines(cart), coupon: coupon || undefined })
      .then((q) => live && setQuote(q))
      .catch((err) => live && setError(message(err)));
    return () => {
      live = false;
    };
  }, [cart, coupon]);

  useEffect(() => {
    if (!order || order.status === 'delivered') return undefined;
    const timer = setInterval(() => {
      api
        .order(order.orderId)
        .then((o) => setOrder((prev) => ({ ...prev, ...o })))
        .catch(() => {});
    }, pollMs);
    return () => clearInterval(timer);
  }, [order, pollMs]);

  const add = (itemId) => {
    setError('');
    if (cart.restaurantId !== restaurant.id) {
      setCartRestaurant(restaurant);
      setCoupon('');
    }
    dispatch({ type: 'add', restaurantId: restaurant.id, itemId });
  };

  const place = async (customerName) => {
    setPlacing(true);
    setError('');
    try {
      const placed = await api.placeOrder({
        restaurantId: cart.restaurantId,
        items: cartLines(cart),
        coupon: coupon || undefined,
        customerName,
      });
      setOrder(placed);
      dispatch({ type: 'clear' });
      setCoupon('');
    } catch (err) {
      setError(message(err));
    } finally {
      setPlacing(false);
    }
  };

  const count = cartCount(cart);
  // An emptied cart hides the last quote without an extra render pass.
  const shownQuote = cart.restaurantId ? quote : null;
  return (
    <div className="app">
      <header className="topbar">
        <h1>
          Plate<span>wise</span>
        </h1>
        <p className="muted">{meta ? `Delivering in ${meta.city}` : 'Loading…'}</p>
        <span className="cart-pill" aria-label={`${count} items in cart`}>
          🛒 {count}
        </span>
      </header>
      <main className="layout">
        <div className="content">
          {error && !shownQuote && (
            <p className="banner warn" role="alert">
              {error}
            </p>
          )}
          {order ? (
            <OrderTracker order={order} restaurantName={cartRestaurant?.name ?? ''} onDone={() => setOrder(null)} />
          ) : restaurant && openId ? (
            <Menu
              restaurant={restaurant}
              cart={cart}
              onAdd={add}
              onRemove={(itemId) => dispatch({ type: 'remove', itemId })}
              onClose={() => {
                setOpenId(null);
                setRestaurant(null);
              }}
            />
          ) : (
            <>
              {meta && <Filters meta={meta} filters={filters} onChange={setFilters} />}
              {restaurants === null ? (
                <p className="muted">Finding restaurants…</p>
              ) : restaurants.length === 0 ? (
                <p className="empty">No restaurants match. Try another dish or clear the filters.</p>
              ) : (
                <ul className="grid" aria-label="Restaurants">
                  {restaurants.map((r) => (
                    <RestaurantCard key={r.id} restaurant={r} onOpen={setOpenId} />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
        {!order && (
          <Cart
            key={cart.restaurantId ?? 'empty'}
            quote={shownQuote}
            restaurantName={cartRestaurant?.name}
            coupons={meta?.coupons ?? []}
            coupon={coupon}
            onCoupon={setCoupon}
            onPlace={place}
            placing={placing}
            error={error}
          />
        )}
      </main>
      <footer className="footer muted">Platewise demo · prices in INR incl. 5% GST · no real payments or deliveries</footer>
    </div>
  );
}
