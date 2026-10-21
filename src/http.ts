import type { Context } from "hono";
import { ZodError, type ZodType } from "zod";

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export async function body<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError(400, "Request body must be valid JSON", "bad_json");
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new HttpError(422, formatZod(r.error), "validation");
  return r.data;
}

export function formatZod(e: ZodError) {
  const i = e.issues[0];
  const path = i.path.join(".");
  return path ? `${path}: ${i.message}` : i.message;
}

export const norm = (e: string) => e.trim().toLowerCase();

export const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : undefined);
