import { Hono } from "hono";
import { z } from "zod";
import { Op } from "sequelize";
import { hashPassword, me, requireAuth, type Env } from "../auth";
import { HttpError, body } from "../http";
import { sendMail } from "../mailer";
import { saveDonationImage, savePhoto } from "../media";
import {
  Activity,
  Complaint,
  ComplaintMessage,
  Donation,
  Notice,
  Place,
  PlaceReport,
  Policy,
  Report,
  Rule,
  User,
} from "../models";
import { sequelize } from "../db";
import {
  adminByPlace,
  cityInfo,
  coverFor,
  loadRules,
  logActivity,
  messagesFor,
  originOf,
  webAdmin,
  webComplaint,
  webDonation,
  webMayor,
  webNotice,
  webPlace,
  webPolicy,
  webUser,
} from "../serialize";

export const mayorRoutes = new Hono<Env>();
mayorRoutes.use("*", requireAuth("mayor"));

const phone = z.string().trim().max(40);

mayorRoutes.get("/sync", async (c) => {
  const origin = originOf(c);
  const mayor = me(c);
  const [people, places, rules, admins, notices, policies, donations, complaints, activity, reports] = await Promise.all([
    User.findAll({ where: { role: { [Op.ne]: "mayor" } }, order: [["createdAt", "DESC"]] }),
    Place.findAll({ order: [["createdAt", "DESC"]] }),
    loadRules(),
    adminByPlace(),
    Notice.findAll({ order: [["createdAt", "DESC"]], limit: 500 }),
    Policy.findAll({ order: [["createdAt", "DESC"]] }),
    Donation.findAll({ order: [["createdAt", "DESC"]] }),
    Complaint.findAll({ where: { kind: "public" }, order: [["updatedAt", "DESC"]], limit: 500 }),
    Activity.findAll({ order: [["createdAt", "DESC"]], limit: 30 }),
    Report.findAll({ attributes: ["fromId"] }),
  ]);
  const msgs = await messagesFor<ComplaintMessage>(ComplaintMessage, "complaintId", complaints.map((x) => x.id));
  const counts = new Map<string, number>();
  for (const r of reports) counts.set(r.fromId, (counts.get(r.fromId) ?? 0) + 1);
  return c.json({
    city: cityInfo(),
    mayor: webMayor(mayor, origin),
    admins: people.filter((u) => u.role === "admin").map(webAdmin),
    users: people.filter((u) => u.role === "user" || u.promoted).map((u) => webUser(u, counts.get(u.id) ?? 0)),
    places: places.map((p) => webPlace(p, rules, admins)),
    announcements: notices.map(webNotice),
    policies: policies.map(webPolicy),
    donations: donations.map((d) => webDonation(d, origin)),
    complaints: complaints.map((x) => webComplaint(x, msgs.get(x.id) ?? [])),
    activity: activity.map((a) => ({ id: a.id, kind: a.kind, text: a.text, at: a.createdAt.toISOString() })),
  });
});

const randomPassword = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("") + "7a";
};

async function assignAdmin(adminId: string, placeId: string | null) {
  const admin = await User.findOne({ where: { id: adminId, role: "admin" } });
  if (!admin) throw new HttpError(404, "Admin not found");
  let place: Place | null = null;
  if (placeId) {
    place = await Place.findByPk(placeId);
    if (!place) throw new HttpError(404, "Place not found");
    await User.update({ placeId: null }, { where: { role: "admin", placeId, id: { [Op.ne]: adminId } } });
  }
  admin.placeId = placeId;
  await admin.save();
  await logActivity("admin", place ? `${admin.name} is now the admin of ${place.name}` : `${admin.name} was unassigned from their place`);
  return admin;
}

mayorRoutes.post("/admins", async (c) => {
  const b = await body(
    c,
    z.object({
      name: z.string().trim().min(2).max(120),
      email: z.string().trim().toLowerCase().email(),
      phone: phone.min(6),
      nationalId: z.string().trim().min(4).max(40),
      gender: z.enum(["Female", "Male"]),
      placeId: z.string().nullable().optional(),
    }),
  );
  if (await User.findOne({ where: { email: b.email } })) throw new HttpError(409, "An account with this email already exists", "email_taken");
  const temporaryPassword = randomPassword();
  const admin = await User.create({
    role: "admin",
    name: b.name,
    email: b.email,
    phone: b.phone,
    nationalId: b.nationalId,
    gender: b.gender,
    passwordHash: await hashPassword(temporaryPassword),
  });
  await logActivity("admin", `${admin.name} was created as an admin`);
  if (b.placeId) await assignAdmin(admin.id, b.placeId);
  await sendMail(
    admin.email,
    "Your ROES admin account",
    `Hello ${admin.name},\n\nThe mayor's office created an admin account for you.\nEmail: ${admin.email}\nTemporary password: ${temporaryPassword}\n\nSign in to the ROES app and change your password from your profile.`,
  ).catch(() => {});
  await admin.reload();
  return c.json({ admin: webAdmin(admin), temporaryPassword }, 201);
});

