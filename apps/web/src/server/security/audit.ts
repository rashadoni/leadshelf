type SecurityEvent =
  | "authentication_failed"
  | "authentication_rate_limited"
  | "authentication_locked"

export function writeSecurityAudit(
  event: SecurityEvent,
  details: { channel: "web" | "mobile"; principalKey: string },
): void {
  // Только непрозрачный SHA-256 ключ: email/employee code, PIN, token и IP
  // никогда не пишутся в лог. В production stdout забирает log collector.
  console.warn(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "warn",
    category: "security",
    event,
    channel: details.channel,
    principalKey: details.principalKey,
  }))
}
