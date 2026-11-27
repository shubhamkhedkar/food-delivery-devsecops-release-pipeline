import { rupees } from '../format.js';

export default function Menu({ restaurant, cart, onAdd, onRemove, onClose }) {
  const categories = [...new Set(restaurant.menu.map((m) => m.category))];
  return (
    <section className="menu" aria-label={`${restaurant.name} menu`}>
      <header className="menu-header">
        <div>
          <h2>{restaurant.name}</h2>
          <p className="muted">
            {restaurant.cuisines.join(', ')} · {restaurant.area} · {restaurant.etaMinutes} min
          </p>
        </div>
        <button type="button" className="link" onClick={onClose}>
          ← All restaurants
        </button>
      </header>
      {categories.map((category) => (
        <div key={category} className="menu-category">
          <h3>{category}</h3>
          <ul>
            {restaurant.menu
              .filter((m) => m.category === category)
              .map((item) => {
                const qty = cart.restaurantId === restaurant.id ? (cart.items[item.id] ?? 0) : 0;
                return (
                  <li key={item.id} className="menu-item">
                    <div>
                      <span className={`dot ${item.veg ? 'veg' : 'nonveg'}`} aria-label={item.veg ? 'Vegetarian' : 'Non-vegetarian'} />
                      <strong>{item.name}</strong>
                      {item.bestseller && <span className="badge">Bestseller</span>}
                      <p className="muted">{item.description}</p>
                      <p>{rupees(item.price)}</p>
                    </div>
                    {qty === 0 ? (
                      <button type="button" onClick={() => onAdd(item.id)} aria-label={`Add ${item.name}`}>
                        Add
                      </button>
                    ) : (
                      <div className="stepper">
                        <button type="button" onClick={() => onRemove(item.id)} aria-label={`Remove one ${item.name}`}>
                          −
                        </button>
                        <span aria-label={`${item.name} quantity`}>{qty}</span>
                        <button type="button" onClick={() => onAdd(item.id)} aria-label={`Add one more ${item.name}`}>
                          +
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </section>
  );
}
