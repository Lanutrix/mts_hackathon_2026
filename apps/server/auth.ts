import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
  createHmac,
} from "node:crypto";
import { readFile } from "node:fs/promises";
export type Role = "viewer" | "coordinator" | "demo-admin";
export interface User {
  username: string;
  role: Role;
  salt: string;
  hash: string;
}
export function passwordHash(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString("hex");
}
const qrMaxAgeSeconds = 8 * 3600;

function qrSignature(payload: string, secret: string) {
  return createHmac("sha256", Buffer.from(secret, "hex"))
    .update(payload)
    .digest("base64url");
}

export function qrLoginSecret(value?: string) {
  if (!value) return undefined;
  if (!/^[a-f0-9]{64}$/i.test(value))
    throw new Error("QR_LOGIN_SECRET должен содержать 64 шестнадцатеричных символа");
  return value;
}

export function issueQrLoginToken(username: string, minutes: number, secret: string) {
  const name = Buffer.from(username).toString("base64url");
  if (!name || name.length > 684)
    throw new Error("Имя пользователя слишком длинное для QR-ссылки");
  if (!Number.isInteger(minutes) || minutes < 1 || minutes * 60 > qrMaxAgeSeconds)
    throw new Error("Срок действия QR-ссылки должен быть от 1 до 480 минут");
  const expires = Math.floor(Date.now() / 1000) + minutes * 60;
  const payload = expires + "." + name;
  return payload + "." + qrSignature(payload, secret);
}

export class Auth {
  users: User[] = [];
  sessions = new Map<
    string,
    { username: string; role: Role; csrf: string; expires: number }
  >();
  async load(path?: string) {
    if (path) {
      const data = JSON.parse(await readFile(path, "utf8"));
      if (!Array.isArray(data))
        throw new Error("Некорректный файл пользователей");
      this.users = data;
    }
    return this;
  }
  login(username: unknown, password: unknown) {
    if (
      typeof username !== "string" ||
      typeof password !== "string" ||
      password.length > 1024
    )
      return null;
    const user = this.users.find((u) => u.username === username);
    const salt = user?.salt ?? "00000000000000000000000000000000";
    const calculated = passwordHash(password, salt);
    if (
      !user ||
      !timingSafeEqual(
        Buffer.from(calculated, "hex"),
        Buffer.from(user.hash, "hex"),
      )
    )
      return null;
    return this.startSession(user);
  }
  loginWithQr(code: string, secret: string) {
    const parts = /^(\d{10})\.([a-zA-Z0-9_-]{1,684})\.([a-zA-Z0-9_-]{43})$/.exec(code);
    if (!parts) return null;
    const [, expires, name, signature] = parts;
    const now = Date.now();
    const expiry = Number(expires) * 1000;
    if (expiry <= now || expiry > now + qrMaxAgeSeconds * 1000)
      return null;
    const expected = qrSignature(expires + "." + name, secret);
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

    const username = Buffer.from(name, "base64url").toString("utf8");
    const user = this.users.find((u) => u.username === username && u.role === "viewer");
    return user ? this.startSession(user, expiry) : null;
  }
  private startSession(user: User, expires = Date.now() + 8 * 3600_000) {
    const token = randomBytes(32).toString("hex"),
      session = {
        username: user.username,
        role: user.role,
        csrf: randomBytes(24).toString("hex"),
        expires,
      };
    this.sessions.set(this.digest(token), session);
    this.cleanup();
    return { token, session };
  }
  digest(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }
  get(token?: string) {
    if (!token) return null;
    const s = this.sessions.get(this.digest(token));
    if (!s || s.expires < Date.now()) {
      this.sessions.delete(this.digest(token));
      return null;
    }
    return s;
  }
  logout(token?: string) {
    if (token) this.sessions.delete(this.digest(token));
  }
  cleanup() {
    for (const [k, s] of this.sessions)
      if (s.expires < Date.now()) this.sessions.delete(k);
  }
}
