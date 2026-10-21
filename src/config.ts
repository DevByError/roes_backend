import { z } from "zod";

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(4000),
  CORS_ORIGINS: z.string().default("*"),
  DB_HOST: z.string().default("127.0.0.1"),
  DB_PORT: z.coerce.number().default(3306),
  DB_NAME: z.string().default("roes"),
  DB_USER: z.string().default("root"),
  DB_PASSWORD: z.string().default(""),
  DB_LOG: bool,
  DB_SYNC: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_DAYS: z.coerce.number().default(30),
  MAYOR_NAME: z.string().default("Mayor"),
  MAYOR_EMAIL: z.string().email(),
  MAYOR_PASSWORD: z.string().min(8),
  MAYOR_PHONE: z.string().default(""),
  MAYOR_OFFICE: z.string().default("City Hall"),
  MAYOR_CITY: z.string().default(""),
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: bool,
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  MAIL_FROM: z.string().default("ROES <no-reply@localhost>"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}

export const config = parsed.data;
export const isProd = config.NODE_ENV === "production";
