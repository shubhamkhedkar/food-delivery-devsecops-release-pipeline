import { rupees } from '../format.js';

export default function RestaurantCard({ restaurant, onOpen }) {
  const { name, cuisines, area, rating, etaMinutes, costForTwo, pureVeg, accent, bestsellers } = restaurant;
  return (
    <li className="card">
      <button type="button" className="card-button" onClick={() => onOpen(restaurant.id)} aria-label={`Open ${name}`}>
        <div className="card-banner" style={{ '--accent': accent }}>
          <span className="initials" aria-hidden="true">
            {name
              .split(' ')
              .slice(0, 2)
              .map((w) => w[0])
              .join('')}
          </span>
          {pureVeg && <span className="badge veg">Pure veg</span>}
        </div>
        <div className="card-body">
          <div className="card-title">
            <h3>{name}</h3>
            <span className="rating" aria-label={`Rated ${rating} out of 5`}>
              ★ {rating.toFixed(1)}
            </span>
          </div>
          <p className="muted">
            {cuisines.join(', ')} · {area}
          </p>
          <p className="muted">
            {etaMinutes} min · {rupees(costForTwo)} for two
          </p>
          {bestsellers.length > 0 && <p className="bestsellers">Bestseller: {bestsellers[0]}</p>}
        </div>
      </button>
    </li>
  );
}
