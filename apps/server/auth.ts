import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
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
export const qrLoginFile = "secrets/qr-login.json";

export interface QrLogin {
  username: string;
  tokenHash: string;
  expires: number;
}

export async function loadQrLogin(path: string): Promise<QrLogin | undefined> {
  const text = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (text === undefined) return undefined;

  const config = JSON.parse(text);
  if (!config || typeof config.username !== "string" || !config.username ||
    typeof config.tokenHash !== "string" || !/^[a-f0-9]{64}$/.test(config.tokenHash) ||
    !Number.isSafeInteger(config.expires))
    throw new Error("Некорректная конфигурация QR-входа");
  return config;
}

export async function loadQrLoginConfig(path: string, releasePath?: string) {
  const local = await loadQrLogin(path);
  if (!releasePath) return local;

  const release = await loadQrLogin(releasePath);
  const now = Date.now();
  if (!release || release.expires <= now) return local;
  if (local && local.expires > now && local.username !== release.username)
    return local;
  if (local?.tokenHash === release.tokenHash && local.expires > release.expires)
    return local;
  return release;
}

const sessionMaxAgeMs = 8 * 3600_000;

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
  loginWithQr(code: string, config: QrLogin) {
    const now = Date.now();
    if (!/^[a-zA-Z0-9_-]{43}$/.test(code) || config.expires <= now)
      return null;
    if (!timingSafeEqual(Buffer.from(this.digest(code), "hex"), Buffer.from(config.tokenHash, "hex")))
      return null;

    const user = this.users.find((u) => u.username === config.username);
    return user ? this.startSession(user, Math.min(config.expires, now + sessionMaxAgeMs)) : null;
  }
  private startSession(user: User, expires = Date.now() + sessionMaxAgeMs) {
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
