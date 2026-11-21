import { readFile } from "node:fs/promises";
import { atomicWrite } from "../apps/server/demo.ts";
import { TEAM, STATES } from "../packages/domain/index.ts";
const [path, action, arg] = process.argv.slice(2);
const rows = JSON.parse(await readFile(path, "utf8"));
const r = rows.find((x: any) => x.id === "DEMO-42-00001") ?? rows[0];
switch (action) {
  case "critical":
    r.priorityId = 4;
    r.priority = "Наивысший";
    break;
  case "coordinator":
    r.assignedGroupName = TEAM;
    break;
  case "state":
    r.stateId = Number(arg);
    r.stateEnum = STATES[r.stateId].enum;
    r.state = STATES[r.stateId].label;
    if (r.stateId === 7)
      r.completionDate = new Date(
        Math.max(Date.now(), Date.parse(r.submitDate) + 60_000),
      ).toISOString();
    break;
  case "deadline":
    r.deadline = arg === "null" ? null : arg;
    break;
  case "header":
    r.header = arg;
    break;
  case "drop":
    rows.shift();
    break;
  case "reverse":
    rows.reverse();
    break;
  case "flags":
    r.isNeedUp = true;
    r.isMaster = true;
    r.isDouble = true;
    r.isEffect = null;
    r.isReason = true;
    break;
  case "storm":
    for (const row of rows) {
      row.stateId = 0;
      row.stateEnum = "Assigned";
      row.priorityId = 4;
      row.priority = "Наивысший";
    }
    break;
  default:
    throw new Error("Unknown test action");
}
await atomicWrite(path, JSON.stringify(rows));
console.log(Date.now());
