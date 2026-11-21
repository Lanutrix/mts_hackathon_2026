import { cp, mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
// Offline PGlite backup only. Stop the application first. PostgreSQL uses pg_dump.
const [command, from, to] = process.argv.slice(2);
if (!["backup", "restore"].includes(command) || !from || !to)
  throw new Error(
    "backup-local.ts backup|restore SOURCE NEW_DESTINATION (приложение остановлено)",
  );
const source = resolve(from),
  target = resolve(to);
if (
  target === source ||
  target.startsWith(source + "/") ||
  target.startsWith(source + "\\")
)
  throw new Error("Нужен отдельный каталог");
if (
  await stat(target).then(
    () => true,
    () => false,
  )
)
  throw new Error("Каталог назначения уже существует; перезапись запрещена");
await cp(source, target, { recursive: true, errorOnExist: true, force: false });
console.log(JSON.stringify({ status: "done", command }));
