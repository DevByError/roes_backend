import type { Context } from "hono";
import { Op } from "sequelize";
import {
  Activity,
  Complaint,
  ComplaintMessage,
  Donation,
  GameScore,
  Notice,
  NoticeSeen,
  Pledge,
  Place,
  PlaceReport,
  Policy,
  Report,
  ReportMessage,
  Rule,
  User,
} from "./models";
import { iso } from "./http";
import { config } from "./config";

export const originOf = (c: Context) => {
  const proto = c.req.header("x-forwarded-proto");
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host");
  if (host) return `${proto ?? new URL(c.req.url).protocol.replace(":", "")}://${host}`;
  return new URL(c.req.url).origin;
};

export const userPhoto = (origin: string, u: User) => (u.photo ? `${origin}/api/media/users/${u.id}?v=${u.photoVersion}` : undefined);
export const donationImage = (origin: string, d: Donation) => (d.image ? `${origin}/api/media/donations/${d.id}?v=${d.imageVersion}` : undefined);

export const cityInfo = () => ({
  name: process.env.CITY_NAME || config.MAYOR_CITY || "",
  country: process.env.CITY_COUNTRY || "",
  population: Number(process.env.CITY_POPULATION || 0),
  areaKm2: Number(process.env.CITY_AREA_KM2 || 0),
  districts: Number(process.env.CITY_DISTRICTS || 0),
  center: [Number(process.env.CITY_LAT || 3.1478), Number(process.env.CITY_LNG || 101.6953)] as [number, number],
});

const COVERS = ["flood", "school", "kitchen", "hospital"] as const;
export const coverFor = (category: string): (typeof COVERS)[number] => {
  const c = category.toLowerCase();
  if (/flood|disaster|relief|emergency/.test(c)) return "flood";
  if (/school|educat|child|youth/.test(c)) return "school";
  if (/food|kitchen|hunger|meal/.test(c)) return "kitchen";
  if (/health|hospital|medical|clinic/.test(c)) return "hospital";
  let h = 0;
  for (const ch of category) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COVERS[h % COVERS.length];
};

const toneOf = (id: string) => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 4;
};

export type RulesByPlace = Map<string, { residents: Rule[]; visitors: Rule[] }>;

export async function loadRules(): Promise<RulesByPlace> {
  const rules = await Rule.findAll({ order: [["position", "ASC"], ["createdAt", "ASC"]] });
  const map: RulesByPlace = new Map();
  for (const r of rules) {
    const e = map.get(r.placeId) ?? { residents: [], visitors: [] };
    e[r.type].push(r);
    map.set(r.placeId, e);
  }
  return map;
}

export async function adminByPlace() {
  const admins = await User.findAll({ where: { role: "admin", placeId: { [Op.ne]: null } } });
  return new Map(admins.map((a) => [a.placeId as string, a]));
}

export async function logActivity(kind: Activity["kind"], text: string) {
  await Activity.create({ kind, text });
}

const ruleDto = (r: Rule) => ({ id: r.id, title: r.title, text: r.text, category: r.category, updatedAt: iso(r.updatedAt)! });

export function appPlace(p: Place, rules: RulesByPlace) {
  const r = rules.get(p.id) ?? { residents: [], visitors: [] };
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    category: p.category,
    district: p.district,
    address: p.address,
    description: p.description,
    lat: p.lat,
    lng: p.lng,
    rules: { residents: r.residents.map(ruleDto), visitors: r.visitors.map(ruleDto) },
  };
}

export function webPlace(p: Place, rules: RulesByPlace, admins: Map<string, User>) {
  const r = rules.get(p.id) ?? { residents: [], visitors: [] };
  const plain = (x: Rule) => ({ id: x.id, title: x.title, text: x.text });
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    category: p.category,
    district: p.district,
    address: p.address,
    lat: p.lat,
    lng: p.lng,
    adminId: admins.get(p.id)?.id ?? null,
    description: p.description,
    houseRules: { residents: r.residents.map(plain), visitors: r.visitors.map(plain) },
    createdAt: iso(p.createdAt)!,
  };
}

export function webAdmin(u: User) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    nationalId: u.nationalId,
    gender: u.gender,
    placeId: u.placeId,
    status: u.status,
    frozenReason: u.frozenReason ?? undefined,
    frozenAt: iso(u.frozenAt),
    promotedFromUserId: u.promoted ? u.id : undefined,
    createdAt: iso(u.createdAt)!,
    lastActiveAt: iso(u.lastActiveAt)!,
    photo: undefined as string | undefined,
  };
}

export function webUser(u: User, reportsCount: number) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    nationalId: u.nationalId,
    gender: u.gender,
    placeId: (u.role === "admin" ? u.residenceId : u.placeId) ?? "",
    unit: u.unit,
    status: u.status === "frozen" ? "frozen" : "verified",
    role: u.role === "admin" ? "admin" : "user",
    joinedAt: iso(u.createdAt)!,
    lastActiveAt: iso(u.lastActiveAt)!,
    reportsCount,
  };
}

export function webMayor(u: User, origin: string) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    nationalId: u.nationalId,
    city: u.city,
    office: u.office,
    photo: userPhoto(origin, u),
  };
}

export function webNotice(n: Notice) {
  return {
    id: n.id,
    title: n.title,
    body: n.body,
    audience: n.audience,
    author: { kind: n.authorKind, name: n.authorName },
    placeId: n.placeId,
    createdAt: iso(n.createdAt)!,
    views: n.views,
    pinned: n.pinned || undefined,
  };
}

