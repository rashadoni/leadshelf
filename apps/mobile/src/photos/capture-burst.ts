export type CapturedBurstFrame<T> = {
  value: T
  index: number
}

export async function captureBurstFrames<T>(input: {
  count: number
  capture: (index: number) => Promise<T | null>
}): Promise<{ frames: CapturedBurstFrame<T>[]; failedCaptures: number }> {
  const count = Math.max(1, Math.floor(input.count))
  const frames: CapturedBurstFrame<T>[] = []
  let failedCaptures = 0

  for (let index = 0; index < count; index += 1) {
    try {
      const value = await input.capture(index)
      if (value == null) {
        failedCaptures += 1
      } else {
        frames.push({ value, index })
      }
    } catch {
      failedCaptures += 1
      // После первого пригодного кадра не нагружаем нестабильную камеру
      // повторными быстрыми вызовами. Один кадр — допустимый fallback.
      if (frames.length > 0) break
    }
  }

  return { frames, failedCaptures }
}
