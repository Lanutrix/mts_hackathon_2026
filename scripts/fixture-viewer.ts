import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { passwordHash } from "../apps/server/auth.ts";

// Isolated browser fixtures each get their own reader.
export async function createFixtureViewer(directory: string) {
  const password = randomBytes(24).toString("hex");
  const salt = randomBytes(16).toString("hex");
  const path = join(directory, "fixture-users.json");
  const username = "fixture-viewer";
  await writeFile(
    path,
    JSON.stringify([
      { username, role: "viewer", salt, hash: passwordHash(password, salt) },
    ]),
    { flag: "wx", mode: 0o600 },
  );
  return { path, credentials: { username, password } };
}
