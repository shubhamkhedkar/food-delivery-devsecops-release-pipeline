// Minimal Prometheus text-format registry: counters, gauges and histograms.
// Zero dependencies keeps the runtime image free of third-party packages.

const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

const escape = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
const labelKey = (labels) =>
  Object.keys(labels)
    .sort()
    .map((k) => `${k}="${escape(labels[k])}"`)
    .join(',');

class Family {
  constructor(name, help, type) {
    this.name = name;
    this.help = help;
    this.type = type;
    this.series = new Map();
  }
  header() {
    return [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} ${this.type}`];
  }
}

class Counter extends Family {
  constructor(name, help) {
    super(name, help, 'counter');
  }
  inc(labels = {}, by = 1) {
    const key = labelKey(labels);
    this.series.set(key, (this.series.get(key) ?? 0) + by);
  }
  get(labels = {}) {
    return this.series.get(labelKey(labels)) ?? 0;
  }
  render() {
    const lines = this.header();
    for (const [key, value] of this.series) lines.push(`${this.name}${key ? `{${key}}` : ''} ${value}`);
    return lines;
  }
}

class Gauge extends Family {
  constructor(name, help, collect) {
    super(name, help, 'gauge');
    this.collect = collect;
  }
  set(labels, value) {
    this.series.set(labelKey(labels), value);
  }
  render() {
    if (this.collect) this.collect(this);
    const lines = this.header();
    for (const [key, value] of this.series) lines.push(`${this.name}${key ? `{${key}}` : ''} ${value}`);
    return lines;
  }
}

class Histogram extends Family {
  constructor(name, help, buckets = BUCKETS) {
    super(name, help, 'histogram');
    this.buckets = buckets;
  }
  observe(labels, value) {
    const key = labelKey(labels);
    let s = this.series.get(key);
    if (!s) {
      s = { buckets: this.buckets.map(() => 0), sum: 0, count: 0 };
      this.series.set(key, s);
    }
    this.buckets.forEach((le, i) => {
      if (value <= le) s.buckets[i] += 1;
    });
    s.sum += value;
    s.count += 1;
  }
  render() {
    const lines = this.header();
    for (const [key, s] of this.series) {
      const sep = key ? `${key},` : '';
      this.buckets.forEach((le, i) => lines.push(`${this.name}_bucket{${sep}le="${le}"} ${s.buckets[i]}`));
      lines.push(`${this.name}_bucket{${sep}le="+Inf"} ${s.count}`);
      lines.push(`${this.name}_sum${key ? `{${key}}` : ''} ${s.sum}`);
      lines.push(`${this.name}_count${key ? `{${key}}` : ''} ${s.count}`);
    }
    return lines;
  }
}

export const ORDER_VALUE_BUCKETS = [20000, 40000, 60000, 80000, 100000, 150000, 250000, 500000];

export function createMetrics({ version, commit, city }) {
  const startedAt = Date.now() / 1000;
  const m = {
    requests: new Counter('platewise_http_requests_total', 'HTTP requests by route, method and status code.'),
    duration: new Histogram('platewise_http_request_duration_seconds', 'HTTP request latency by route.'),
    quotes: new Counter('platewise_quotes_total', 'Cart quotes priced, by outcome.'),
    orders: new Counter('platewise_orders_total', 'Orders placed, by restaurant.'),
    orderValue: new Histogram('platewise_order_value_paise', 'Order totals in paise.', ORDER_VALUE_BUCKETS),
    coupons: new Counter('platewise_coupon_redemptions_total', 'Coupon codes on placed orders, by code and whether they applied.'),
    rateLimited: new Counter('platewise_rate_limited_total', 'Requests rejected with HTTP 429.'),
    info: new Gauge('platewise_build_info', 'Build and runtime information (always 1).'),
    start: new Gauge('process_start_time_seconds', 'Start time of the process since the Unix epoch in seconds.'),
    memory: new Gauge('process_resident_memory_bytes', 'Resident memory size in bytes.', (g) =>
      g.set({}, process.memoryUsage().rss),
    ),
    heap: new Gauge('nodejs_heap_used_bytes', 'V8 heap in use in bytes.', (g) => g.set({}, process.memoryUsage().heapUsed)),
  };
  m.info.set({ version, commit, city, node_version: process.version }, 1);
  m.start.set({}, startedAt);
  m.render = () =>
    `${Object.values(m)
      .filter((f) => f instanceof Family)
      .flatMap((f) => f.render())
      .join('\n')}\n`;
  return m;
}
