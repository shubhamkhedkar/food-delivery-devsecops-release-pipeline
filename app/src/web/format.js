// Display helpers. The API speaks integer paise; the UI shows rupees.
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 0 });

export const rupees = (paise) => inr.format(paise / 100);

export const STAGE_LABELS = {
  placed: 'Order placed',
  preparing: 'Being prepared',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
};
