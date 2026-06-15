import { AppShell } from "@/components/nav";
import { Card, PageHeader } from "@/components/ui";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";

export default async function SupportPage(): Promise<JSX.Element> {
  const context = await getPageContext();
  const { data: orgs } = context?.isOps ? await context.admin.from("organizations").select("id,name,city,province,created_at").order("created_at", { ascending: false }).limit(100) : { data: [] };
  return (
    <AppShell>
      <PageHeader title="Customer Support" body="Support context excludes private document downloads." />
      <div className="grid gap-4">{(orgs ?? []).map((org: any) => <Card key={org.id}><h2 className="font-semibold">{org.name}</h2><p className="text-sm text-muted-foreground">{org.city ?? org.province ?? "Pakistan"}</p></Card>)}</div>
    </AppShell>
  );
}
