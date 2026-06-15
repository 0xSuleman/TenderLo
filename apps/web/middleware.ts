import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const protectedPrefixes = [
  "/account",
  "/admin",
  "/alerts",
  "/awards",
  "/bid-packages",
  "/billing",
  "/compliance",
  "/dashboard",
  "/documents",
  "/onboarding",
  "/partners",
  "/profile",
  "/recommendations",
  "/saved-searches",
  "/search",
  "/subcontracting",
  "/team"
];

function isProtectedPath(pathname: string): boolean {
  return protectedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function redirectWithCookies(request: NextRequest, response: NextResponse, path: string, params: Record<string, string> = {}): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = path;
  url.search = "";
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  const redirectResponse = NextResponse.redirect(url);
  response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
  return redirectResponse;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) return response;

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      }
    }
  });

  const pathname = request.nextUrl.pathname;
  const isAuthPage = pathname === "/login" || pathname === "/signup";
  const needsAuth = isProtectedPath(pathname);
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    if (!needsAuth) return response;
    return redirectWithCookies(request, response, "/login", {
      next: pathname,
      error: "Sign in before opening the contractor workspace."
    });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("memberships")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  const hasMembership = !membershipError && Boolean(membership);

  if (isAuthPage) {
    return redirectWithCookies(request, response, hasMembership ? "/dashboard" : "/onboarding");
  }

  if (pathname === "/onboarding" && hasMembership) {
    return redirectWithCookies(request, response, "/dashboard");
  }

  if (needsAuth && !hasMembership && pathname !== "/onboarding") {
    return redirectWithCookies(request, response, "/onboarding");
  }

  return response;
}

export const config = {
  matcher: [
    "/account/:path*",
    "/admin/:path*",
    "/alerts/:path*",
    "/awards/:path*",
    "/bid-packages/:path*",
    "/billing/:path*",
    "/compliance/:path*",
    "/dashboard/:path*",
    "/documents/:path*",
    "/login",
    "/onboarding",
    "/partners/:path*",
    "/profile/:path*",
    "/recommendations/:path*",
    "/saved-searches/:path*",
    "/search/:path*",
    "/signup",
    "/subcontracting/:path*",
    "/team/:path*"
  ]
};
