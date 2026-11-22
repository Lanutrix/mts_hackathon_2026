import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Auth, qrLoginFile, type QrLogin } from "../apps/server/auth.ts";
import { atomicWrite } from "../apps/server/demo.ts";

const [username, ttl = "60", ...extra] = process.argv.slice(2);
if (!username || extra.length)
  throw new Error("npm run qr-login -- имя [срок_в_минутах]");
const minutes = Number(ttl);
if (!Number.isInteger(minutes) || minutes < 1 || minutes > 480)
  throw new Error("Срок действия QR-ссылки должен быть от 1 до 480 минут");
if (!process.env.USERS_FILE)
  throw new Error("Задайте USERS_FILE из конфигурации сервера");

const auth = await new Auth().load(process.env.USERS_FILE);
if (!auth.users.some((user) => user.username === username))
  throw new Error("Для QR-ссылки нужна существующая учётная запись");

const origin = new URL(process.env.ORIGIN ?? "http://127.0.0.1:3000");
if (
  origin.username || origin.password ||
  (origin.protocol !== "https:" &&
    !(origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)))
)
  throw new Error("Укажите в ORIGIN HTTPS-адрес приложения или локальный HTTP-адрес");

const link = new URL("/qr-login.html", origin);
const token = randomBytes(32).toString("base64url");
link.hash = token;
const config: QrLogin = {
  username,
  tokenHash: auth.digest(token),
  expires: Date.now() + minutes * 60_000,
};
const path = resolve(process.env.DATA_DIR ?? ".runtime", qrLoginFile);
await mkdir(dirname(path), { recursive: true, mode: 0o700 });
await atomicWrite(path, JSON.stringify(config));
console.log(link.href);
