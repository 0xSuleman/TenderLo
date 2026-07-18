import type { LucideIcon } from "lucide-react";
import { ArrowRight, CheckCircle2, FileSearch, Newspaper, ShieldCheck, Check, Info } from "lucide-react";
import { MarketingNav } from "@/components/nav";
import { AnimatedNumber, MotionItem, MotionList, SectionReveal } from "@/components/motion";
import { Badge, Card, LinkButton } from "@/components/ui";

export default function HomePage(): JSX.Element {
  return (
    <div className="bg-white min-h-screen text-slate-900 font-sans">
      <MarketingNav />
      
      <main>
        {/* Hero Section */}
        <section className="relative overflow-hidden pt-20 pb-16">
          <div className="container text-center flex flex-col items-center relative z-10">
            <Badge tone="good" className="mb-4">Live In Pakistan</Badge>
            <h1 className="font-display text-5xl md:text-7xl font-extrabold tracking-tight text-slate-900 max-w-4xl leading-[1.08] mb-6">
              Find the right tenders.<br />Win more contracts.
            </h1>
            <p className="max-w-2xl text-lg md:text-xl leading-relaxed text-muted-foreground mb-8">
              PEC-aware tender discovery, Profile Vault readiness, and QA-verified Pakistani tender intelligence built for modern contractors.
            </p>
            <div className="flex flex-wrap gap-4 justify-center mb-16">
              <LinkButton href="/signup" className="h-12 px-6 rounded-lg text-base">
                Start Free Trial <ArrowRight className="h-4 w-4 ml-1" />
              </LinkButton>
              <LinkButton href="/tenders" className="h-12 px-6 rounded-lg text-base bg-white border border-border text-foreground hover:bg-slate-50">
                View Tenders
              </LinkButton>
            </div>
          </div>
        </section>

        {/* Bento Grid Feature Section */}
        <SectionReveal className="container pb-20">
          <div className="grid gap-6 md:grid-cols-3 max-w-6xl mx-auto">
            
            {/* Card 1: PEC Compliance */}
            <div className="card md:col-span-2 flex flex-col md:flex-row items-center justify-between gap-6 overflow-hidden">
              <div className="max-w-md">
                <div className="flex items-center gap-2 mb-3">
                  <span className="p-2 rounded-lg bg-emerald-50 text-success border border-success/10">
                    <ShieldCheck className="h-5 w-5" />
                  </span>
                  <span className="text-xs font-bold text-success uppercase tracking-wider">PEC Integration</span>
                </div>
                <h3 className="font-display text-2xl font-bold tracking-tight text-slate-900 mb-2">
                  PEC Compliance Check
                </h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Instantly verify license validity, contractor categories (C-A to C-6), local specialization codes, and geographical boundaries before purchase.
                </p>
              </div>
              <div className="relative flex items-center justify-center p-4">
                <div className="w-32 h-32 rounded-full border-4 border-dashed border-success/20 flex items-center justify-center animate-spin [animation-duration:15s] absolute" />
                <div className="w-24 h-24 rounded-full bg-success-bg text-success border border-success/20 flex items-center justify-center relative shadow-sm">
                  <Check className="h-10 w-10" />
                </div>
              </div>
            </div>

            {/* Card 2: RECON Recommendations */}
            <div className="card-dark flex flex-col justify-between relative overflow-hidden">
              <div>
                <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2 block">AI RECOMMENDATIONS</span>
                <h3 className="font-display text-2xl font-bold tracking-tight text-white mb-2">
                  RECON Score
                </h3>
                <p className="text-slate-400 text-sm leading-relaxed">
                  Get scored recommendations matching your PEC category, project size, and capability profile.
                </p>
              </div>
              <div className="mt-8 flex justify-center items-end relative h-28">
                {/* SVG Gauge */}
                <svg className="w-36 h-20" viewBox="0 0 100 50">
                  <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="#334155" strokeWidth="10" strokeLinecap="round" />
                  <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="#059669" strokeWidth="10" strokeLinecap="round" strokeDasharray="125 125" strokeDashoffset="40" />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-end">
                  <span className="text-4xl font-black text-white">60</span>
                  <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider mb-1">Match Score</span>
                </div>
              </div>
            </div>

            {/* Card 3: Active Tenders Stat */}
            <div className="card-dark flex flex-col justify-between">
              <div>
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">DATABASE COVERAGE</span>
                <h3 className="font-display text-4xl font-extrabold text-white tracking-tight">
                  <AnimatedNumber value={3800} suffix="+" />
                </h3>
              </div>
              <div>
                <h4 className="text-lg font-bold text-white mb-1">Active Tenders</h4>
                <p className="text-slate-400 text-sm leading-relaxed">
                  Real-time direct integration with provincial and federal portals, and daily OCR-processed newspaper feeds.
                </p>
              </div>
            </div>

            {/* Card 4: OCR Scanner */}
            <div className="card md:col-span-2 flex flex-col md:flex-row items-center justify-between gap-6 overflow-hidden">
              <div className="max-w-md">
                <div className="flex items-center gap-2 mb-3">
                  <span className="p-2 rounded-lg bg-emerald-50 text-success border border-success/10">
                    <Newspaper className="h-5 w-5" />
                  </span>
                  <span className="text-xs font-bold text-success uppercase tracking-wider">Local Processing</span>
                </div>
                <h3 className="font-display text-2xl font-bold tracking-tight text-slate-900 mb-2">
                  Newspaper OCR Scanning
                </h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Missing digital portals? We run offline newspaper advertisements and classifieds through local high-confidence Tesseract OCR pipelines.
                </p>
              </div>
              {/* Document Scan UI Mockup */}
              <div className="bg-slate-50 border border-border rounded-lg p-3 w-full md:w-56 shrink-0 relative overflow-hidden shadow-inner">
                <div className="h-1 bg-emerald-500 w-full rounded animate-bounce absolute left-0 right-0 top-1/2 -translate-y-1/2" />
                <div className="space-y-2 opacity-60">
                  <div className="h-3 bg-slate-300 w-1/3 rounded" />
                  <div className="h-2.5 bg-slate-200 w-full rounded" />
                  <div className="h-2.5 bg-slate-200 w-5/6 rounded" />
                  <div className="h-2.5 bg-slate-200 w-11/12 rounded" />
                  <div className="h-2.5 bg-slate-200 w-3/4 rounded" />
                </div>
              </div>
            </div>

          </div>
        </SectionReveal>

        {/* How It Works Section */}
        <section className="bg-slate-50 border-y border-border section">
          <div className="container max-w-6xl mx-auto text-center">
            <h2 className="font-display text-3xl md:text-5xl font-extrabold tracking-tight text-slate-900 mb-12">
              How it works
            </h2>
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Build Profile Vault", "Add your PEC details, tax registrations, financial references, and credentials to a private vault."],
                ["We scan all sources", "Provincial eProcurement databases, federal PPRA portals, and newspapers are index-processed daily."],
                ["Get recommendations", "Our PEC matching algorithms check prerequisites and flag bid-readiness alerts instantly."],
                ["Bid with confidence", "Export checklist packages containing the official scanned PDF files, forms, and audit paths."]
              ].map(([stepTitle, stepBody], index) => (
                <div key={stepTitle} className="text-center flex flex-col items-center px-4 animate-in delay-1">
                  <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground font-bold flex items-center justify-center mb-4">
                    {index + 1}
                  </div>
                  <h3 className="font-display text-lg font-bold text-slate-900 mb-2">{stepTitle}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{stepBody}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Client / Source Logos Grid */}
        <section className="container max-w-6xl mx-auto py-16 text-center">
          <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest block mb-8">
            MONITORED PORTALS & SOURCES
          </span>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 items-center opacity-85">
            {[
              ["Federal PPRA", "PPRA"],
              ["Punjab PPRA", "Punjab PPRA"],
              ["Sindh SPPRA", "Sindh SPPRA"],
              ["KPPRA", "KPPRA"]
            ].map(([long, short]) => (
              <div key={short} className="p-4 rounded-xl border border-border bg-slate-50/50 hover:bg-slate-100 transition duration-150 flex flex-col items-center">
                <span className="text-xs font-bold text-muted-foreground tracking-wide uppercase mb-1">Pakistan</span>
                <span className="font-display text-lg font-extrabold text-slate-900 tracking-tight">{short}</span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
