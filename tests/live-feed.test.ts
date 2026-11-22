import assert from "node:assert/strict";
import test from "node:test";
import { generate } from "../packages/domain/generator.ts";
import { normalize, type Incident } from "../packages/domain/index.ts";
import {
  groups,
  mergeStreams,
  type Dashboard,
} from "../apps/web/src/liveFeed.ts";

test("Live register extends an ordered prefix across overlapping incident groups", () => {
  const rows = generate(350).rows.map((raw) => normalize(raw, "demo"));
  const ordered = rows.sort((a, b) => a.id.localeCompare(b.id));
  const relevant = ordered.filter((row) => row.groups.length);
  const pages: Dashboard[] = [];
  for (let offset = 0; offset < relevant.length; offset += 30) {
    const buckets = Object.fromEntries(
      groups.map((group) => {
        const groupRows = ordered.filter((row) => row.groups.includes(group));
        return [
          group,
          {
            items: groupRows.slice(offset, offset + 30),
            count: groupRows.length,
            offset,
            unverified: 0,
          },
        ];
      }),
    ) as Dashboard["groups"];
    pages.push({
      revision: 1,
      namespace: "demo",
      total: rows.length,
      unique: relevant.length,
      groups: buckets,
    });
    const result = mergeStreams(
      pages[0],
      pages.slice(1),
      "all",
      "id",
      rows.length,
    );
    assert.deepEqual(
      result.map((row) => row.id),
      relevant.slice(0, result.length).map((row) => row.id),
    );
  }
  const collect = (items: Incident[]) => items.map((i) => i.id);
  assert.deepEqual(
    collect(mergeStreams(pages[0], pages.slice(1), "all", "id", rows.length)),
    collect(relevant),
  );
  for (const group of groups) {
    assert.deepEqual(
      collect(mergeStreams(pages[0], pages.slice(1), group, "id", rows.length)),
      collect(relevant.filter((r) => r.groups.includes(group))),
    );
  }
});
