import { Hono } from "hono";
import { Donation, User } from "./models";
import { HttpError } from "./http";

const MAX_CHARS = 4_000_000;
const DATA_URL = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/;

export function assertImage(dataUrl: string) {
  if (dataUrl.length > MAX_CHARS) throw new HttpError(422, "That image is too large", "validation");
  if (!DATA_URL.test(dataUrl)) throw new HttpError(422, "Unsupported image", "validation");
}

export async function savePhoto(user: User, dataUrl: string | null) {
  if (dataUrl) assertImage(dataUrl);
  user.photo = dataUrl;
  user.photoVersion += 1;
  await user.save();
}

export async function saveDonationImage(d: Donation, dataUrl: string | null) {
  if (dataUrl) assertImage(dataUrl);
  d.image = dataUrl;
  d.imageVersion += 1;
  await d.save();
}

function respond(dataUrl: string) {
  const m = DATA_URL.exec(dataUrl);
  if (!m) throw new HttpError(404, "Not found");
  return new Response(Buffer.from(m[2], "base64"), {
    headers: { "content-type": m[1], "cache-control": "public, max-age=31536000, immutable", "access-control-allow-origin": "*", "cross-origin-resource-policy": "cross-origin" },
  });
}

export const mediaRoutes = new Hono();

mediaRoutes.get("/users/:id", async (c) => {
  const u = await User.findByPk(c.req.param("id"), { attributes: ["id", "photo"] });
  if (!u?.photo) throw new HttpError(404, "Not found");
  return respond(u.photo);
});

mediaRoutes.get("/donations/:id", async (c) => {
  const d = await Donation.findByPk(c.req.param("id"), { attributes: ["id", "image"] });
  if (!d?.image) throw new HttpError(404, "Not found");
  return respond(d.image);
});
