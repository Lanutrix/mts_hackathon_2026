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
    const token = randomBytes(32).toString("hex"),
      session = {
        username: user.username,
        role: user.role,
        csrf: randomBytes(24).toString("hex"),
        expires: Date.now() + 8 * 3600_000,
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
