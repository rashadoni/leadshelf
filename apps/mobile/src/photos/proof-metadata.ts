export interface ProofMetadataInput {
  takenAt: string
  taskId: string
  storeId: string
  storeName?: string | null
  userId?: string | null
  locationHint?: string | null
  appVersion?: string | null
}

export interface ProofExifPayload {
  DateTimeOriginal: string
  Make: "LeadShelf"
  Model: string
  Software: "LeadShelf Mobile"
  ImageDescription: string
  watermarked: true
}

export function buildProofExifPayload(input: ProofMetadataInput): ProofExifPayload {
  const description = {
    userId: input.userId ?? null,
    taskId: input.taskId,
    storeId: input.storeId,
    storeName: input.storeName ?? null,
    locationHint: input.locationHint ?? null,
    watermarked: true,
    watermarkedAt: input.takenAt,
    watermarkMode: "camera_overlay",
    gpsUnavailable: true,
  }
  return {
    DateTimeOriginal: input.takenAt,
    Make: "LeadShelf",
    Model: input.appVersion ?? "mobile-app",
    Software: "LeadShelf Mobile",
    ImageDescription: JSON.stringify(description),
    watermarked: true,
  }
}

export function buildProofExifJson(input: ProofMetadataInput): string {
  return JSON.stringify(buildProofExifPayload(input))
}
