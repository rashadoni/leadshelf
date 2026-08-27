import { describe, expect, it } from "vitest"
import type { FieldRouteTargetCatalogData, FieldRouteTargetType } from "./contracts"
import {
  appendRouteTargetBrowsePage,
  initialBrowseTargetTypes,
  makeRouteTargetBrowseGroups,
} from "./route-target-browse"

const allCustomers: FieldRouteTargetType = {
  id: "all-customers",
  labels: { az: "Bütün müştərilər", ru: "Все клиенты", en: "All customers" },
  direction: "ORGANIZATION",
  objectType: null,
  organizationKind: null,
}

const doctors: FieldRouteTargetType = {
  id: "doctors",
  labels: { az: "Həkimlər", ru: "Врачи", en: "Doctors" },
  direction: "DOCTOR",
  objectType: null,
  organizationKind: null,
}

const pharmacies: FieldRouteTargetType = {
  id: "pharmacies",
  labels: { az: "Apteklər", ru: "Аптеки", en: "Pharmacies" },
  direction: "PHARMACY",
  objectType: "PHARMACY",
  organizationKind: null,
}
function catalog(type: FieldRouteTargetType, keys: string[], page = 1): FieldRouteTargetCatalogData {
  return {
    targetAgent: { id: "agent-1", name: "Aysel" },
    date: "2026-08-27",
    targetTypes: [allCustomers, doctors],
    targetType: type,
    selectionScope: {
      mode: "EFFECTIVE_ASSIGNMENTS",
      assignmentRequired: true,
      agentId: "agent-1",
      effectiveOn: "2026-08-27",
    },
    items: keys.map((targetKey) => ({
      targetKey,
      subjectType: targetKey.startsWith("contact:") ? "CONTACT" : "ORGANIZATION",
      customer: {
        id: `customer-${targetKey}`,
        name: targetKey,
        code: null,
        objectType: "CLINIC",
        category: "A",
        address: null,
        city: null,
        phone: null,
        latitude: null,
        longitude: null,
      },
      contact: targetKey.startsWith("contact:") ? {
        id: targetKey,
        displayName: targetKey,
        type: "DOCTOR",
        specialtyName: null,
        phone: null,
      } : null,
      availability: { source: "CUSTOMER_ASSIGNMENT", validFrom: null, validThrough: null },
    })),
    page: { number: page, limit: 12, hasMore: false },
    emptyReason: null,
  }
}

describe("route target browse groups", () => {
  it("starts with assigned customers and doctors, not every overlapping category", () => {
    expect(initialBrowseTargetTypes(catalog(allCustomers, []))).toEqual([allCustomers, doctors])
  })

  it("keeps every configured category browseable when a tenant has no all-customers feed", () => {
    expect(initialBrowseTargetTypes({ ...catalog(pharmacies, []), targetTypes: [pharmacies, doctors] })).toEqual([pharmacies, doctors])
  })

  it("keeps a target only once when configured filters overlap", () => {
    const groups = makeRouteTargetBrowseGroups([
      catalog(allCustomers, ["customer:clinic-1", "customer:pharmacy-1"]),
      catalog(doctors, ["contact:doctor-1", "customer:pharmacy-1"]),
    ])

    expect(groups.map((group) => group.items.map((item) => item.targetKey))).toEqual([
      ["customer:clinic-1", "customer:pharmacy-1"],
      ["contact:doctor-1"],
    ])
  })

  it("appends a later page without reintroducing an existing target", () => {
    const initial = makeRouteTargetBrowseGroups([
      catalog(allCustomers, ["customer:clinic-1"]),
      catalog(doctors, ["contact:doctor-1"]),
    ])
    const next = catalog(allCustomers, ["customer:clinic-1", "customer:clinic-2"], 2)
    const groups = appendRouteTargetBrowsePage(initial, allCustomers.id, next)

    expect(groups[0]?.items.map((item) => item.targetKey)).toEqual([
      "customer:clinic-1",
      "customer:clinic-2",
    ])
  })
})
