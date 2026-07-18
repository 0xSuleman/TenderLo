import type { LucideIcon } from "lucide-react";
import { ArrowRight, CheckCircle2, FileSearch, Newspaper, ShieldCheck } from "lucide-react";
import { MarketingNav } from "@/components/nav";
import { AnimatedNumber, MotionItem, MotionList, SectionReveal } from "@/components/motion";
import { Badge, Card, LinkButton } from "@/components/ui";

export default function HomePage(): JSX.Element {
  const features: Array<[string, string, LucideIcon]> = [
    ["Evidence-backed extraction", "Each tender fact stores method, confidence, evidence text, and verification status.", FileSearch],
    ["PEC-aware readiness", "Recommendations apply hard blockers first and keep unknowns visible.", ShieldCheck],
    ["Newspaper coverage", "Publicly accessible tender notices are handled with local OCR and QA review.", Newspaper]
  ];
  return (
    <>
      <MarketingNav />
      <main>
        <section className="relative min-h-[76vh] overflow-hidden text-white">
          <img
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            src="https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=1800&q=80"
          />
          <div className="absolute inset-0 bg-[linear-gradient(125deg,hsl(222_47%_11%/.88),hsl(213_80%_34%/.66)_50%,hsl(39_94%_54%/.50))]" />
          <div className="premium-grid absolute inset-0 opacity-30" />
          <div className="relative mx-auto flex min-h-[76vh] max-w-6xl flex-col justify-center px-4 py-16">
            <Badge tone="warn">Pakistan Tender Intelligence SaaS</Badge>
            <h1 className="mt-4 max-w-3xl font-display text-5xl font-semibold leading-tight md:text-7xl">TenderLo</h1>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-white/90">
              PEC-aware tender discovery, Profile Vault readiness, deterministic extraction, and ops QA for Pakistani contractors.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton href="/signup">
                Start workspace <ArrowRight className="h-4 w-4" />
              </LinkButton>
              <LinkButton className="bg-none bg-white/92 text-foreground shadow-soft backdrop-blur hover:bg-white" href="/tenders">
                View Tenders
              </LinkButton>
            </div>
            <div className="mt-10 grid max-w-2xl gap-3 sm:grid-cols-3">
              {[
                ["sources", 12, "Portal and newspaper adapters"],
                ["fields", 9, "Evidence-backed extraction fields"],
                ["plans", 4, "Contractor SaaS plans"]
              ].map(([key, value, label]) => (
                <div key={key} className="rounded-lg border border-white/20 bg-white/13 p-4 shadow-soft backdrop-blur">
                  <p className="font-display text-3xl font-semibold"><AnimatedNumber value={Number(value)} suffix="+" /></p>
                  <p className="mt-1 text-xs leading-5 text-white/76">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
        <SectionReveal className="mx-auto max-w-6xl px-4 py-10">
          <MotionList className="grid gap-4 md:grid-cols-3">
            {features.map(([title, body, Icon]) => (
              <MotionItem key={String(title)}>
                <Card>
                  <div className="mb-4 grid size-10 place-items-center rounded-lg border border-white/70 bg-white/72 text-primary shadow-sm">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h2 className="text-lg font-semibold">{title}</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
                </Card>
              </MotionItem>
            ))}
          </MotionList>
        </SectionReveal>
        <SectionReveal className="mx-auto max-w-6xl px-4 pb-12">
          <Card className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <Badge tone="info"><CheckCircle2 className="h-3.5 w-3.5" /> Contractor-only</Badge>
              <h2 className="mt-3 font-display text-2xl font-semibold">Built around bid-readiness, not generic tender alerts.</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Profile Vault, PEC category, specialization, geography, document readiness, and deadline window stay visible in the contractor workflow.</p>
            </div>
            <LinkButton href="/pricing">Compare plans</LinkButton>
          </Card>
        </SectionReveal>
      </main>
    </>
  );
}
