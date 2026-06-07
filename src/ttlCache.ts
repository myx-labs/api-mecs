// A tiny dependency-free TTL + max-size cache.
//
// Replaces got's built-in `cache` option (cacheable-request → Keyv), which
// attaches an `'error'` listener to a single shared store on every request and
// never removes it — the source of the climbing `MaxListenersExceededWarning`.
// This cache is checked/written explicitly by callers, holds nothing got-related,
// and is bounded in both size (LRU eviction) and time (lazy TTL expiry), so it
// can never leak listeners or grow unbounded.

interface TTLCacheEntry<V> {
  value: V;
  expires: number;
}

export class TTLCache<V> {
  private readonly store = new Map<string, TTLCacheEntry<V>>();
  private readonly max: number;
  private readonly defaultTtlMs: number;

  constructor(options: { max?: number; defaultTtlMs?: number } = {}) {
    this.max = options.max ?? 500;
    this.defaultTtlMs = options.defaultTtlMs ?? 60_000;
  }

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (entry === undefined) {
      return undefined;
    }
    if (entry.expires <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Re-insert so this key becomes most-recently-used (Map keeps insertion order).
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, ttlMs: number = this.defaultTtlMs): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.max) {
      // Evict the oldest (first-inserted) entry.
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) {
        this.store.delete(oldest);
      }
    }
    this.store.set(key, { value, expires: Date.now() + ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
