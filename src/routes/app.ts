import { Hono } from "hono";
import { z } from "zod";
import { Op } from "sequelize";
import { me, requireAuth, type Env } from "../auth";
import { sequelize } from "../db";
import { HttpError, body, norm } from "../http";
import { savePhoto } from "../media";
import { modIntro, modWarning, moderate } from "../moderation";
import {
  Complaint,
  ComplaintMessage,
  Donation,
  GameScore,
  Notice,
  NoticeSeen,
  Place,
  PlaceReport,
  Pledge,
  Policy,
  Report,
  ReportMessage,
  Rule,
  User,
} from "../models";
import {
  appAccount,
  appComplaint,
  appDonation,
  appNotice,
  appPlace,
  appPlaceReport,
  appPolicy,
  appReport,
  cityInfo,
  leaderboard,
  loadRules,
  logActivity,
  messagesFor,
  originOf,
  pledgedFor,
  seenFor,
} from "../serialize";

export const appRoutes = new Hono<Env>();
appRoutes.use("*", requireAuth("admin", "user"));

const CATEGORIES = ["noise", "parking", "pets", "waste", "safety", "access", "facilities", "general"] as const;
const category = z.enum(CATEGORIES);

function needAdminPlace(u: User) {
  if (u.role !== "admin" || !u.placeId) throw new HttpError(403, "You are not assigned to a place yet", "forbidden");
  return u.placeId;
}
const onlyUser = (u: User) => {
  if (u.role !== "user") throw new HttpError(403, "Only residents can do this", "forbidden");
  return u;
};

appRoutes.get("/sync", async (c) => {
  const origin = originOf(c);
  const u = me(c);
  const isAdmin = u.role === "admin";
  const placeId = u.placeId;

  const [places, rules, policies, donations, placeReports] = await Promise.all([
    Place.findAll({ order: [["name", "ASC"]] }),
    loadRules(),
    Policy.findAll({ where: { published: true }, order: [["createdAt", "DESC"]] }),
    Donation.findAll({ order: [["createdAt", "DESC"]] }),
    PlaceReport.findAll({ order: [["createdAt", "DESC"]], limit: 300 }),
  ]);

  const noticeWhere = placeId
    ? { [Op.or]: [{ audience: "public" }, { placeId }] }
    : { audience: "public" };
  const notices = await Notice.findAll({ where: noticeWhere, order: [["createdAt", "DESC"]], limit: 500 });

  const complaints = await Complaint.findAll({
    where: isAdmin
      ? { placeId: placeId ?? "-", kind: { [Op.in]: ["private", "place"] } }
      : { fromId: u.id },
    order: [["updatedAt", "DESC"]],
    limit: 500,
  });
  const complaintMsgs = await messagesFor<ComplaintMessage>(ComplaintMessage, "complaintId", complaints.map((x) => x.id));

  const reports = isAdmin || !placeId ? [] : await Report.findAll({ where: { placeId }, order: [["updatedAt", "DESC"]], limit: 200 });
  const reportMsgs = await messagesFor<ReportMessage>(ReportMessage, "reportId", reports.map((x) => x.id));

  const neighbours = placeId
    ? await User.findAll({ where: { role: "user", placeId }, order: [["name", "ASC"]] })
    : [];
  const wanted = new Set<string>([u.id, ...neighbours.map((n) => n.id)]);
  for (const x of complaints) wanted.add(x.fromId);
  for (const x of placeReports) wanted.add(x.fromId);
  for (const x of reports) for (const m of reportMsgs.get(x.id) ?? []) if (m.fromId !== "mod") wanted.add(m.fromId);
  const extra = [...wanted].filter((id) => !neighbours.some((n) => n.id === id) && id !== u.id);
  const others = extra.length ? await User.findAll({ where: { id: { [Op.in]: extra } } }) : [];
  const accounts = [
    appAccount(u, origin, true),
    ...neighbours.filter((n) => n.id !== u.id).map((n) => appAccount(n, origin, isAdmin)),
    ...others.map((n) => appAccount(n, origin, false)),
  ];

  const [seen, pledged, board] = await Promise.all([seenFor(u.id), pledgedFor(u.id), leaderboard(u.id)]);
  const mine = board.find((b) => b.me);
  const own = await GameScore.findByPk(u.id);

  return c.json({
    city: cityInfo(),
    sessionId: u.id,
    accounts,
    places: places.map((p) => appPlace(p, rules)),
    notices: notices.map(appNotice),
    complaints: complaints.map((x) => appComplaint(x, complaintMsgs.get(x.id) ?? [], placeId ?? "")),
    reports: reports.map((x) => appReport(x, reportMsgs.get(x.id) ?? [], u.id)),
    placeReports: placeReports.map(appPlaceReport),
    donations: donations.map((d) => appDonation(d, origin)),
    policies: policies.map(appPolicy),
    seen: seen.map((id) => `${u.id}:${id}`),
    pledged: Object.fromEntries(Object.entries(pledged).map(([k, v]) => [`${u.id}:${k}`, v])),
    board,
    myBest: own?.best ?? mine?.score ?? 0,
    myNick: own?.nick ?? "",
  });
});

