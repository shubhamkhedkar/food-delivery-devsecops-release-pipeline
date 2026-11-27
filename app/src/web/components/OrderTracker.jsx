import { rupees, STAGE_LABELS } from '../format.js';

export default function OrderTracker({ order, restaurantName, onDone }) {
  const current = order.stages.indexOf(order.status);
  return (
    <section className="tracker" aria-label="Order status">
      <h2>Thanks, {order.customer}!</h2>
      <p>
        {order.items} item{order.items === 1 ? '' : 's'} from {restaurantName} · {rupees(order.total)}
      </p>
      <ol className="stages">
        {order.stages.map((stage, i) => (
          <li key={stage} className={i <= current ? 'done' : ''} aria-current={i === current ? 'step' : undefined}>
            {STAGE_LABELS[stage]}
          </li>
        ))}
      </ol>
      <p role="status">{order.status === 'delivered' ? 'Delivered. Enjoy your meal!' : `Arriving in about ${order.minutesRemaining} min`}</p>
      <button type="button" className="link" onClick={onDone}>
        Order something else
      </button>
    </section>
  );
}
