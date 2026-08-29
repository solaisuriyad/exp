/**
 * Fixed-capacity object pool.
 *
 * A shooter allocates hundreds of short-lived objects per second. On a mid-range
 * Android WebView that is enough GC churn to cause visible frame drops, so
 * bullets, particles and enemies are recycled instead of re-created.
 */
export class Pool<T> {
  private readonly free: T[] = [];
  readonly active: T[] = [];
  private readonly factory: () => T;
  private readonly reset: (item: T) => void;
  readonly capacity: number;

  constructor(factory: () => T, reset: (item: T) => void, capacity: number) {
    this.factory = factory;
    this.reset = reset;
    this.capacity = capacity;
  }

  get size(): number {
    return this.active.length;
  }

  get available(): number {
    return this.capacity - this.active.length;
  }

  /** Take an item, or null when the pool is exhausted (caller must cope). */
  obtain(): T | null {
    const item = this.free.pop() ?? (this.active.length + this.free.length < this.capacity ? this.factory() : null);
    if (item === null) return null;
    this.active.push(item);
    return item;
  }

  /** Return an item by index — swap-removes, so iteration must go backwards. */
  releaseAt(index: number): void {
    const item = this.active[index];
    if (item === undefined) return;
    this.reset(item);
    const last = this.active.length - 1;
    this.active[index] = this.active[last] as T;
    this.active.pop();
    this.free.push(item);
  }

  release(item: T): void {
    const i = this.active.indexOf(item);
    if (i >= 0) this.releaseAt(i);
  }

  releaseAll(): void {
    for (let i = this.active.length - 1; i >= 0; i--) this.releaseAt(i);
  }
}