appRoutes.patch("/profile", async (c) => {
  const u = me(c);
  const b = await body(
    c,
    z.object({
      name: z.string().trim().min(2).max(120).optional(),
      phone: z.string().trim().min(6).max(40).optional(),
      gender: z.enum(["Female", "Male"]).optional(),
      email: z.string().trim().toLowerCase().email().optional(),
    }),
  );
  if (b.email && norm(b.email) !== norm(u.email)) {
    if (u.role !== "admin") throw new HttpError(403, "Your email cannot be changed", "forbidden");
    if (await User.findOne({ where: { email: b.email, id: { [Op.ne]: u.id } } })) throw new HttpError(409, "That email is already used by another account", "email_taken");
  }
  if (u.role === "admin") delete b.name;
  await u.update(b);
  return c.json({ ok: true });
});

appRoutes.put("/profile/photo", async (c) => {
  const b = await body(c, z.object({ photo: z.string().nullable() }));
  await savePhoto(me(c), b.photo);
  return c.json({ ok: true });
});

appRoutes.post("/notices", async (c) => {
  const u = me(c);
  const placeId = needAdminPlace(u);
  const b = await body(c, z.object({ title: z.string().trim().min(2).max(190), body: z.string().trim().min(2).max(5000), pinned: z.boolean().default(false) }));
  const place = await Place.findByPk(placeId);
  if (!place) throw new HttpError(404, "Place not found");
  const n = await Notice.create({
    placeId,
    audience: place.kind === "residential" ? "private" : "public",
    title: b.title,
    body: b.body,
    pinned: b.pinned,
    authorId: u.id,
    authorKind: "admin",
    authorName: u.name,
  });
  return c.json({ id: n.id }, 201);
});

async function ownNotice(c: Parameters<typeof me>[0], id: string) {
  const placeId = needAdminPlace(me(c));
  const n = await Notice.findOne({ where: { id, placeId } });
  if (!n) throw new HttpError(404, "Notice not found");
  return n;
}

appRoutes.patch("/notices/:id", async (c) => {
  const b = await body(c, z.object({ title: z.string().trim().min(2).max(190), body: z.string().trim().min(2).max(5000), pinned: z.boolean() }).partial());
  const n = await ownNotice(c, c.req.param("id"));
  await n.update(b);
  return c.json({ ok: true });
});

appRoutes.delete("/notices/:id", async (c) => {
  const n = await ownNotice(c, c.req.param("id"));
  await NoticeSeen.destroy({ where: { noticeId: n.id } });
  await n.destroy();
  return c.json({ ok: true });
});

appRoutes.post("/notices/:id/seen", async (c) => {
  const u = me(c);
  const n = await Notice.findByPk(c.req.param("id"));
  if (!n) throw new HttpError(404, "Notice not found");
  const [, created] = await NoticeSeen.findOrCreate({ where: { userId: u.id, noticeId: n.id } });
  if (created) await n.increment("views");
  return c.json({ ok: true });
});

const ruleType = z.enum(["residents", "visitors"]);

async function ruleScope(c: Parameters<typeof me>[0], type: "residents" | "visitors") {
  const placeId = needAdminPlace(me(c));
  const place = await Place.findByPk(placeId);
  if (!place) throw new HttpError(404, "Place not found");
  if (place.kind === "non-residential" && type === "residents") throw new HttpError(422, "This place only has visitor rules", "validation");
  return placeId;
}

