export function routeTargetKey(customerId: string, contactId?: string | null): string {
  return contactId ? `contact:${contactId}` : `customer:${customerId}`
}
