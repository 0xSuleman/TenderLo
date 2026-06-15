import { BadgeCheck, Building2, ClipboardCheck } from "lucide-react";
import { AppShell } from "@/components/nav";
import { ProgressBar } from "@/components/motion";
import { Badge, Button, Card, Field, Input, PageHeader, Select } from "@/components/ui";
import { getPageContext } from "@/lib/page-context";
import { addPecLicenseAction, saveCompanyProfileAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ProfilePage(): Promise<JSX.Element> {
  const context = await getPageContext();
  const [profile, pec] = context
    ? await Promise.all([
        context.admin.from("company_profiles").select("*").eq("organization_id", context.organizationId).maybeSingle(),
        context.admin.from("pec_licenses").select("*").eq("organization_id", context.organizationId).order("created_at", { ascending: false }).limit(5)
      ])
    : [{ data: null }, { data: [] }];
  return (
    <AppShell>
      <PageHeader title="Profile Vault" body="Company profile, PEC category, regions, and contractor sectors." />
      <Card className="mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Badge tone={(profile.data?.profile_completeness_score ?? 0) >= 70 ? "good" : "warn"}><ClipboardCheck className="h-3.5 w-3.5" />Readiness {profile.data?.profile_completeness_score ?? 0}%</Badge>
            <h2 className="mt-3 font-display text-2xl font-semibold">Profile data powers recommendations and compliance reports.</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Keep PEC category, specializations, operating regions, and document readiness current so unknown requirements remain visible instead of being guessed.</p>
          </div>
        </div>
        <ProgressBar className="mt-5" tone={(profile.data?.profile_completeness_score ?? 0) >= 70 ? "success" : "warning"} value={profile.data?.profile_completeness_score ?? 0} />
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-4 flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-white/72 text-primary shadow-sm"><Building2 className="h-5 w-5" /></div>
            <h2 className="font-semibold">Company</h2>
          </div>
          <form action={saveCompanyProfileAction} className="grid gap-4">
            <Field label="Business type"><Input name="business_type" defaultValue={profile.data?.business_type ?? ""} /></Field>
            <Field label="NTN"><Input name="ntn" defaultValue={profile.data?.ntn ?? ""} /></Field>
            <Field label="STRN"><Input name="strn" defaultValue={profile.data?.strn ?? ""} /></Field>
            <Field label="Website"><Input name="website" defaultValue={profile.data?.website ?? ""} /></Field>
            <Field label="Operating regions"><Input name="operating_regions" defaultValue={(profile.data?.operating_regions ?? []).join(", ")} /></Field>
            <Field label="Contractor sectors"><Input name="sectors" defaultValue={(profile.data?.sectors ?? []).join(", ")} /></Field>
            <Button type="submit">Save profile</Button>
          </form>
        </Card>
        <Card>
          <div className="mb-4 flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-white/72 text-primary shadow-sm"><BadgeCheck className="h-5 w-5" /></div>
            <h2 className="font-semibold">PEC License</h2>
          </div>
          <form action={addPecLicenseAction} className="grid gap-4">
            <Field label="License number"><Input name="license_number" required /></Field>
            <Field label="Category">
              <Select name="category" defaultValue="C-4">
                {["C-A", "C-B", "C-1", "C-2", "C-3", "C-4", "C-5", "C-6", "unknown"].map((item) => <option key={item}>{item}</option>)}
              </Select>
            </Field>
            <Field label="Specialization codes"><Input name="specialization_codes" /></Field>
            <Field label="Issue date"><Input name="issue_date" type="date" /></Field>
            <Field label="Expiry date"><Input name="expiry_date" type="date" /></Field>
            <Button type="submit">Add PEC record</Button>
          </form>
          <div className="mt-6 grid gap-2 text-sm">
            {(pec.data ?? []).map((row: any) => (
              <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/70 bg-white/58 p-3">
                <span>{row.license_number} · {row.category}</span>
                <Badge tone={row.verification_status === "verified" ? "good" : row.verification_status === "expired" ? "bad" : "warn"}>{row.verification_status}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
