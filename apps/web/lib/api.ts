import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@tenderlo/shared";

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ data }, init);
}

export function created<T>(data: T): NextResponse {
  return ok(data, { status: 201 });
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export function fail(error: unknown, status = 400): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid request.", code: "VALIDATION_ERROR" }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : String(error);
  const resolvedStatus = /auth/i.test(message) ? 401 : /permission|forbidden|ops admin/i.test(message) ? 403 : status;
  return NextResponse.json({ error: message }, { status: resolvedStatus });
}

export async function parseBody<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<z.infer<T>> {
  const json = await request.json().catch(() => ({}));
  return schema.parse(json);
}

export function readSearchParams<T extends z.ZodTypeAny>(request: Request, schema: T): z.infer<T> {
  const url = new URL(request.url);
  return schema.parse(Object.fromEntries(url.searchParams.entries()));
}