mayorRoutes.post("/admins/promote", async (c) => {
  const b = await body(c, z.object({ userId: z.string(), placeId: z.string().nullable().optional() }));
  const user = await User.findOne({ where: { id: b.userId, role: "user" } });
  if (!user) throw new HttpError(404, "User not found");
  user.residenceId = user.placeId;
  user.placeId = null;
  user.role = "admin";
  user.promoted = true;
  await user.save();
  await logActivity("admin", `${user.name} was promoted from user to admin`);
  if (b.placeId) await assignAdmin(user.id, b.placeId);
  await user.reload();
  return c.json({ admin: webAdmin(user) });
});

mayorRoutes.patch("/admins/:id/place", async (c) => {
  const b = await body(c, z.object({ placeId: z.string().nullable() }));
  const admin = await assignAdmin(c.req.param("id"), b.placeId);
  return c.json({ admin: webAdmin(admin) });
});

mayorRoutes.post("/admins/:id/freeze", async (c) => {
  const b = await body(c, z.object({ frozen: z.boolean(), reason: z.string().trim().max(255).optional() }));
  const admin = await User.findOne({ where: { id: c.req.param("id"), role: "admin" } });
  if (!admin) throw new HttpError(404, "Admin not found");
  admin.status = b.frozen ? "frozen" : "active";
  admin.frozenReason = b.frozen ? b.reason || "Frozen by the mayor." : null;
  admin.frozenAt = b.frozen ? new Date() : null;
  await admin.save();
  await logActivity("admin", `${admin.name}'s account was ${b.frozen ? "frozen" : "reactivated"}`);
  return c.json({ admin: webAdmin(admin) });
});

const placeSchema = z.object({
  name: z.string().trim().min(2).max(160),
  kind: z.enum(["residential", "non-residential"]),
  category: z.string().trim().min(1).max(80),
  district: z.string().trim().min(1).max(120),
  address: z.string().trim().min(2).max(255),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  description: z.string().trim().min(2).max(2000),
});

mayorRoutes.post("/places", async (c) => {
  const b = await body(c, placeSchema.extend({ adminId: z.string().nullable().optional() }));
  const { adminId, ...fields } = b;
  const place = await Place.create(fields);
  await logActivity("admin", `New place "${place.name}" was added`);
  if (adminId) await assignAdmin(adminId, place.id);
  return c.json({ id: place.id }, 201);
});

mayorRoutes.patch("/places/:id", async (c) => {
  const b = await body(c, placeSchema.omit({ kind: true }).partial());
  const place = await Place.findByPk(c.req.param("id"));
  if (!place) throw new HttpError(404, "Place not found");
  await place.update(b);
  return c.json({ ok: true });
});

mayorRoutes.delete("/places/:id", async (c) => {
  const place = await Place.findByPk(c.req.param("id"));
  if (!place) throw new HttpError(404, "Place not found");
  if (await User.count({ where: { role: "user", placeId: place.id } })) {
    throw new HttpError(409, "This place still has residents. Remove or move them before deleting it.", "has_residents");
  }
  await sequelize.transaction(async (t) => {
    await User.update({ placeId: null }, { where: { role: "admin", placeId: place.id }, transaction: t });
    await Rule.destroy({ where: { placeId: place.id }, transaction: t });
    await Notice.destroy({ where: { placeId: place.id }, transaction: t });
    await PlaceReport.destroy({ where: { placeId: place.id }, transaction: t });
    await place.destroy({ transaction: t });
  });
  await logActivity("admin", `Place "${place.name}" was removed`);
  return c.json({ ok: true });
});

const policySchema = z.object({
  title: z.string().trim().min(2).max(190),
  category: z.string().trim().min(1).max(40),
  severity: z.enum(["info", "important", "critical"]),
  summary: z.string().trim().min(2).max(1000),
  content: z.string().trim().min(2).max(10000),
  published: z.boolean(),
});

mayorRoutes.post("/policies", async (c) => {
  const b = await body(c, policySchema);
  const p = await Policy.create(b);
  await logActivity("policy", `Safety policy "${p.title}" was ${p.published ? "published" : "saved as draft"}`);
  return c.json({ id: p.id }, 201);
});

mayorRoutes.patch("/policies/:id", async (c) => {
  const b = await body(c, policySchema.partial());
  const p = await Policy.findByPk(c.req.param("id"));
  if (!p) throw new HttpError(404, "Policy not found");
  await p.update(b);
  return c.json({ ok: true });
});

