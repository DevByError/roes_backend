import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { config } from "./config";
import { HttpError } from "./http";
import { mediaRoutes } from "./media";
import { authRoutes } from "./routes/auth";
import { appRoutes } from "./routes/app";
import { mayorRoutes } from "./routes/mayor";
import { cityInfo } from "./serialize";

export const app = new Hono();

const origins = config.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);

app.use("*", secureHeaders({ crossOriginResourcePolicy: false }));
app.use(
  "/api/*",
  cors({
    origin: origins.includes("*") ? "*" : origins,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 86400,
  }),
);

app.get("/api/health", (c) => c.json({ ok: true }));
app.get("/api/city", (c) => c.json(cityInfo()));
app.route("/api/media", mediaRoutes);
app.route("/api/auth", authRoutes);
app.route("/api/mayor", mayorRoutes);
app.route("/api/app", appRoutes);

app.notFound((c) => c.json({ error: "Not found", code: "not_found" }, 404));
app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message, code: err.code ?? "error" }, err.status);
  console.error(err);
  return c.json({ error: "Something went wrong on our side. Please try again.", code: "server_error" }, 500);
});
