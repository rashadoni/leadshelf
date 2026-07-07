import { describe, expect, it } from "vitest"
import {
  MOBILE_PROTOCOL_VERSION,
  isSupportedProtocol,
  protocolMismatch,
  protocolMismatchFromHeader,
} from "./protocol"

describe("mobile protocol enforcement", () => {
  it("accepts only the exact supported version (numbers, not strings)", () => {
    expect(isSupportedProtocol(MOBILE_PROTOCOL_VERSION)).toBe(true)
    expect(isSupportedProtocol(2)).toBe(false)
    expect(isSupportedProtocol(undefined)).toBe(false)
    expect(isSupportedProtocol("1")).toBe(false)
  })

  it("returns null on match and a 426 response on mismatch", () => {
    expect(protocolMismatch(MOBILE_PROTOCOL_VERSION)).toBeNull()
    expect(protocolMismatch(99)?.status).toBe(426)
  })

  it("reads the header and coerces it to a number", () => {
    const ok = { headers: new Headers({ "x-leadshelf-protocol": "1" }) }
    expect(protocolMismatchFromHeader(ok)).toBeNull()
    const bad = { headers: new Headers({ "x-leadshelf-protocol": "9" }) }
    expect(protocolMismatchFromHeader(bad)?.status).toBe(426)
  })

  it("requires the header by default but can validate-if-present", () => {
    const none = { headers: new Headers() }
    expect(protocolMismatchFromHeader(none)?.status).toBe(426)
    expect(protocolMismatchFromHeader(none, { required: false })).toBeNull()
  })
})