appRoutes.post("/rules", async (c) => {
  const b = await body(c, z.object({ type: ruleType, title: z.string().trim().min(2).max(190), text: z.string().trim().min(2).max(2000), category }));
  const placeId = await ruleScope(c, b.type);
  const last = await Rule.max<number, Rule>("position", { where: { placeId, type: b.type } });
  const r = await Rule.create({ placeId, type: b.type, title: b.title, text: b.text, category: b.category, position: (last ?? -1) + 1 });
  return c.json({ id: r.id }, 201);
});

async function ownRule(c: Parameters<typeof me>[0], id: string) {
  const placeId = needAdminPlace(me(c));
  const r = await Rule.findOne({ where: { id, placeId } });
  if (!r) throw new HttpError(404, "Rule not found");
  return r;
}

appRoutes.patch("/rules/:id", async (c) => {
  const b = await body(c, z.object({ title: z.string().trim().min(2).max(190), text: z.string().trim().min(2).max(2000), category }).partial());
  const r = await ownRule(c, c.req.param("id"));
  await r.update(b);
  return c.json({ ok: true });
});

appRoutes.delete("/rules/:id", async (c) => {
  const r = await ownRule(c, c.req.param("id"));
  await r.destroy();
  return c.json({ ok: true });
});

appRoutes.post("/rules/:id/move", async (c) => {
  const b = await body(c, z.object({ dir: z.union([z.literal(-1), z.literal(1)]) }));
  const r = await ownRule(c, c.req.param("id"));
  await sequelize.transaction(async (t) => {
    const list = await Rule.findAll({ where: { placeId: r.placeId, type: r.type }, order: [["position", "ASC"], ["createdAt", "ASC"]], transaction: t });
    const i = list.findIndex((x) => x.id === r.id);
    const j = i + b.dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    for (let k = 0; k < list.length; k++) await list[k].update({ position: k }, { transaction: t, silent: true });
  });
  return c.json({ ok: true });
});

async function complaintFor(u: User, id: string) {
  const cmp = await Complaint.findByPk(id);
  if (!cmp) throw new HttpError(404, "Complaint not found");
  if (u.role === "admin") {
    if (cmp.kind === "public" || !u.placeId || cmp.placeId !== u.placeId) throw new HttpError(403, "Not your complaint to manage", "forbidden");
  } else if (cmp.fromId !== u.id) {
    throw new HttpError(403, "Not your complaint", "forbidden");
  }
  return cmp;
}

appRoutes.post("/complaints", async (c) => {
  const u = onlyUser(me(c));
  const b = await body(
    c,
    z.object({
      kind: z.enum(["private", "place", "public"]),
      placeId: z.string().min(1),
      subject: z.string().trim().min(4).max(190),
      category: z.string().trim().min(1).max(80),
      priority: z.enum(["low", "medium", "high"]),
      body: z.string().trim().min(5).max(4000),
    }),
  );
  let placeId: string | null = b.placeId;
  if (b.kind === "private") placeId = u.placeId;
  if (b.kind === "public") placeId = u.placeId;
  if (b.kind === "place" && !(await Place.findByPk(b.placeId))) throw new HttpError(404, "Place not found");
  const cmp = await Complaint.create({ placeId, kind: b.kind, subject: b.subject, category: b.category, priority: b.priority, fromId: u.id });
  await ComplaintMessage.create({ complaintId: cmp.id, from: "user", text: b.body });
  if (b.kind === "public") await logActivity("complaint", `New public complaint: ${b.subject}`);
  return c.json({ id: cmp.id }, 201);
});

appRoutes.post("/complaints/:id/reply", async (c) => {
  const u = me(c);
  const b = await body(c, z.object({ text: z.string().trim().min(1).max(4000) }));
  const cmp = await complaintFor(u, c.req.param("id"));
  const staff = u.role === "admin";
  await ComplaintMessage.create({ complaintId: cmp.id, from: staff ? "staff" : "user", text: b.text });
  if (staff) {
    cmp.staffUnread = false;
    cmp.userUnread = true;
    if (cmp.status === "new") cmp.status = "in_review";
  } else {
    cmp.staffUnread = true;
    if (cmp.status === "resolved") cmp.status = "in_review";
  }
  cmp.changed("updatedAt", true);
  await cmp.save();
  return c.json({ ok: true });
});

