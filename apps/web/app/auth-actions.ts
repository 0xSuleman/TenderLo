"use server";

import { redirect } from "next/navigation";
import { calculateProfileCompleteness, createServiceClient, writeAuditLog, type DatabaseClient } from "@tenderlo/db";
import { onboardingSchema } from "@tenderlo/shared";
import { createSupabaseRouteClient } from "@/lib/supabase";

function textField(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function nullableTextField(formData: FormData, name: string): string | null {
  const value = textField(formData, name);
  return value.length ? value : null;
}

function safeNextPath(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/api/")) return null;
  if (["/login", "/signup"].includes(value)) return null;
  return value;
}

function redirectWithMessage(path: string, key: "error" | "message", message: string, extraParams: Record<string, string> = {}): never {
  const params = new URLSearchParams({ [key]: message });
  Object.entries(extraParams).forEach(([paramKey, paramValue]) => params.set(paramKey, paramValue));
  redirect(`${path}?${params.toString()}` as Parameters<typeof redirect>[0]);
}

async function hasActiveMembership(admin: DatabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("memberships")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1);
  if (error) throw error;
  return Boolean(data?.length);
}

export async function signInAction(formData: FormData): Promise<void> {
  const supabase = await createSupabaseRouteClient();
  const email = textField(formData, "email").toLowerCase();
  const password = textField(formData, "password");
  const nextPath = safeNextPath(formData.get("next"));

  if (!email || !password) {
    redirectWithMessage("/login", "error", "Enter your email and password.");
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    redirectWithMessage("/login", "error", "The email or password is incorrect.");
  }

  const admin = createServiceClient();
  if (!(await hasActiveMembership(admin, data.user.id))) {
    redirect("/onboarding");
  }

  redirect((nextPath && nextPath !== "/onboarding" ? nextPath : "/dashboard") as Parameters<typeof redirect>[0]);
}

export async function signUpAction(formData: FormData): Promise<void> {
  const supabase = await createSupabaseRouteClient();
  const email = textField(formData, "email").toLowerCase();
  const password = textField(formData, "password");
  const confirmPassword = textField(formData, "confirm_password");
  const fullName = textField(formData, "full_name");
  const nextPath = safeNextPath(formData.get("next"));

  if (!fullName || !email || !password) {
    redirectWithMessage("/signup", "error", "Enter your name, email, and password.");
  }
  if (password.length < 8) {
    redirectWithMessage("/signup", "error", "Password must be at least 8 characters.");
  }
  if (password !== confirmPassword) {
    redirectWithMessage("/signup", "error", "Password confirmation does not match.");
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName }
    }
  });

  if (error) {
    redirectWithMessage("/signup", "error", error.message);
  }

  if (!data.session) {
    redirectWithMessage("/login", "message", "Account created. Confirm your email if required, then sign in.", nextPath ? { next: nextPath } : {});
  }

  redirect("/onboarding");
}

export async function onboardingAction(formData: FormData): Promise<void> {
  const supabase = await createSupabaseRouteClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    redirectWithMessage("/login", "error", "Sign in before creating a contractor workspace.");
  }

  const admin = createServiceClient();
  if (await hasActiveMembership(admin, data.user.id)) {
    redirect("/dashboard");
  }

  const parsed = onboardingSchema.safeParse({
    full_name: textField(formData, "full_name"),
    phone: nullableTextField(formData, "phone"),
    name: textField(formData, "name"),
    legal_name: textField(formData, "legal_name") || textField(formData, "name"),
    primary_contact_name: textField(formData, "primary_contact_name") || textField(formData, "full_name"),
    primary_contact_email: textField(formData, "primary_contact_email") || data.user.email,
    city: nullableTextField(formData, "city"),
    province: nullableTextField(formData, "province")
  });

  if (!parsed.success) {
    redirectWithMessage("/onboarding", "error", parsed.error.issues[0]?.message ?? "Check the onboarding fields.");
  }

  const input = parsed.data;

  try {
    const { data: organization, error: orgError } = await admin
      .from("organizations")
      .insert({
        name: input.name,
        legal_name: input.legal_name,
        primary_contact_name: input.primary_contact_name,
        primary_contact_email: input.primary_contact_email,
        phone: input.phone,
        city: input.city,
        province: input.province
      })
      .select("*")
      .single();
    if (orgError) throw orgError;

    const profileResult = await admin
      .from("profiles")
      .upsert({ user_id: data.user.id, full_name: input.full_name, phone: input.phone }, { onConflict: "user_id" });
    if (profileResult.error) throw profileResult.error;

    const membershipResult = await admin
      .from("memberships")
      .insert({ organization_id: organization.id, user_id: data.user.id, role: "owner", status: "active" });
    if (membershipResult.error) throw membershipResult.error;

    const companyResult = await admin
      .from("company_profiles")
      .insert({ organization_id: organization.id, operating_regions: input.province ? [input.province] : [], sectors: [] });
    if (companyResult.error) throw companyResult.error;

    const subscriptionResult = await admin
      .from("subscriptions")
      .insert({ organization_id: organization.id, plan: "starter", status: "trialing", provider: "internal_trial", provider_subscription_id: `trial-${organization.id}` });
    if (subscriptionResult.error) throw subscriptionResult.error;

    await calculateProfileCompleteness(admin, organization.id);
    await writeAuditLog(admin, {
      organizationId: organization.id,
      actorUserId: data.user.id,
      action: "organization.onboarded",
      entityType: "organization",
      entityId: organization.id,
      newValue: organization
    });
  } catch (setupError) {
    console.error("Workspace onboarding failed", setupError);
    redirectWithMessage("/onboarding", "error", "Workspace setup could not be completed. Try again or contact support.");
  }

  redirect("/dashboard");
}
