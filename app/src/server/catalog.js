// Restaurant catalog: a fixed, curated data set so the demo runs with no database or API key.
// Prices are integers in paise (1 INR = 100 paise) so money maths never touches floats.

const r = (id, name, cuisines, area, rating, etaMinutes, costForTwo, veg, packagingFee, deliveryFee, accent, menu) => ({
  id,
  name,
  cuisines,
  area,
  rating,
  etaMinutes,
  costForTwo,
  pureVeg: veg,
  packagingFee,
  deliveryFee,
  accent,
  menu: menu.map(([itemId, itemName, price, isVeg, category, description, bestseller = false]) => ({
    id: itemId,
    name: itemName,
    price,
    veg: isVeg,
    category,
    description,
    bestseller,
  })),
});

export const RESTAURANTS = Object.freeze([
  r('tawa-junction', 'Tawa Junction', ['North Indian', 'Mughlai'], 'Baner', 4.4, 32, 60000, false, 2000, 3500, '#c2410c', [
    ['tj-paneer-tikka', 'Paneer Tikka Platter', 28900, true, 'Starters', 'Charcoal-grilled cottage cheese, mint chutney', true],
    ['tj-murgh-malai', 'Murgh Malai Kebab', 32900, false, 'Starters', 'Cream and cardamom marinated chicken'],
    ['tj-dal-makhani', 'Dal Makhani', 22900, true, 'Mains', 'Slow-cooked black lentils, butter finish', true],
    ['tj-butter-chicken', 'Butter Chicken', 34900, false, 'Mains', 'Tomato-fenugreek gravy, smoked chicken'],
    ['tj-garlic-naan', 'Garlic Naan', 6900, true, 'Breads', 'Tandoor-baked, brushed with garlic butter'],
    ['tj-phirni', 'Kesar Phirni', 11900, true, 'Desserts', 'Saffron rice pudding in a clay pot'],
  ]),
  r('misal-mandal', 'Misal Mandal', ['Maharashtrian', 'Street Food'], 'Sadashiv Peth', 4.6, 24, 25000, true, 1000, 2500, '#b91c1c', [
    ['mm-misal-pav', 'Kolhapuri Misal Pav', 13900, true, 'Mains', 'Fiery sprout curry, farsan, two pav', true],
    ['mm-sabudana-vada', 'Sabudana Vada', 9900, true, 'Snacks', 'Crisp tapioca fritters, peanut chutney'],
    ['mm-thalipeeth', 'Bhajani Thalipeeth', 12900, true, 'Mains', 'Multigrain flatbread, white butter'],
    ['mm-poha', 'Kanda Poha', 7900, true, 'Snacks', 'Flattened rice, onion, lemon, sev'],
    ['mm-piyush', 'Piyush', 8900, true, 'Drinks', 'Shrikhand and buttermilk shake', true],
  ]),
  r('coastal-curry-co', 'Coastal Curry Co.', ['Malvani', 'Seafood'], 'Koregaon Park', 4.5, 38, 90000, false, 2500, 4000, '#0e7490', [
    ['cc-bombil-fry', 'Bombil Rava Fry', 31900, false, 'Starters', 'Semolina-crusted Bombay duck', true],
    ['cc-prawn-sukka', 'Prawns Sukka', 42900, false, 'Mains', 'Dry coconut masala prawns'],
    ['cc-surmai-thali', 'Surmai Thali', 54900, false, 'Thali', 'Kingfish fry, curry, sol kadhi, rice', true],
    ['cc-veg-kolhapuri', 'Veg Kolhapuri', 25900, true, 'Mains', 'Mixed vegetables, roasted spice paste'],
    ['cc-sol-kadhi', 'Sol Kadhi', 7900, true, 'Drinks', 'Kokum and coconut milk cooler'],
  ]),
  r('dosa-district', 'Dosa District', ['South Indian'], 'Kothrud', 4.3, 22, 30000, true, 1000, 2500, '#a16207', [
    ['dd-masala-dosa', 'Mysore Masala Dosa', 14900, true, 'Dosa', 'Red chutney, potato palya', true],
    ['dd-ghee-podi', 'Ghee Podi Idli', 11900, true, 'Idli', 'Button idlis tossed in gunpowder and ghee'],
    ['dd-pesarattu', 'Pesarattu Upma', 15900, true, 'Dosa', 'Green gram crepe stuffed with upma'],
    ['dd-filter-coffee', 'Filter Kaapi', 6900, true, 'Drinks', 'Chicory blend, frothed tableside', true],
  ]),
  r('wok-and-roll', 'Wok & Roll', ['Chinese', 'Asian'], 'Viman Nagar', 4.1, 35, 55000, false, 2000, 3500, '#be123c', [
    ['wr-chilli-paneer', 'Chilli Paneer Dry', 24900, true, 'Starters', 'Bell peppers, spring onion, soy glaze'],
    ['wr-dragon-chicken', 'Dragon Chicken', 28900, false, 'Starters', 'Crispy chicken, fiery sauce', true],
    ['wr-hakka-noodles', 'Veg Hakka Noodles', 19900, true, 'Noodles', 'Wok-tossed, smoky'],
    ['wr-burnt-garlic-rice', 'Burnt Garlic Fried Rice', 21900, true, 'Rice', 'Charred garlic, scallions'],
    ['wr-dimsum', 'Chicken Dim Sum (6)', 26900, false, 'Starters', 'Steamed, chilli oil on the side'],
  ]),
  r('green-bowl', 'The Green Bowl', ['Healthy', 'Salads'], 'Aundh', 4.2, 28, 50000, true, 1500, 3000, '#15803d', [
    ['gb-quinoa-bowl', 'Quinoa Buddha Bowl', 29900, true, 'Bowls', 'Roasted vegetables, hummus, tahini', true],
    ['gb-millet-khichdi', 'Millet Khichdi', 21900, true, 'Bowls', 'Foxtail millet, moong, ghee tadka'],
    ['gb-greek-salad', 'Greek Salad', 24900, true, 'Salads', 'Feta, olives, cucumber, oregano'],
    ['gb-cold-brew', 'Cold Brew', 16900, true, 'Drinks', '18-hour steep, unsweetened'],
  ]),
  r('biryani-bazaar', 'Biryani Bazaar', ['Biryani', 'Hyderabadi'], 'Camp', 4.5, 40, 70000, false, 2500, 4000, '#7c2d12', [
    ['bb-chicken-dum', 'Chicken Dum Biryani', 32900, false, 'Biryani', 'Sealed pot, long-grain rice', true],
    ['bb-mutton-dum', 'Mutton Dum Biryani', 42900, false, 'Biryani', 'Tender goat, saffron, fried onion'],
    ['bb-veg-dum', 'Subz Dum Biryani', 25900, true, 'Biryani', 'Seasonal vegetables, mint'],
    ['bb-mirchi-salan', 'Mirchi ka Salan', 12900, true, 'Sides', 'Peanut-sesame chilli curry'],
    ['bb-double-ka-meetha', 'Double ka Meetha', 11900, true, 'Desserts', 'Bread pudding, dry fruits', true],
  ]),
  r('crust-and-co', 'Crust & Co.', ['Pizza', 'Italian'], 'Hinjewadi', 4.0, 30, 65000, false, 2000, 3000, '#9a3412', [
    ['cr-margherita', 'Neapolitan Margherita', 34900, true, 'Pizza', 'San Marzano tomato, fior di latte', true],
    ['cr-pepperoni', 'Chicken Pepperoni', 44900, false, 'Pizza', 'Hot honey drizzle'],
    ['cr-arrabbiata', 'Penne Arrabbiata', 27900, true, 'Pasta', 'Garlic, chilli, basil'],
    ['cr-tiramisu', 'Tiramisu Jar', 18900, true, 'Desserts', 'Mascarpone, espresso, cocoa'],
  ]),
]);

