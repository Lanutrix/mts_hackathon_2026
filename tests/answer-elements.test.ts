import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  answerCatalog,
  answerExhibits,
} from "../packages/contracts/answerCatalog.ts";
import type { CanvasResult } from "../packages/contracts/canvas.ts";
import { evidenceFor, Exhibit } from "../apps/web/src/AnswerEvidence.tsx";

test("evidence cards use the full selection and ignore the ticket preview limit", () => {
  const selected: CanvasResult = {
    namespace: "demo",
    revision: 1,
    asOf: "2026-11-22T00:00:00Z",
    mode: "model",
    provider: "test",
    title: "По командам",
    summary: "",
    intent: { groupBy: "team", layout: "groups", filters: {} },
    metrics: [
      { key: "overdue", label: "Срок прошёл", value: 13 },
      { key: "escalated", label: "К эскалации", value: 7 },
      { key: "soon", label: "До 15 минут", value: 2 },
    ],
    groups: [
      { key: "a", label: "A", count: 12, overdue: 9, escalated: 4 },
      { key: "b", label: "B", count: 6, overdue: 4, escalated: 3 },
      { key: "c", label: "C", count: 2, overdue: 0, escalated: 0 },
    ],
    total: 20,
    sourceTotal: 40,
    blocks: [],
    tickets: [],
    selection: "selection",
    suggestions: [],
  };
  const all = Object.values(answerCatalog).flatMap(Object.keys);
  assert.equal(all.length, new Set(all).size);
  assert.equal(evidenceFor("median-load", selected)?.value, "6");
  assert.equal(evidenceFor("overdue-rate", selected)?.ratio, 0.65);
  assert.equal(evidenceFor("pareto", selected)?.value, "2");
  assert.equal(evidenceFor("top-two", selected)?.ratio, 0.9);
  assert.equal(evidenceFor("scope-share", selected)?.ratio, 0.5);
  assert.equal(evidenceFor("clean-groups", selected)?.value, "1");
  assert.equal(evidenceFor("highest-late-rate", selected)?.group?.key, "a");
  assert.equal(evidenceFor("median-load", { ...selected, groups: [] }), null);
  for (const id of answerExhibits) {
    assert.ok(all.includes(id));
    const html = renderToStaticMarkup(
      createElement(Exhibit, { id, result: selected, choose() {} }),
    );
    assert.ok(html.includes('data-answer-element="' + id + '"'), id);
    assert.doesNotMatch(html, /NaN|Infinity|undefined/);
  }
});
