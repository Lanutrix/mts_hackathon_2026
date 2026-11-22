import assert from "node:assert/strict";
import test from "node:test";
import { generate } from "../packages/domain/generator.ts";
import { normalize } from "../packages/domain/index.ts";
import {
  groups,
  mergeStreams,
  type Dashboard,
} from "../apps/web/src/liveFeed.ts";

test("identical registration times retain server ID order across different signal queues", () => {
  const sample = generate(2).rows[0];
  const tickets = ["T-2", "T-1"].map((id) =>
    normalize({ ...sample, id, sysId: null }, "demo"),
  );
  const streams = Object.fromEntries(
    groups.map((group) => {
      const items =
        group === "critical"
          ? [tickets[0]]
          : group === "high"
            ? [tickets[1]]
            : [];
      return [group, { count: items.length, items, offset: 0, unverified: 0 }];
    }),
  ) as Dashboard["groups"];
  const board = {
    namespace: "demo",
    revision: 1,
    total: 2,
    unique: 2,
    groups: streams,
  };
  assert.deepEqual(
    mergeStreams(board, [], "all", "registered", 2).map((row) => row.id),
    ["T-1", "T-2"],
  );
});