const byId = new Map(RESTAURANTS.map((x) => [x.id, x]));

export const CUISINES = Object.freeze([...new Set(RESTAURANTS.flatMap((x) => x.cuisines))].sort());

const SORTS = {
  relevance: () => 0,
  rating: (a, b) => b.rating - a.rating,
  eta: (a, b) => a.etaMinutes - b.etaMinutes,
  cost_asc: (a, b) => a.costForTwo - b.costForTwo,
  cost_desc: (a, b) => b.costForTwo - a.costForTwo,
};
export const SORT_KEYS = Object.freeze(Object.keys(SORTS));

const summary = ({ menu, ...rest }) => ({ ...rest, bestsellers: menu.filter((m) => m.bestseller).map((m) => m.name) });

// Search by name, cuisine, area or dish; filter by cuisine, pure-veg and minimum rating; sort.
export function searchRestaurants({ q = '', cuisine = '', veg = false, minRating = 0, sort = 'relevance' } = {}) {
  const needle = q.trim().toLowerCase();
  const results = RESTAURANTS.filter((x) => {
    if (cuisine && !x.cuisines.includes(cuisine)) return false;
    if (veg && !x.pureVeg) return false;
    if (x.rating < minRating) return false;
    if (!needle) return true;
    const haystack = [x.name, x.area, ...x.cuisines, ...x.menu.map((m) => m.name)].join(' ').toLowerCase();
    return haystack.includes(needle);
  });
  return [...results].sort(SORTS[sort] ?? SORTS.relevance).map(summary);
}

export const getRestaurant = (id) => byId.get(id) ?? null;