mayorRoutes.delete("/policies/:id", async (c) => {
  const n = await Policy.destroy({ where: { id: c.req.param("id") } });
  if (!n) throw new HttpError(404, "Policy not found");
  return c.json({ ok: true });
});

const image = z.string().max(4_000_000).nullable().optional();

mayorRoutes.post("/donations", async (c) => {
  const b = await body(
    c,
    z.object({
      title: z.string().trim().min(2).max(190),
      category: z.string().trim().min(1).max(80),
      description: z.string().trim().min(2).max(4000),
      goal: z.number().positive().max(1_000_000_000),
      deadline: z.string().refine((d) => !Number.isNaN(Date.parse(d)), "Enter a valid date").max(40),
      image,
    }),
  );
  const { image: img, ...fields } = b;
  const d = await Donation.create({ ...fields, cover: coverFor(b.category) });
  if (img) await saveDonationImage(d, img);
  await logActivity("donation", `Donation post "${d.title}" was published`);
  return c.json({ id: d.id }, 201);
});

mayorRoutes.patch("/donations/:id", async (c) => {
  const b = await body(
    c,
    z
      .object({
        title: z.string().trim().min(2).max(190),
        category: z.string().trim().min(1).max(80),
        description: z.string().trim().min(2).max(4000),
        goal: z.number().positive().max(1_000_000_000),
        deadline: z.string().refine((d) => !Number.isNaN(Date.parse(d)), "Enter a valid date").max(40),
        status: z.enum(["active", "closed"]),
        image,
      })
      .partial(),
  );
  const d = await Donation.findByPk(c.req.param("id"));
  if (!d) throw new HttpError(404, "Donation not found");
  const { image: img, ...fields } = b;
  if (fields.category) (fields as Record<string, unknown>).cover = coverFor(fields.category);
  await d.update(fields);
  if (img !== undefined) await saveDonationImage(d, img);
  return c.json({ ok: true });
});

mayorRoutes.post("/announcements", async (c) => {
  const b = await body(c, z.object({ title: z.string().trim().min(2).max(190), body: z.string().trim().min(2).max(5000), pinned: z.boolean().optional() }));
  const mayor = me(c);
  const n = await Notice.create({
    placeId: null,
    audience: "public",
    title: b.title,
    body: b.body,
    pinned: !!b.pinned,
    authorId: mayor.id,
    authorKind: "mayor",
    authorName: mayor.name,
  });
  await logActivity("announcement", `Public announcement "${n.title}" was published`);
  return c.json({ id: n.id }, 201);
});

mayorRoutes.delete("/announcements/:id", async (c) => {
  const n = await Notice.destroy({ where: { id: c.req.param("id"), authorKind: "mayor" } });
  if (!n) throw new HttpError(404, "Announcement not found");
  return c.json({ ok: true });
});

async function publicComplaint(id: string) {
  const c = await Complaint.findOne({ where: { id, kind: "public" } });
  if (!c) throw new HttpError(404, "Complaint not found");
  return c;
}

mayorRoutes.post("/complaints/:id/reply", async (c) => {
  const b = await body(c, z.object({ text: z.string().trim().min(1).max(4000) }));
  const cmp = await publicComplaint(c.req.param("id"));
  await ComplaintMessage.create({ complaintId: cmp.id, from: "staff", text: b.text });
  cmp.staffUnread = false;
  cmp.userUnread = true;
  if (cmp.status === "new") cmp.status = "in_review";
  cmp.changed("updatedAt", true);
  await cmp.save();
  return c.json({ ok: true });
});

mayorRoutes.post("/complaints/:id/status", async (c) => {
  const b = await body(c, z.object({ status: z.enum(["new", "in_review", "resolved", "rejected"]) }));
  const cmp = await publicComplaint(c.req.param("id"));
  cmp.status = b.status;
  cmp.staffUnread = false;
  cmp.userUnread = true;
  await cmp.save();
  return c.json({ ok: true });
});

mayorRoutes.post("/complaints/:id/read", async (c) => {
  const cmp = await publicComplaint(c.req.param("id"));
  if (cmp.staffUnread) {
    await cmp.update({ staffUnread: false }, { silent: true });
  }
  return c.json({ ok: true });
});

mayorRoutes.patch("/profile", async (c) => {
  const b = await body(c, z.object({ phone: phone.optional(), office: z.string().trim().max(190).optional() }));
  const u = me(c);
  await u.update(b);
  return c.json({ ok: true });
});

mayorRoutes.put("/profile/photo", async (c) => {
  const b = await body(c, z.object({ photo: z.string().nullable() }));
  await savePhoto(me(c), b.photo);
  return c.json({ ok: true });
});
