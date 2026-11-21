import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { passwordHash, type Role, type User } from "../apps/server/auth.ts";
const [username, role, pathArg] = process.argv.slice(2),
  path = resolve(pathArg ?? ".runtime/users.json");
if (!username || !["viewer", "coordinator", "demo-admin"].includes(role))
  throw new Error("npm run user -- имя viewer|coordinator|demo-admin [файл]");
// Password is entered in raw TTY: never echoed, logged, passed in argv or written in clear text.
if (!process.stdin.isTTY) throw new Error("Требуется интерактивный терминал");
process.stdout.write("Новый пароль (не отображается, минимум 12 символов): ");
process.stdin.setRawMode(true);
process.stdin.resume();
const password = await new Promise<string>((resolve, reject) => {
  let input = "";
  const handler = (data: Buffer) => {
    for (const ch of data.toString("utf8")) {
      if (ch === "\u0003") {
        process.stdin.setRawMode(false);
        process.exit(130);
      }
      if (ch === "\r" || ch === "\n") {
        process.stdin.off("data", handler);
        resolve(input);
        return;
      }
      if (ch === "\u007f" || ch === "\b") input = input.slice(0, -1);
      else input += ch;
    }
  };
  process.stdin.on("data", handler);
});
process.stdin.setRawMode(false);
process.stdin.pause();
process.stdout.write("\n");
if (password.length < 12) throw new Error("Пароль короче 12 символов");
let users: User[] = [];
try {
  users = JSON.parse(await readFile(path, "utf8"));
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}
const salt = randomBytes(16).toString("hex");
users = users.filter((u) => u.username !== username);
users.push({
  username,
  role: role as Role,
  salt,
  hash: passwordHash(password, salt),
});
await mkdir(dirname(path), { recursive: true });
await writeFile(path, JSON.stringify(users), { mode: 0o600 });
await chmod(path, 0o600);
console.log("Учётная запись сохранена. Пароль не записан в открытом виде.");