export const webPolicy = (p: Policy) => ({
  id: p.id,
  title: p.title,
  category: p.category,
  severity: p.severity,
  summary: p.summary,
  content: p.content,
  published: p.published,
  createdAt: iso(p.createdAt)!,
  updatedAt: iso(p.updatedAt)!,
});

export const webDonation = (d: Donation, origin: string) => ({
  id: d.id,
  title: d.title,
  category: d.category,
  description: d.description,
  goal: d.goal,
  raised: d.raised,
  donors: d.donors,
  deadline: d.deadline,
  status: d.status,
  tone: toneOf(d.id),
  image: donationImage(origin, d),
  createdAt: iso(d.createdAt)!,
});

export const appDonation = (d: Donation, origin: string) => ({
  id: d.id,
  title: d.title,
  category: d.category,
  description: d.description,
  goal: d.goal,
  raised: d.raised,
  donors: d.donors,
  deadline: d.deadline,
  status: d.status,
  cover: d.cover,
  image: donationImage(origin, d),
});

export const appPolicy = (p: Policy) => ({
  id: p.id,
  title: p.title,
  category: p.category,
  severity: p.severity,
  summary: p.summary,
  body: p.content,
});

export function webComplaint(c: Complaint, msgs: ComplaintMessage[]) {
  return {
    id: c.id,
    subject: c.subject,
    category: c.category,
    priority: c.priority,
    status: c.status,
    userId: c.fromId,
    createdAt: iso(c.createdAt)!,
    updatedAt: iso(c.updatedAt)!,
    unread: c.staffUnread,
    messages: msgs.map((m) => ({ id: m.id, from: m.from === "staff" ? "mayor" : "user", text: m.text, at: iso(m.createdAt)! })),
  };
}

export function appComplaint(c: Complaint, msgs: ComplaintMessage[], residence: string) {
  return {
    id: c.id,
    placeId: c.placeId ?? residence,
    kind: c.kind,
    subject: c.subject,
    category: c.category,
    priority: c.priority,
    status: c.status === "rejected" ? "resolved" : c.status,
    fromId: c.fromId,
    createdAt: iso(c.createdAt)!,
    unread: c.staffUnread,
    userUnread: c.userUnread,
    messages: msgs.map((m) => ({ id: m.id, from: m.from === "staff" ? "admin" : "user", text: m.text, at: iso(m.createdAt)! })),
  };
}

export function appNotice(n: Notice) {
  return {
    id: n.id,
    placeId: n.placeId ?? "city",
    audience: n.audience,
    title: n.title,
    body: n.body,
    pinned: n.pinned,
    createdAt: iso(n.createdAt)!,
    authorId: n.authorId,
  };
}

export function appReport(r: Report, msgs: ReportMessage[], viewerId: string) {
  return {
    id: r.id,
    placeId: r.placeId,
    fromId: r.fromId,
    againstId: r.againstId,
    category: r.category,
    subject: r.subject,
    status: r.status,
    strikes: r.strikes,
    createdAt: iso(r.createdAt)!,
    unread: (r.unreadFor ?? []).includes(viewerId),
    messages: msgs.map((m) => ({ id: m.id, from: m.fromId, text: m.text, at: iso(m.createdAt)!, flagged: m.flagged || undefined })),
  };
}

export const appPlaceReport = (r: PlaceReport) => ({
  id: r.id,
  placeId: r.placeId,
  fromId: r.fromId,
  category: r.category,
  subject: r.subject,
  details: r.details,
  createdAt: iso(r.createdAt)!,
});

export function appAccount(u: User, origin: string, full: boolean) {
  return {
    id: u.id,
    role: u.role === "mayor" ? "admin" : u.role,
    name: u.name,
    email: full ? u.email : "",
    phone: full ? u.phone : "",
    gender: u.gender,
    photo: userPhoto(origin, u),
    status: u.status,
    placeId: u.placeId,
    unit: u.unit || undefined,
    joinedAt: iso(u.createdAt)!,
    lastActiveAt: iso(u.lastActiveAt)!,
  };
}

export async function messagesFor<T extends { complaintId?: string; reportId?: string }>(model: any, key: "complaintId" | "reportId", ids: string[]) {
  const map = new Map<string, T[]>();
  if (!ids.length) return map;
  const rows: T[] = await model.findAll({ where: { [key]: { [Op.in]: ids } }, order: [["createdAt", "ASC"]] });
  for (const r of rows) {
    const k = (r as any)[key] as string;
    const arr = map.get(k) ?? [];
    arr.push(r);
    map.set(k, arr);
  }
  return map;
}

export async function leaderboard(viewerId: string) {
  const [scores, users] = await Promise.all([
    GameScore.findAll({ where: { best: { [Op.gt]: 0 } }, order: [["best", "DESC"], ["nick", "ASC"]], limit: 200 }),
    User.findAll({ attributes: ["id", "placeId"] }),
  ]);
  const place = new Map(users.map((u) => [u.id, u.placeId]));
  return scores.map((s) => ({ id: s.userId, nick: s.nick, score: s.best, placeId: place.get(s.userId) ?? null, me: s.userId === viewerId }));
}

export async function seenFor(userId: string) {
  return (await NoticeSeen.findAll({ where: { userId } })).map((s) => s.noticeId);
}

export async function pledgedFor(userId: string) {
  const rows = await Pledge.findAll({ where: { userId } });
  const out: Record<string, number> = {};
  for (const p of rows) out[p.donationId] = (out[p.donationId] ?? 0) + p.amount;
  return out;
}
