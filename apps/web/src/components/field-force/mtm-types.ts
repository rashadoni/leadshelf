export interface LiveMapAgent {
  agentId: string
  name: string
  isOnline: boolean
  fieldStatus?: string
  latitude: number
  longitude: number
  accuracy?: number
  speed?: number
  battery?: number
  recordedAt: string
  routeCompletion?: number
}

export interface MtmDashboardAgent extends Omit<LiveMapAgent, "latitude" | "longitude" | "recordedAt"> {
  fieldStatus: string
  routeCompletion: number
  latitude?: number
  longitude?: number
  recordedAt?: string
}

export type MtmFieldStatus = "CHECKED_IN" | "ON_ROAD" | "LATE" | "OFFLINE"

export const FIELD_STATUS_LABEL_KEYS: Record<MtmFieldStatus, string> = {
  CHECKED_IN: "checkedIn",
  ON_ROAD: "onRoad",
  LATE: "late",
  OFFLINE: "offline",
}
