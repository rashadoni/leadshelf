import { describe, expect, it } from "vitest"
import { DICT } from "./index"

// Локали держим одинаковыми: t() молча возвращает ключ при пропуске, так
// что недостающий перевод — тихий баг. Ловим его тестом (docs/26 §13).
describe("mobile i18n key parity", () => {
  it("az and ru expose the exact same keys", () => {
    const az = Object.keys(DICT.az).sort()
    const ru = Object.keys(DICT.ru).sort()
    const missingInRu = az.filter((k) => !(k in DICT.ru))
    const missingInAz = ru.filter((k) => !(k in DICT.az))
    expect(missingInRu, `keys missing in ru: ${missingInRu.join(", ")}`).toEqual([])
    expect(missingInAz, `keys missing in az: ${missingInAz.join(", ")}`).toEqual([])
    expect(az).toEqual(ru)
  })
})
