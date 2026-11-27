// Cart state: one restaurant at a time, quantities per menu item, capped like the API.
export const MAX_QTY = 20;
export const emptyCart = { restaurantId: null, items: {} };

export function cartReducer(state, action) {
  switch (action.type) {
    case 'add': {
      const sameRestaurant = state.restaurantId === action.restaurantId;
      const items = sameRestaurant ? { ...state.items } : {};
      items[action.itemId] = Math.min(MAX_QTY, (items[action.itemId] ?? 0) + 1);
      return { restaurantId: action.restaurantId, items };
    }
    case 'remove': {
      const qty = (state.items[action.itemId] ?? 0) - 1;
      const items = { ...state.items };
      if (qty > 0) items[action.itemId] = qty;
      else delete items[action.itemId];
      return Object.keys(items).length ? { ...state, items } : emptyCart;
    }
    case 'clear':
      return emptyCart;
    default:
      throw new Error(`unknown cart action ${action.type}`);
  }
}

export const cartLines = (cart) => Object.entries(cart.items).map(([id, qty]) => ({ id, qty }));
export const cartCount = (cart) => Object.values(cart.items).reduce((a, b) => a + b, 0);
