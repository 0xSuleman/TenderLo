import { type CookieOptions, createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createServiceClient, getActiveMembership, isOpsAdmin, requireRole, type DatabaseClient } from "@tenderlo/db";
import { ForbiddenError, UnauthorizedError, type UserRole, requiredEnv } from "@tenderlo/shared";

export async function createSupabaseRouteClient(): Promise<DatabaseClient> {
  const cookieStore = await cookies();
  return createServerClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server components cannot set cookies; route handlers can.
        }
      }
    }
  }) as DatabaseClient;
}

export function createSupabaseAdminClient(): DatabaseClient {
  return createServiceClient();
}

export async function requireUser(): Promise<{ id: string; email: string | null }> {
  const supabase = await createSupabaseRouteClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    if (process.env.ALLOW_DEV_AUTH === "true" && process.env.DEV_USER_ID) {
      return { id: process.env.DEV_USER_ID, email: process.env.DEV_USER_EMAIL ?? null };
    }
    throw new UnauthorizedError();
  }
  return { id: data.user.id, email: data.user.email ?? null };
}

export async function requireOrgContext(
  request: Request,
  allowedRoles: UserRole[] = ["owner", "admin", "member", "viewer", "ops_admin"]
): Promise<{ supabase: DatabaseClient; admin: DatabaseClient; user: { id: string; email: string | null }; organizationId: string; role: UserRole; isOps: boolean }> {
  const user = await requireUser();
  const admin = createSupabaseAdminClient();
  const url = new URL(request.url);
  const requestedOrg = request.headers.get("x-organization-id") ?? url.searchParams.get("organization_id") ?? undefined;
  const membership = await getActiveMembership(admin, user.id, requestedOrg);
  if (!allowedRoles.includes(membership.role)) {
    throw new ForbiddenError();
  }
  return {
    supabase: await createSupabaseRouteClient(),
    admin,
    user,
    organizationId: membership.organization_id,
    role: membership.role,
    isOps: await isOpsAdmin(admin, user.id)
  };
}

export async function requireOrgRoleFromRequest(request: Request, allowedRoles: UserRole[]): Promise<Awaited<ReturnType<typeof requireOrgContext>>> {
  const context = await requireOrgContext(request);
  await requireRole(context.admin, context.user.id, context.organizationId, allowedRoles);
  return context;
}

export async function requireOpsAdmin(request: Request): Promise<Awaited<ReturnType<typeof requireOrgContext>>> {
  const context = await requireOrgContext(request);
  if (!context.isOps) throw new ForbiddenError("Ops admin access required.");
  return context;
}
