import { redirect } from "next/navigation";
import { createSupabaseAdminClient, createSupabaseRouteClient } from "@/lib/supabase";
import { Button, Card, Field, Input, PageHeader, Select } from "@/components/ui";
import { onboardingAction } from "../auth-actions";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function OnboardingPage({ searchParams }: { searchParams?: SearchParams }): Promise<JSX.Element> {
  const supabase = await createSupabaseRouteClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    redirect("/login?next=/onboarding&error=Sign+in+before+creating+a+contractor+workspace.");
  }

  const admin = createSupabaseAdminClient();
  const { data: memberships, error: membershipError } = await admin
    .from("memberships")
    .select("id")
    .eq("user_id", data.user.id)
    .eq("status", "active")
    .limit(1);
  if (membershipError) throw membershipError;
  if (memberships?.length) redirect("/dashboard");

  const params = searchParams ? await searchParams : {};
  const error = firstParam(params.error);
  const fullName = typeof data.user.user_metadata?.full_name === "string" ? data.user.user_metadata.full_name : "";

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <PageHeader title="Create Contractor Workspace" body="Workspace ownership, billing, Profile Vault, and tender recommendations attach to this organization." />
      <Card>
        <form action={onboardingAction} className="grid gap-4 md:grid-cols-2">
          {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 md:col-span-2">{error}</p> : null}
          <Field label="Full name">
            <Input name="full_name" defaultValue={fullName} required />
          </Field>
          <Field label="Phone">
            <Input name="phone" />
          </Field>
          <Field label="Company name">
            <Input name="name" required />
          </Field>
          <Field label="Legal name">
            <Input name="legal_name" />
          </Field>
          <Field label="Contact email">
            <Input name="primary_contact_email" type="email" defaultValue={data.user.email ?? ""} />
          </Field>
          <Field label="City">
            <Input name="city" />
          </Field>
          <Field label="Province">
            <Select name="province" defaultValue="Punjab">
              {["Punjab", "Sindh", "Khyber Pakhtunkhwa", "Balochistan", "Islamabad Capital Territory"].map((province) => (
                <option key={province}>{province}</option>
              ))}
            </Select>
          </Field>
          <div className="md:col-span-2">
            <Button type="submit">Enter dashboard</Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
