const SORT_LABELS = {
  relevance: 'Relevance',
  rating: 'Rating',
  eta: 'Delivery time',
  cost_asc: 'Cost: low to high',
  cost_desc: 'Cost: high to low',
};

export default function Filters({ meta, filters, onChange }) {
  const set = (patch) => onChange({ ...filters, ...patch });
  return (
    <section className="filters" aria-label="Search and filters">
      <input
        type="search"
        aria-label="Search restaurants or dishes"
        placeholder="Search restaurants, cuisines or dishes"
        maxLength={60}
        value={filters.q}
        onChange={(e) => set({ q: e.target.value })}
      />
      <select aria-label="Cuisine" value={filters.cuisine} onChange={(e) => set({ cuisine: e.target.value })}>
        <option value="">All cuisines</option>
        {meta.cuisines.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <select aria-label="Sort by" value={filters.sort} onChange={(e) => set({ sort: e.target.value })}>
        {meta.sorts.map((s) => (
          <option key={s} value={s}>
            {SORT_LABELS[s] ?? s}
          </option>
        ))}
      </select>
      <label className="toggle">
        <input type="checkbox" checked={filters.veg} onChange={(e) => set({ veg: e.target.checked })} /> Pure veg
      </label>
    </section>
  );
}
