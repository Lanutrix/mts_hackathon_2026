import type { Group, Incident } from "../../../packages/domain/index.ts";

export const groups: Group[] = ["critical", "coordinators", "high", "research"];
export type Signal = Group | "all";
type GroupPage = {
  items: Incident[];
  count: number;
  offset: number;
  unverified: number;
};
export type Dashboard = {
  namespace: string;
  revision: number;
  total: number;
  unique: number;
  groups: Record<Group, GroupPage>;
};

function compare(a: Incident, b: Incident, sort: string) {
  if (sort === "registered")
    return String(b.dates.submitDate).localeCompare(String(a.dates.submitDate));
  if (sort === "id") return a.id.localeCompare(b.id);
  const date = (value: string | null) => (value ? Date.parse(value) : Infinity);
  return (
    date(a.dates.deadline) - date(b.dates.deadline) || a.id.localeCompare(b.id)
  );
}

// Each API group is a sorted stream. Stop at the first unknown head so arriving
// pages can only extend the prefix already shown, even when many rows overlap.
export function mergeStreams(
  first: Dashboard,
  pages: Dashboard[],
  signal: Signal,
  sort: string,
  limit: number,
) {
  const streams = (signal === "all" ? groups : [signal]).map((group) => ({
    rows: [first, ...pages].flatMap((page) => page.groups[group].items),
    count: first.groups[group].count,
    cursor: 0,
  }));
  const result: Incident[] = [],
    seen = new Set<string>();
  while (result.length < limit) {
    if (streams.some((s) => s.cursor === s.rows.length && s.cursor < s.count))
      break;
    let next: (typeof streams)[number] | undefined;
    for (const stream of streams) {
      const row = stream.rows[stream.cursor];
      if (row && (!next || compare(row, next.rows[next.cursor], sort) < 0))
        next = stream;
    }
    if (!next) break;
    const row = next.rows[next.cursor++];
    if (!seen.has(row.key)) {
      seen.add(row.key);
      result.push(row);
    }
  }
  return result;
}

export function duration(ms: number) {
  const seconds = Math.floor(Math.abs(ms) / 1000),
    minutes = Math.floor(seconds / 60),
    hours = Math.floor(minutes / 60);
  if (hours >= 24) return Math.floor(hours / 24) + "д " + (hours % 24) + "ч";
  if (hours) return hours + "ч " + String(minutes % 60).padStart(2, "0") + "м";
  return (
    String(minutes).padStart(2, "0") +
    ":" +
    String(seconds % 60).padStart(2, "0")
  );
}
