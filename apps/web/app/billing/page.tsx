import { CreditCard, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/nav";
import { Badge, Button, Card, PageHeader, Select } from "@/components/ui";
import { getPageContext } from "@/lib/page-context";
import { startCheckoutAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function BillingPage(): Promise<JSX.Element> {
  const context = await getPageContext();
  const { data: subscription } = context ? await context.admin.from("subscriptions").select("*").eq("organization_id", context.organizationId).order("created_at", { ascending: false }).limit(1).maybeSingle() : { data: null };
  return (
    <AppShell>
      <PageHeader title="Billing" body="Subscription state and plan limits are enforced server-side." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm text-muted-foreground">Current plan</p>
              <p className="mt-2 font-display text-4xl font-semibold capitalize">{subscription?.plan ?? "starter"}</p>
              <p className="mt-2 text-sm text-muted-foreground">Plan and payment state are verified server-side before premium tender fields unlock.</p>
            </div>
            <Badge tone={subscription?.status === "active" || subscription?.status === "manual_invoice" ? "good" : "warn"}>{subscription?.status ?? "trialing"}</Badge>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Badge tone="info"><ShieldCheck className="h-3.5 w-3.5" />Server verified</Badge>
            <Badge>PayFast</Badge>
          </div>
        </Card>
        <Card>
          <div className="mb-4 grid size-10 place-items-center rounded-lg bg-white/72 text-primary shadow-sm">
            <CreditCard className="h-5 w-5" />
          </div>
          <h2 className="mb-3 font-display text-xl font-semibold">Upgrade plan</h2>
          <form action={startCheckoutAction} className="grid gap-4">
            <Select name="plan" defaultValue="growth">
              <option value="starter">Starter</option>
              <option value="growth">Growth</option>
              <option value="pro">Pro</option>
            </Select>
            <Button type="submit"><CreditCard className="h-4 w-4" />Open PayFast checkout</Button>
          </form>
        </Card>
      </div>
    </AppShell>
  );
}
