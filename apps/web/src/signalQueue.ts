import type { IncidentSignal } from "./IncidentNotice";

// The journal keeps every event. The screen keeps the latest fact per ticket.
export function mergeSignals(
  pending: IncidentSignal[],
  fresh: IncidentSignal[],
) {
  const byTicket = new Map(pending.map((signal) => [signal.key, signal]));
  for (const signal of [...fresh].sort((a, b) => a.revision - b.revision)) {
    const current = byTicket.get(signal.key);
    if (!current || current.revision < signal.revision) {
      byTicket.delete(signal.key);
      byTicket.set(signal.key, signal);
    }
  }
  const critical = (signal: IncidentSignal) =>
    Number(
      signal.reasons.some((r) => r === "critical" || r === "critical-reopened"),
    );
  return [...byTicket.values()]
    .sort(
      (a, b) =>
        critical(b) - critical(a) ||
        b.revision - a.revision ||
        a.key.localeCompare(b.key),
    )
    .slice(0, 32);
}
