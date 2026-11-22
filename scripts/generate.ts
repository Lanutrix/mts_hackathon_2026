import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generate, FIXED_CLOCK } from "../packages/domain/generator.ts";
const args = process.argv.slice(2);
const count = Number(args[0] ?? 600),
  seed = Number(args[1] ?? 42),
  dir = resolve(args[2] ?? ".runtime/demo");
if (
  !Number.isInteger(count) ||
  count < 0 ||
  count > 20000 ||
  !Number.isInteger(seed)
)
  throw new Error("count 0..20000; seed integer");
const { rows, manifest } = generate(
  count,
  seed,
  args.includes("--live") ? new Date().toISOString() : FIXED_CLOCK,
);
await mkdir(dir, { recursive: true });
await writeFile(resolve(dir, "incidents.json"), JSON.stringify(rows, null, 2));
await writeFile(
  resolve(dir, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(
  JSON.stringify({ count, seed, directory: dir, hash: manifest.sha256 }),
);
