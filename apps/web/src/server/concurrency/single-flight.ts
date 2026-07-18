export class SingleFlight<K, V> {
  private readonly inFlight = new Map<K, Promise<V>>()

  constructor(private readonly maxKeys = 1_000) {
    if (!Number.isInteger(maxKeys) || maxKeys < 1) throw new Error("maxKeys must be a positive integer")
  }

  run(key: K, operation: () => Promise<V>): Promise<V> {
    const existing = this.inFlight.get(key)
    if (existing) return existing

    // Не удерживаем неограниченное число tenant/user keys. При переполнении
    // операция всё равно выполняется, но без coalescing для нового ключа.
    if (this.inFlight.size >= this.maxKeys) return operation()

    const promise = operation()
    this.inFlight.set(key, promise)
    const clear = () => {
      if (this.inFlight.get(key) === promise) this.inFlight.delete(key)
    }
    void promise.then(clear, clear)
    return promise
  }
}
