import type { Incident } from "./index.ts";

// Both the API's queue pages and the wallboard's merge must use the same order.
// Normalized dates are ISO UTC; a missing value belongs at the end in either direction.
export function compareTickets(a: Incident, b: Incident, sort?: string) {
  if (sort === "id") return a.id.localeCompare(b.id);
  const byId = () => a.id.localeCompare(b.id);
  if (sort === "registered")
    return (b.dates.submitDate ?? "").localeCompare(a.dates.submitDate ?? "") || byId();
  const priority = sort === "priority" ? (b.priorityId ?? 0) - (a.priorityId ?? 0) : 0;
  return priority || (a.dates.deadline ?? "\uffff").localeCompare(b.dates.deadline ?? "\uffff") || byId();
}
