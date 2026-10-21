import { beforeAll, describe, expect, test } from "bun:test";
import { app } from "../src/app";
import { sequelize } from "../src/db";
import { ensureMayor } from "../src/bootstrap";
import { outbox } from "../src/mailer";
import "../src/models";

type Json = any;

async function call(method: string, path: string, token?: string, payload?: unknown): Promise<{ status: number; data: Json }> {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const lastCode = (to: string) => {
  const m = [...outbox].reverse().find((x) => x.to === to);
  return /(\d{6})/.exec(m?.text ?? "")?.[1] ?? "";
};

async function registerUser(email: string, name: string, placeId: string, unit = "A-1-1") {
  await call("POST", "/auth/code", undefined, { email, purpose: "register" });
  const code = lastCode(email);
  const r = await call("POST", "/auth/register", undefined, { name, email, phone: "+60 12-345 6789", password: "Resident1", gender: "Female", placeId, unit, code });
  expect(r.status).toBe(201);
  return r.data.token as string;
}

let mayor = "";
let home = "";
let mall = "";
let adminHome = "";
let adminMall = "";
let alice = "";
let bob = "";
let aliceId = "";
let bobId = "";

beforeAll(async () => {
  await sequelize.sync({ force: true });
  await ensureMayor();
});

describe("auth", () => {
  test("mayor signs in, wrong password and unknown user are rejected", async () => {
    expect((await call("POST", "/auth/login", undefined, { email: "mayor@test.local", password: "nope" })).status).toBe(401);
    expect((await call("POST", "/auth/login", undefined, { email: "ghost@test.local", password: "Whatever1" })).data.code).toBe("not_found");
    const r = await call("POST", "/auth/login", undefined, { email: "mayor@test.local", password: "Mayor@12345" });
    expect(r.status).toBe(200);
    expect(r.data.role).toBe("mayor");
    mayor = r.data.token;
  });

  test("protected routes require the right role", async () => {
    expect((await call("GET", "/mayor/sync")).status).toBe(401);
    expect((await call("GET", "/app/sync", mayor)).status).toBe(403);
  });
});

describe("places and admins", () => {
  test("mayor creates places", async () => {
    const a = await call("POST", "/mayor/places", mayor, { name: "Sunrise Condo", kind: "residential", category: "Condominium", district: "Bangsar", address: "1 Jalan Satu", lat: 3.13, lng: 101.67, description: "A condo" });
    expect(a.status).toBe(201);
    home = a.data.id;
    const b = await call("POST", "/mayor/places", mayor, { name: "Central Mall", kind: "non-residential", category: "Mall", district: "KLCC", address: "2 Jalan Dua", lat: 3.15, lng: 101.71, description: "A mall" });
    mall = b.data.id;
    const list = await call("GET", "/auth/places");
    expect(list.data.map((p: Json) => p.id)).toEqual([home]);
  });

  test("mayor creates admins with a temporary password and assigns places", async () => {
    const a = await call("POST", "/mayor/admins", mayor, { name: "Vik Admin", email: "vik@test.local", phone: "+60 11-111 1111", nationalId: "800101-14-1111", gender: "Male", placeId: home });
    expect(a.status).toBe(201);
    expect(a.data.temporaryPassword.length).toBeGreaterThan(8);
    adminHome = (await call("POST", "/auth/login", undefined, { email: "vik@test.local", password: a.data.temporaryPassword })).data.token;
    const dup = await call("POST", "/mayor/admins", mayor, { name: "Vik Admin", email: "vik@test.local", phone: "+60 11-111 1111", nationalId: "800101-14-1111", gender: "Male" });
    expect(dup.status).toBe(409);
    const b = await call("POST", "/mayor/admins", mayor, { name: "Mall Admin", email: "mall@test.local", phone: "+60 11-111 2222", nationalId: "800101-14-2222", gender: "Female", placeId: mall });
    adminMall = (await call("POST", "/auth/login", undefined, { email: "mall@test.local", password: b.data.temporaryPassword })).data.token;
    const sync = await call("GET", "/mayor/sync", mayor);
    expect(sync.data.places.find((p: Json) => p.id === home).adminId).toBeTruthy();
  });
});

describe("registration", () => {
  test("a wrong code fails, the right code registers", async () => {
    await call("POST", "/auth/code", undefined, { email: "alice@test.local", purpose: "register" });
    const bad = await call("POST", "/auth/register", undefined, { name: "Alice Tan", email: "alice@test.local", phone: "+60 12-000 0000", password: "Resident1", gender: "Female", placeId: home, unit: "A-1-1", code: "000000" });
    expect(bad.status).toBe(400);
    alice = await registerUser("alice@test.local", "Alice Tan", home, "a-12-3");
    bob = await registerUser("bob@test.local", "Bob Lim", home, "B-2-2");
    const dup = await call("POST", "/auth/code", undefined, { email: "alice@test.local", purpose: "register" });
    expect(dup.status).toBe(409);
  });

  test("password reset flow", async () => {
    await call("POST", "/auth/code", undefined, { email: "bob@test.local", purpose: "reset" });
    const code = lastCode("bob@test.local");
    expect((await call("POST", "/auth/code/verify", undefined, { email: "bob@test.local", purpose: "reset", code })).status).toBe(200);
    expect((await call("POST", "/auth/reset", undefined, { email: "bob@test.local", code, password: "NewPass99" })).status).toBe(200);
    const r = await call("POST", "/auth/login", undefined, { email: "bob@test.local", password: "NewPass99" });
    expect(r.status).toBe(200);
    bob = r.data.token;
  });

  test("sync is scoped per role", async () => {
    const a = await call("GET", "/app/sync", alice);
    aliceId = a.data.sessionId;
    bobId = (await call("GET", "/app/sync", bob)).data.sessionId;
    expect(a.data.accounts.find((x: Json) => x.id === aliceId).unit).toBe("A-12-3");
    const neighbour = a.data.accounts.find((x: Json) => x.id === bobId);
    expect(neighbour.email).toBe("");
    const adm = await call("GET", "/app/sync", adminHome);
    expect(adm.data.accounts.find((x: Json) => x.id === bobId).email).toBe("bob@test.local");
    expect(JSON.stringify(a.data)).not.toContain("passwordHash");
    const m = await call("GET", "/mayor/sync", mayor);
    expect(m.data.users.length).toBe(2);
    expect(JSON.stringify(m.data)).not.toContain("passwordHash");
  });
});

describe("notices and rules", () => {
  test("residential admin posts a private notice only its residents see", async () => {
    const n = await call("POST", "/app/notices", adminHome, { title: "Water cut", body: "Tomorrow 9am-1pm", pinned: true });
    expect(n.status).toBe(201);
    expect((await call("GET", "/app/sync", alice)).data.notices.some((x: Json) => x.title === "Water cut")).toBe(true);
    expect((await call("GET", "/app/sync", adminMall)).data.notices.some((x: Json) => x.title === "Water cut")).toBe(false);
    expect((await call("POST", `/app/notices/${n.data.id}/seen`, alice)).status).toBe(200);
    const s = await call("GET", "/app/sync", alice);
    expect(s.data.seen).toContain(`${aliceId}:${n.data.id}`);
    expect((await call("DELETE", `/app/notices/${n.data.id}`, adminMall)).status).toBe(404);
  });

  test("mayor announcement reaches the app and a resident cannot post notices", async () => {
    await call("POST", "/mayor/announcements", mayor, { title: "City day", body: "Join us" });
    const s = await call("GET", "/app/sync", alice);
    expect(s.data.notices.find((x: Json) => x.title === "City day").placeId).toBe("city");
    expect((await call("POST", "/app/notices", alice, { title: "Hi", body: "Hello there" })).status).toBe(403);
  });

  test("rules are ordered and scoped by place kind", async () => {
    const r1 = await call("POST", "/app/rules", adminHome, { type: "residents", title: "Quiet hours", text: "No noise after 10pm", category: "noise" });
    const r2 = await call("POST", "/app/rules", adminHome, { type: "residents", title: "Parking", text: "Use your own bay", category: "parking" });
    await call("POST", `/app/rules/${r2.data.id}/move`, adminHome, { dir: -1 });
    const p = (await call("GET", "/app/sync", alice)).data.places.find((x: Json) => x.id === home);
    expect(p.rules.residents.map((r: Json) => r.title)).toEqual(["Parking", "Quiet hours"]);
    expect((await call("POST", "/app/rules", adminMall, { type: "residents", title: "Nope", text: "Not allowed", category: "general" })).status).toBe(422);
    expect((await call("PATCH", `/app/rules/${r1.data.id}`, adminMall, { title: "Hijack" })).status).toBe(404);
  });
});

describe("complaints", () => {
  test("private complaint reaches the residence admin and the conversation works", async () => {
    const c = await call("POST", "/app/complaints", alice, { kind: "private", placeId: home, subject: "Lift is broken", category: "Maintenance", priority: "high", body: "Lift B has been out for two days" });
    expect(c.status).toBe(201);
    const adm = await call("GET", "/app/sync", adminHome);
    const got = adm.data.complaints.find((x: Json) => x.id === c.data.id);
    expect(got.unread).toBe(true);
    expect((await call("GET", "/app/sync", adminMall)).data.complaints.length).toBe(0);
    expect((await call("GET", "/app/sync", bob)).data.complaints.length).toBe(0);
    await call("POST", `/app/complaints/${c.data.id}/reply`, adminHome, { text: "We are on it" });
    const after = (await call("GET", "/app/sync", alice)).data.complaints[0];
    expect(after.status).toBe("in_review");
    expect(after.userUnread).toBe(true);
    expect(after.messages.map((m: Json) => m.from)).toEqual(["user", "admin"]);
    await call("POST", `/app/complaints/${c.data.id}/read`, alice);
    await call("POST", `/app/complaints/${c.data.id}/status`, adminHome, { status: "resolved" });
    expect((await call("POST", `/app/complaints/${c.data.id}/status`, alice, { status: "new" })).status).toBe(403);
    expect((await call("POST", `/app/complaints/${c.data.id}/reply`, bob, { text: "mine too" })).status).toBe(403);
  });

  test("complaint to a place admin and to the mayor", async () => {
    const p = await call("POST", "/app/complaints", alice, { kind: "place", placeId: mall, subject: "Escalator stuck", category: "Safety", priority: "medium", body: "The escalator is stuck again" });
    expect((await call("GET", "/app/sync", adminMall)).data.complaints.some((x: Json) => x.id === p.data.id)).toBe(true);
    const m = await call("POST", "/app/complaints", alice, { kind: "public", placeId: home, subject: "Road potholes", category: "Roads", priority: "low", body: "Many potholes on Jalan Satu" });
    const sync = await call("GET", "/mayor/sync", mayor);
    const inbox = sync.data.complaints.find((x: Json) => x.id === m.data.id);
    expect(inbox.messages[0].from).toBe("user");
    expect(sync.data.complaints.some((x: Json) => x.id === p.data.id)).toBe(false);
    await call("POST", `/mayor/complaints/${m.data.id}/reply`, mayor, { text: "Thanks, we will fix it" });
    const resident = (await call("GET", "/app/sync", alice)).data.complaints.find((x: Json) => x.id === m.data.id);
    expect(resident.status).toBe("in_review");
    expect(resident.messages[1].from).toBe("admin");
    await call("POST", `/mayor/complaints/${m.data.id}/status`, mayor, { status: "rejected" });
    expect((await call("GET", "/mayor/sync", mayor)).data.complaints.find((x: Json) => x.id === m.data.id).status).toBe("rejected");
  });
});

describe("neighbor reports", () => {
  let id = "";
  test("group chat with moderation, strikes and automatic escalation", async () => {
    const r = await call("POST", "/app/reports", alice, { category: "noise", subject: "Loud music at night", details: "Music until 3am most nights" });
    expect(r.status).toBe(201);
    id = r.data.id;
    const bobView = (await call("GET", "/app/sync", bob)).data.reports.find((x: Json) => x.id === id);
    expect(bobView.unread).toBe(true);
    expect(bobView.messages[0].from).toBe("mod");
    await call("POST", `/app/reports/${id}/read`, bob);
    expect((await call("POST", `/app/reports/${id}/messages`, bob, { text: "Sorry, I will keep it down" })).data.flagged).toBe(false);
    for (let i = 0; i < 3; i++) {
      const bad = await call("POST", `/app/reports/${id}/messages`, bob, { text: "You are such an idiot" });
      if (i < 2) expect(bad.data.flagged).toBe(true);
    }
    const view = (await call("GET", "/app/sync", alice)).data.reports.find((x: Json) => x.id === id);
    expect(view.status).toBe("escalated");
    expect(view.strikes).toBe(3);
    const adm = (await call("GET", "/app/sync", adminHome)).data.complaints.find((x: Json) => x.subject.startsWith("Neighbor dispute"));
    expect(adm).toBeTruthy();
    expect((await call("POST", `/app/reports/${id}/messages`, alice, { text: "hello" })).status).toBe(409);
    expect((await call("GET", "/app/sync", adminMall)).data.reports.length).toBe(0);
  });

  test("resolve and place reports", async () => {
    const r = await call("POST", "/app/reports", bob, { category: "waste", subject: "Bin room smells", details: "Nobody cleans the bin room" });
    await call("POST", `/app/reports/${r.data.id}/resolve`, alice);
    expect((await call("GET", "/app/sync", bob)).data.reports.find((x: Json) => x.id === r.data.id).status).toBe("resolved");
    const pr = await call("POST", "/app/place-reports", alice, { placeId: mall, category: "safety", subject: "Slippery floor", details: "The floor is wet near the entrance" });
    expect((await call("GET", "/app/sync", adminMall)).data.placeReports.some((x: Json) => x.id === pr.data.id)).toBe(true);
    expect((await call("DELETE", `/app/place-reports/${pr.data.id}`, bob)).status).toBe(404);
    expect((await call("DELETE", `/app/place-reports/${pr.data.id}`, alice)).status).toBe(200);
  });
});

describe("policies and donations", () => {
  test("only published policies reach residents", async () => {
    await call("POST", "/mayor/policies", mayor, { title: "Fire safety", category: "Fire", severity: "critical", summary: "Know your exits", content: "1. Stay calm", published: true });
    const d = await call("POST", "/mayor/policies", mayor, { title: "Draft", category: "General", severity: "info", summary: "wip", content: "wip", published: false });
    const s = await call("GET", "/app/sync", alice);
    expect(s.data.policies.map((p: Json) => p.title)).toEqual(["Fire safety"]);
    await call("PATCH", `/mayor/policies/${d.data.id}`, mayor, { published: true });
    expect((await call("GET", "/app/sync", alice)).data.policies.length).toBe(2);
    expect((await call("DELETE", `/mayor/policies/${d.data.id}`, mayor)).status).toBe(200);
  });

  test("donation campaigns and pledges", async () => {
    const d = await call("POST", "/mayor/donations", mayor, { title: "Flood relief", category: "Disaster relief", description: "Help families", goal: 1000, deadline: "2030-01-01" });
    expect(d.status).toBe(201);
    await call("POST", `/app/donations/${d.data.id}/pledge`, alice, { amount: 50 });
    await call("POST", `/app/donations/${d.data.id}/pledge`, alice, { amount: 25 });
    await call("POST", `/app/donations/${d.data.id}/pledge`, bob, { amount: 10 });
    const s = await call("GET", "/app/sync", alice);
    const don = s.data.donations.find((x: Json) => x.id === d.data.id);
    expect(don.raised).toBe(85);
    expect(don.donors).toBe(2);
    expect(don.cover).toBe("flood");
    expect(s.data.pledged[`${aliceId}:${d.data.id}`]).toBe(75);
    await call("PATCH", `/mayor/donations/${d.data.id}`, mayor, { status: "closed" });
    expect((await call("POST", `/app/donations/${d.data.id}/pledge`, alice, { amount: 5 })).status).toBe(409);
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    await call("PATCH", `/mayor/donations/${d.data.id}`, mayor, { image: png });
    const img = (await call("GET", "/mayor/sync", mayor)).data.donations.find((x: Json) => x.id === d.data.id).image;
    expect(img).toContain("/api/media/donations/");
    const res = await app.request(new URL(img).pathname);
    expect(res.headers.get("content-type")).toBe("image/png");
  });
});

describe("profile, game, admins lifecycle", () => {
  test("profile edits, photo and password change", async () => {
    expect((await call("PATCH", "/app/profile", alice, { name: "Alice T", phone: "+60 12-999 9999" })).status).toBe(200);
    expect((await call("PATCH", "/app/profile", alice, { email: "new@test.local" })).status).toBe(403);
    expect((await call("PATCH", "/app/profile", adminHome, { email: "bob@test.local" })).status).toBe(409);
    expect((await call("PATCH", "/app/profile", adminHome, { email: "vik2@test.local", phone: "+60 12-222 2222" })).status).toBe(200);
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    await call("PUT", "/app/profile/photo", alice, { photo: png });
    const me = (await call("GET", "/app/sync", alice)).data.accounts.find((x: Json) => x.id === aliceId);
    expect(me.name).toBe("Alice T");
    expect(me.photo).toContain(`/api/media/users/${aliceId}`);
    expect((await call("POST", "/auth/password", alice, { current: "wrong", next: "Another99" })).status).toBe(400);
    expect((await call("POST", "/auth/password", alice, { current: "Resident1", next: "Another99" })).status).toBe(200);
    expect((await call("POST", "/auth/login", undefined, { email: "alice@test.local", password: "Another99" })).status).toBe(200);
  });

  test("tidy town leaderboard", async () => {
    expect((await call("POST", "/app/game/score", alice, { score: 100 })).status).toBe(409);
    expect((await call("PUT", "/app/game/nick", alice, { nick: "BinBoss" })).status).toBe(200);
    expect((await call("PUT", "/app/game/nick", bob, { nick: "binboss" })).status).toBe(409);
    expect((await call("PUT", "/app/game/nick", bob, { nick: "idiot" })).status).toBe(422);
    expect((await call("PUT", "/app/game/nick", bob, { nick: "EcoBob" })).status).toBe(200);
    await call("POST", "/app/game/score", alice, { score: 200 });
    await call("POST", "/app/game/score", alice, { score: 150 });
    await call("POST", "/app/game/score", bob, { score: 300 });
    const s = (await call("GET", "/app/sync", alice)).data;
    expect(s.board.map((b: Json) => [b.nick, b.score])).toEqual([["EcoBob", 300], ["BinBoss", 200]]);
    expect(s.myBest).toBe(200);
    expect(s.board.find((b: Json) => b.me).nick).toBe("BinBoss");
  });

  test("freeze, promote, reassign, delete", async () => {
    const adminId = (await call("GET", "/app/sync", adminMall)).data.sessionId;
    await call("POST", `/mayor/admins/${adminId}/freeze`, mayor, { frozen: true, reason: "Audit" });
    expect((await call("GET", "/app/sync", adminMall)).status).toBe(403);
    expect((await call("POST", "/auth/login", undefined, { email: "mall@test.local", password: "x" })).status).toBe(401);
    await call("POST", `/mayor/admins/${adminId}/freeze`, mayor, { frozen: false });
    expect((await call("GET", "/app/sync", adminMall)).status).toBe(200);
    const promoted = await call("POST", "/mayor/admins/promote", mayor, { userId: bobId, placeId: mall });
    expect(promoted.status).toBe(200);
    const m = (await call("GET", "/mayor/sync", mayor)).data;
    expect(m.admins.find((a: Json) => a.id === bobId).placeId).toBe(mall);
    expect(m.admins.find((a: Json) => a.id === adminId).placeId).toBe(null);
    expect(m.users.find((u: Json) => u.id === bobId).role).toBe("admin");
    expect((await call("DELETE", `/mayor/places/${home}`, mayor)).status).toBe(409);
    expect((await call("DELETE", "/auth/me", alice)).status).toBe(200);
    expect((await call("GET", "/app/sync", alice)).status).toBe(401);
  });
});
