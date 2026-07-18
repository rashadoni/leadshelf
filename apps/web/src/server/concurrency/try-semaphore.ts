export class TrySemaphore {
  private active = 0

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error("semaphore capacity must be a positive integer")
    }
  }

  tryAcquire(): (() => void) | null {
    if (this.active >= this.capacity) return null
    this.active++
    let released = false
    return () => {
      if (released) return
      released = true
      this.active--
    }
  }

  get activeCount(): number {
    return this.active
  }
}
