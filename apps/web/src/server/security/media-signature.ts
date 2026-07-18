const ASCII = new TextEncoder()

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value)
}

function asciiAt(bytes: Uint8Array, offset: number, value: string): boolean {
  const expected = ASCII.encode(value)
  return expected.every((byte, index) => bytes[offset + index] === byte)
}

export function matchesDeclaredMediaType(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === "image/jpeg") return startsWith(bytes, [0xff, 0xd8, 0xff])
  if (mimeType === "image/png") {
    return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  }
  if (mimeType === "image/webp") {
    return asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP")
  }
  if (mimeType === "video/mp4" || mimeType === "video/quicktime") {
    return asciiAt(bytes, 4, "ftyp")
  }
  if (mimeType === "video/webm") {
    return startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])
  }
  return false
}
