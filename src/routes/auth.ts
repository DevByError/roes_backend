import { Hono } from "hono";
import { col, fn } from "sequelize";
import { z } from "zod";
import { checkCode, checkPassword, createCode, hashPassword, issueToken, rateLimit, requireAuth, me, type Env } from "../auth";
import { HttpError, body } from "../http";
import { sendMail } from "../mailer";
import { GameScore, NoticeSeen, Place, User } from "../models";
import { logActivity } from "../serialize";
import { savePhoto } from "../media";

const email = z.string().trim().toLowerCase().email().max(190);
const password = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(100)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), "Use letters and at least one number");
const purpose = z.enum(["register", "reset"]);

const ip = (c: { req: { header: (n: string) => string | undefined } }) => c.req.header("x-forwarded-for")?.split(",")[0].trim() ?? c.req.header("host") ?? "local";

export const authRoutes = new Hono<Env>();

authRoutes.post("/login", rateLimit(10, 60_000, ip), async (c) => {
  const { email: e, password: p } = await body(c, z.object({ email, password: z.string().min(1) }));
  const user = await User.findOne({ where: { email: e } });
  if (!user) throw new HttpError(401, "No account found with this email", "not_found");
  if (!(await checkPassword(p, user.passwordHash))) throw new HttpError(401, "Incorrect password. Try again or reset it.", "wrong_password");
  if (user.status === "frozen") throw new HttpError(403, "This account is frozen. Please contact the mayor's office.", "frozen");
  user.lastActiveAt = new Date();
  await user.save();
  return c.json({ token: await issueToken(user), role: user.role, id: user.id });
});

authRoutes.post("/code", rateLimit(6, 60_000, ip), async (c) => {
  const { email: e, purpose: pu } = await body(c, z.object({ email, purpose }));
  const exists = await User.findOne({ where: { email: e } });
  if (pu === "register" && exists) throw new HttpError(409, "An account with this email already exists", "email_taken");
  if (pu === "reset" && !exists) throw new HttpError(404, "No account found with this email", "not_found");
  const code = await createCode(e, pu);
  await sendMail(
    e,
    pu === "register" ? "Verify your ROES email" : "Reset your ROES password",
    `Your ROES verification code is ${code}.\n\nIt expires in 10 minutes. If you did not request it, you can ignore this email.`,
  );
  return c.json({ ok: true });
});

authRoutes.post("/code/verify", rateLimit(20, 60_000, ip), async (c) => {
  const { email: e, purpose: pu, code } = await body(c, z.object({ email, purpose, code: z.string().length(6) }));
  await checkCode(e, pu, code, false);
  return c.json({ ok: true });
});

authRoutes.post("/register", rateLimit(10, 60_000, ip), async (c) => {
  const b = await body(
    c,
    z.object({
      name: z.string().trim().min(2).max(120),
      email,
      phone: z.string().trim().min(6).max(40),
      password,
      gender: z.enum(["Female", "Male"]),
      placeId: z.string().min(1),
      unit: z.string().trim().min(1).max(40),
      photo: z.string().max(4_000_000).optional(),
      code: z.string().length(6),
    }),
  );
  if (await User.findOne({ where: { email: b.email } })) throw new HttpError(409, "An account with this email already exists", "email_taken");
  const place = await Place.findByPk(b.placeId);
  if (!place || place.kind !== "residential") throw new HttpError(422, "Choose a residence from the list", "validation");
  await checkCode(b.email, "register", b.code, true);
  const user = await User.create({
    role: "user",
    name: b.name,
    email: b.email,
    phone: b.phone,
    passwordHash: await hashPassword(b.password),
    gender: b.gender,
    placeId: place.id,
    unit: b.unit.toUpperCase(),
  });
  if (b.photo) await savePhoto(user, b.photo);
  await logActivity("user", `${user.name} just joined ${place.name}`);
  return c.json({ token: await issueToken(user), role: user.role, id: user.id }, 201);
});

authRoutes.post("/reset", rateLimit(10, 60_000, ip), async (c) => {
  const b = await body(c, z.object({ email, code: z.string().length(6), password }));
  const user = await User.findOne({ where: { email: b.email } });
  if (!user) throw new HttpError(404, "No account found with this email", "not_found");
  await checkCode(b.email, "reset", b.code, true);
  user.passwordHash = await hashPassword(b.password);
  await user.save();
  return c.json({ ok: true });
});

authRoutes.get("/places", async (c) => {
  const places = await Place.findAll({ where: { kind: "residential" }, order: [["name", "ASC"]], attributes: ["id", "name", "district", "address", "category"] });
  const counts = await User.findAll({ where: { role: "user" }, attributes: ["placeId", [fn("COUNT", col("id")), "n"]], group: ["placeId"], raw: true });
  const byPlace = new Map((counts as unknown as { placeId: string; n: string }[]).map((r) => [r.placeId, Number(r.n)]));
  return c.json(places.map((p) => ({ id: p.id, name: p.name, district: p.district, address: p.address, category: p.category, residents: byPlace.get(p.id) ?? 0 })));
});

authRoutes.post("/password", requireAuth(), async (c) => {
  const u = me(c);
  const b = await body(c, z.object({ current: z.string().min(1), next: password }));
  if (!(await checkPassword(b.current, u.passwordHash))) throw new HttpError(400, "Your current password is incorrect", "wrong_password");
  u.passwordHash = await hashPassword(b.next);
  await u.save();
  return c.json({ ok: true });
});

authRoutes.delete("/me", requireAuth("user"), async (c) => {
  const u = me(c);
  await GameScore.destroy({ where: { userId: u.id } });
  await NoticeSeen.destroy({ where: { userId: u.id } });
  await u.destroy();
  return c.json({ ok: true });
});
