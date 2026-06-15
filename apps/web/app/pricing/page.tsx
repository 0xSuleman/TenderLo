import { CheckCircle2, Sparkles } from "lucide-react";
import { MarketingNav } from "@/components/nav";
import { MotionItem, MotionList, SectionReveal } from "@/components/motion";
import { Badge, Card, LinkButton, PageHeader } from "@/components/ui";

const plans = [
  ["Starter", "PKR 4,500", "Tender search, saved searches, basic alerts, limited Profile Vault", ["Published tender search", "Saved-search alerts", "Basic document readiness"]],
  ["Growth", "PKR 14,500", "Full Profile Vault, newspaper coverage, compliance checks, team access", ["Full Profile Vault", "PEC-aware recommendations", "Newspaper source coverage"]],
  ["Pro", "PKR 34,500", "Advanced reports, priority alerts, ops-reviewed tender data, Phase 2 tools", ["Advanced compliance reports", "Priority alerts", "Ops-reviewed tender data"]],
  ["Enterprise", "Manual", "Custom source monitoring, manual invoice, higher limits, priority ops support", ["Custom source monitoring", "Manual invoice support", "Priority ops support"]]
] as const;

export default function PricingPage(): JSX.Element {
  return (
    <>
      <MarketingNav />
      <main className="mx-auto max-w-6xl px-4 py-12">
        <PageHeader title="Pricing" body="Plans are packaged around contractor tender discovery, Profile Vault readiness, and bid-readiness intelligence." />
        <SectionReveal>
          <MotionList className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {plans.map(([name, price, body, features]) => (
              <MotionItem key={name}>
                <Card className={name === "Growth" ? "relative flex h-full flex-col overflow-hidden border-primary/40 shadow-glow" : "flex h-full flex-col"}>
                  {name === "Growth" ? <div className="premium-gradient-subtle absolute inset-x-0 top-0 h-1" /> : null}
                  <div className="flex items-center justify-between gap-3">
                    <Badge tone={name === "Growth" ? "good" : "muted"}>{name}</Badge>
                    {name === "Growth" ? <Sparkles className="h-4 w-4 text-secondary" /> : null}
                  </div>
                  <p className="mt-4 font-display text-3xl font-semibold">{price}</p>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{body}</p>
                  <ul className="mt-5 grid flex-1 gap-2 text-sm">
                    {features.map((feature) => (
                      <li key={feature} className="flex gap-2 leading-6">
                        <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-success" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <LinkButton className="mt-6 w-full" href={name === "Enterprise" ? "/demo" : "/signup"}>
                    {name === "Enterprise" ? "Request demo" : "Choose plan"}
                  </LinkButton>
                </Card>
              </MotionItem>
            ))}
          </MotionList>
        </SectionReveal>
      </main>
    </>
  );
}
