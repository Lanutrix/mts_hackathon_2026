import type { Incident } from "../../packages/domain/index.ts";

// A null endpoint marks the boundary of an observable, valid ticket history.
export interface StatusChange {
  key: string;
  at: string;
  fromState: number | null;
  toState: number | null;
}

export function measuredStatusIntervals(events: StatusChange[], rows: Incident[], start: number, end: number) {
  const previous = new Map<string, { at: number; state: number }>();
  const measurements = new Map<string, { totalMs: number; intervalCount: number }>();
  let totalMs = 0, intervalCount = 0;
  // Both data sources return events in revision order; wall clocks can move backwards.
  for (const event of events) {
    if (event.fromState === event.toState) continue;
    const last = previous.get(event.key);
    const at = Date.parse(event.at);
    if (event.fromState === null || event.toState === null || !Number.isFinite(at) || at > end) {
      previous.delete(event.key);
      continue;
    }
    if (last && last.state === event.fromState && at >= last.at && at >= start) {
      const measure = measurements.get(event.key) ?? { totalMs: 0, intervalCount: 0 };
      const ms = at - last.at;
      measure.totalMs += ms;
      measure.intervalCount++;
      measurements.set(event.key, measure);
      totalMs += ms;
      intervalCount++;
    }
    previous.set(event.key, { at, state: event.toState });
  }
  const tickets = new Map<string, { meanMs: number; intervalCount: number }>();
  for (const [key, m] of measurements)
    tickets.set(key, { meanMs: m.totalMs / m.intervalCount, intervalCount: m.intervalCount });
  return { tickets, summary: { meanMs: intervalCount ? totalMs / intervalCount : null, intervalCount, ticketCount: tickets.size, scopeCount: rows.length } };
}
