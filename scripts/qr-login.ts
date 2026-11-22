import { Auth, issueQrLoginToken, qrLoginSecret } from "../apps/server/auth.ts";

const [username, ttl = "60", ...extra] = process.argv.slice(2);
if (!username || extra.length)
  throw new Error("npm run qr-login -- имя [срок_в_минутах]");
const secret = qrLoginSecret(process.env.QR_LOGIN_SECRET);
if (!secret || !process.env.USERS_FILE)
  throw new Error("Задайте QR_LOGIN_SECRET и USERS_FILE из конфигурации сервера");

const auth = await new Auth().load(process.env.USERS_FILE);
if (!auth.users.some((user) => user.username === username && user.role === "viewer"))
  throw new Error("Для QR-ссылки нужна существующая учётная запись с ролью viewer");

const origin = new URL(process.env.ORIGIN ?? "http://127.0.0.1:3000");
if (
  origin.username || origin.password ||
  (origin.protocol !== "https:" &&
    !(origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)))
)
  throw new Error("Укажите в ORIGIN HTTPS-адрес приложения или локальный HTTP-адрес");

const link = new URL("/qr-login.html", origin);
link.hash = issueQrLoginToken(username, Number(ttl), secret);
console.log(link.href);
