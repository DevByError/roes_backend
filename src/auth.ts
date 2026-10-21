import type { Context, MiddlewareHandler } from "hono";
import { sign, verify } from "hono/jwt";
import { Op } from "sequelize";
import { config } from "./config";
import { HttpError, norm } from "./http";
import { User, VerificationCode } from "./models";

export type Role = "mayor" | "admin" | "user";
export type Env = { Variables: { user: User } };

export const hashPassword = (p: string) => Bun.password.hash(p);
export const checkPassword = (p: string, h: string) => Bun.password.verify(p, h);

export async function issueToken(u: User) {
  const exp = Math.floor(Date.now() / 1000) + config.JWT_EXPIRES_DAYS * 86400;
  return sign({ sub: u.id, role: u.role, exp }, config.JWT_SECRET, "HS256");
}

export function requireAuth(...roles: Role[]): MiddlewareHandler<Env> {
  return async (c, next) => {
    const h = c.req.header("authorization") ?? "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : "";
    if (!token) throw new HttpError(401, "Sign in required", "unauthenticated");
    let sub: string;
    try {
      const p = await verify(token, config.JWT_SECRET, "HS256");
      sub = String(p.sub);
    } catch {
      throw new HttpError(401, "Your session has expired. Please sign in again.", "unauthenticated");
    }
    const user = await User.findByPk(sub);
    if (!user) throw new HttpError(401, "Account no longer exists", "unauthenticated");
    if (user.status === "frozen") throw new HttpError(403, "This account is frozen. Please contact the mayor's office.", "frozen");
    if (roles.length && !roles.includes(user.role)) throw new HttpError(403, "You do not have access to this", "forbidden");
    c.set("user", user);
    await next();
  };
}

export const me = (c: Context<Env>) => c.get("user");

const buckets = new Map<string, { n: number; reset: number }>();
export function rateLimit(max: number, windowMs: number, key: (c: Context) => string): MiddlewareHandler {
  return async (c, next) => {
    if (config.NODE_ENV === "test") return next();
    const k = `${c.req.path}:${key(c)}`;
    const now = Date.now();
    const b = buckets.get(k);
    if (!b || b.reset < now) buckets.set(k, { n: 1, reset: now + windowMs });
    else if (++b.n > max) throw new HttpError(429, "Too many attempts. Please wait a moment and try again.", "rate_limited");
    await next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
}, 60_000).unref();

const sha = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");
const CODE_TTL_MS = 10 * 60_000;
const RESEND_MS = 30_000;

export function newCode() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

export async function createCode(email: string, purpose: "register" | "reset") {
  const e = norm(email);
  const last = await VerificationCode.findOne({ where: { email: e, purpose }, order: [["createdAt", "DESC"]] });
  if (last && Date.now() - last.createdAt.getTime() < RESEND_MS && config.NODE_ENV !== "test") {
    throw new HttpError(429, "Please wait a few seconds before requesting another code.", "rate_limited");
  }
  await VerificationCode.destroy({ where: { email: e, purpose } });
  const code = newCode();
  await VerificationCode.create({ email: e, purpose, codeHash: sha(`${e}:${purpose}:${code}`), expiresAt: new Date(Date.now() + CODE_TTL_MS) });
  return code;
}

export async function checkCode(email: string, purpose: "register" | "reset", code: string, consume: boolean) {
  const e = norm(email);
  const row = await VerificationCode.findOne({ where: { email: e, purpose, expiresAt: { [Op.gt]: new Date() } }, order: [["createdAt", "DESC"]] });
  if (!row || row.attempts >= 5) throw new HttpError(400, "That code has expired. Request a new one.", "code_expired");
  if (sha(`${e}:${purpose}:${code.trim()}`) !== row.codeHash) {
    row.attempts += 1;
    await row.save();
    throw new HttpError(400, "That code isn't right. Check it and try again.", "code_invalid");
  }
  if (consume) await row.destroy();
}