appRoutes.post("/complaints/:id/status", async (c) => {
  const u = me(c);
  if (u.role !== "admin") throw new HttpError(403, "Only admins can change a status", "forbidden");
  const b = await body(c, z.object({ status: z.enum(["new", "in_review", "resolved"]) }));
  const cmp = await complaintFor(u, c.req.param("id"));
  cmp.status = b.status;
  cmp.staffUnread = false;
  cmp.userUnread = true;
  await cmp.save();
  return c.json({ ok: true });
});

appRoutes.post("/complaints/:id/read", async (c) => {
  const u = me(c);
  const cmp = await complaintFor(u, c.req.param("id"));
  if (u.role === "admin") await cmp.update({ staffUnread: false }, { silent: true });
  else await cmp.update({ userUnread: false }, { silent: true });
  return c.json({ ok: true });
});

appRoutes.post("/place-reports", async (c) => {
  const u = onlyUser(me(c));
  const b = await body(c, z.object({ placeId: z.string().min(1), category, subject: z.string().trim().min(4).max(190), details: z.string().trim().min(10).max(4000) }));
  if (!(await Place.findByPk(b.placeId))) throw new HttpError(404, "Place not found");
  const r = await PlaceReport.create({ ...b, fromId: u.id });
  return c.json({ id: r.id }, 201);
});

appRoutes.delete("/place-reports/:id", async (c) => {
  const u = me(c);
  const n = await PlaceReport.destroy({ where: { id: c.req.param("id"), fromId: u.id } });
  if (!n) throw new HttpError(404, "Report not found");
  return c.json({ ok: true });
});

async function reportFor(u: User, id: string) {
  const r = await Report.findByPk(id);
  if (!r || u.role !== "user" || r.placeId !== u.placeId) throw new HttpError(404, "Chat not found");
  return r;
}

async function residentIds(placeId: string) {
  return (await User.findAll({ where: { role: "user", placeId }, attributes: ["id"] })).map((x) => x.id);
}

async function postReportMessage(r: Report, fromId: string, text: string, flagged = false) {
  await ReportMessage.create({ reportId: r.id, fromId, text, flagged });
  r.changed("updatedAt", true);
}

async function escalateReport(r: Report, u: User, reason: string) {
  const msgs = await ReportMessage.findAll({ where: { reportId: r.id, flagged: false, fromId: { [Op.ne]: "mod" } }, order: [["createdAt", "ASC"]] });
  const names = new Map((await User.findAll({ where: { id: { [Op.in]: [...new Set(msgs.map((m) => m.fromId))] } }, attributes: ["id", "name"] })).map((x) => [x.id, x.name]));
  const lines = msgs.map((m) => `${names.get(m.fromId) ?? "Neighbor"}: ${m.text}`);
  const cmp = await Complaint.create({
    placeId: r.placeId,
    kind: "private",
    subject: `Neighbor dispute: ${r.subject}`,
    category: r.category,
    priority: "medium",
    fromId: u.id,
  });
  await ComplaintMessage.create({ complaintId: cmp.id, from: "user", text: `${reason}\n\nChat with neighbors:\n${lines.join("\n")}` });
  r.status = "escalated";
  await postReportMessage(
    r,
    "mod",
    "I've sent this chat to your residence admin. They'll take it from here. You'll find their reply under Help › Complaints.",
  );
}

appRoutes.post("/reports", async (c) => {
  const u = onlyUser(me(c));
  if (!u.placeId) throw new HttpError(422, "You are not registered to a residence", "validation");
  const b = await body(c, z.object({ category, subject: z.string().trim().min(4).max(190), details: z.string().trim().min(10).max(4000) }));
  const rule = await Rule.findOne({ where: { placeId: u.placeId, type: "residents", category: b.category }, order: [["position", "ASC"]] });
  const r = await Report.create({ placeId: u.placeId, fromId: u.id, againstId: "all", category: b.category, subject: b.subject, unreadFor: (await residentIds(u.placeId)).filter((id) => id !== u.id) });
  const first = u.name.split(" ")[0];
  await ReportMessage.create({ reportId: r.id, fromId: "mod", text: modIntro(first, b.subject, rule ? `“${rule.title}”. ${rule.text}` : undefined) });
  await ReportMessage.create({ reportId: r.id, fromId: u.id, text: b.details, createdAt: new Date(Date.now() + 1000) });
  return c.json({ id: r.id }, 201);
});

