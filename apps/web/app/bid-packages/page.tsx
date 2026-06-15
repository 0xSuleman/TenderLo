import { AppShell } from "@/components/nav";
import { Badge, Card, PageHeader } from "@/components/ui";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";

export default async function BidPackagesPage(): Promise<JSX.Element> {
  const context = await getPageContext();
  const { data: packages } = context ? await context.admin.from("bid_packages").select("*, tenders(title), bid_package_documents(*)").eq("organization_id", context.organizationId).order("created_at", { ascending: false }) : { data: [] };
  return (
    <AppShell>
      <PageHeader title="Bid Packages" body="Profile Vault documents assembled into tender-specific bid-readiness packs." />
      <div className="grid gap-4">{(packages ?? []).map((pkg: any) => <Card key={pkg.id}><div className="flex justify-between gap-3"><h2 className="font-semibold">{pkg.name}</h2><Badge>{pkg.status}</Badge></div><p className="text-sm text-muted-foreground">{pkg.tenders?.title} · {pkg.bid_package_documents?.length ?? 0} documents</p></Card>)}</div>
    </AppShell>
  );
}