appRoutes.post("/reports/:id/messages", async (c) => {
  const u = me(c);
  const b = await body(c, z.object({ text: z.string().trim().min(1).max(2000) }));
  const r = await reportFor(u, c.req.param("id"));
  if (r.status !== "open") throw new HttpError(409, "This chat is closed", "closed");
  const verdict = moderate(b.text);
  if (!verdict.ok && verdict.flag) {
    r.strikes += 1;
    await postReportMessage(r, u.id, b.text, true);
    await postReportMessage(r, "mod", modWarning(verdict.flag, r.strikes - 1));
    if (r.strikes >= 3) await escalateReport(r, u, "Sent automatically after repeated heated messages.");
    await r.save();
    return c.json({ flagged: true });
  }
  await postReportMessage(r, u.id, b.text);
  r.unreadFor = (await residentIds(r.placeId)).filter((id) => id !== u.id);
  await r.save();
  return c.json({ flagged: false });
});

appRoutes.post("/reports/:id/resolve", async (c) => {
  const u = me(c);
  const r = await reportFor(u, c.req.param("id"));
  if (r.status !== "open") throw new HttpError(409, "This chat is closed", "closed");
  r.status = "resolved";
  await postReportMessage(r, "mod", "Wonderful. Thank you all for working it out calmly. I'm closing this chat.");
  await r.save();
  return c.json({ ok: true });
});

appRoutes.post("/reports/:id/escalate", async (c) => {
  const u = me(c);
  const r = await reportFor(u, c.req.param("id"));
  if (r.status !== "open") throw new HttpError(409, "This chat is closed", "closed");
  await escalateReport(r, u, "I'd like my admin's help with this.");
  await r.save();
  return c.json({ ok: true });
});

appRoutes.post("/reports/:id/read", async (c) => {
  const u = me(c);
  const r = await reportFor(u, c.req.param("id"));
  const list = r.unreadFor ?? [];
  if (list.includes(u.id)) await r.update({ unreadFor: list.filter((x) => x !== u.id) }, { silent: true });
  return c.json({ ok: true });
});

appRoutes.post("/donations/:id/pledge", async (c) => {
  const u = onlyUser(me(c));
  const b = await body(c, z.object({ amount: z.number().positive().max(1_000_000) }));
  await sequelize.transaction(async (t) => {
    const d = await Donation.findByPk(c.req.param("id"), { transaction: t, lock: t.LOCK.UPDATE });
    if (!d) throw new HttpError(404, "Campaign not found");
    if (d.status !== "active") throw new HttpError(409, "This campaign is closed", "closed");
    const first = !(await Pledge.count({ where: { donationId: d.id, userId: u.id }, transaction: t }));
    await Pledge.create({ donationId: d.id, userId: u.id, amount: b.amount }, { transaction: t });
    d.raised += b.amount;
    if (first) d.donors += 1;
    await d.save({ transaction: t });
  });
  return c.json({ ok: true });
});

appRoutes.put("/game/nick", async (c) => {
  const u = onlyUser(me(c));
  const b = await body(c, z.object({ nick: z.string() }));
  const nick = b.nick.trim().replace(/\s+/g, " ");
  if (nick.length < 2) throw new HttpError(422, "Use at least 2 characters.", "validation");
  if (nick.length > 14) throw new HttpError(422, "Keep it to 14 characters or less.", "validation");
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]*$/.test(nick)) throw new HttpError(422, "Letters, numbers, spaces, _ . - only.", "validation");
  if (!moderate(nick).ok) throw new HttpError(422, "Please choose a friendlier nickname.", "validation");
  const clash = await GameScore.findOne({ where: { nick, userId: { [Op.ne]: u.id } } });
  if (clash) throw new HttpError(409, "Someone already has that nickname.", "nick_taken");
  const row = await GameScore.findByPk(u.id);
  if (row) await row.update({ nick });
  else await GameScore.create({ userId: u.id, nick, best: 0 });
  return c.json({ ok: true });
});

appRoutes.post("/game/score", async (c) => {
  const u = onlyUser(me(c));
  const b = await body(c, z.object({ score: z.number().int().min(0).max(5000) }));
  const row = await GameScore.findByPk(u.id);
  if (!row) throw new HttpError(409, "Choose a nickname first", "no_nick");
  if (b.score > row.best) await row.update({ best: b.score });
  return c.json({ best: Math.max(row.best, b.score) });
});
