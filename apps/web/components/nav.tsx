"use client";

import { useState } from "react";
import { Bell, BriefcaseBusiness, ClipboardCheck, FileSearch, Gauge, Settings, ShieldCheck, Users } from "lucide-react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const appLinks = [
  { href: "/dashboard", label: "Dashboard", icon: Gauge },
  { href: "/search", label: "Tender Search", icon: FileSearch },
  { href: "/recommendations", label: "Recommendations", icon: ShieldCheck },
  { href: "/profile", label: "Profile Vault", icon: BriefcaseBusiness },
  { href: "/saved-searches", label: "Saved Searches", icon: Bell },
  { href: "/billing", label: "Billing", icon: ClipboardCheck },
  { href: "/team", label: "Team", icon: Users },
  { href: "/admin/qa-tasks", label: "Ops QA", icon: Settings }
];

export function MarketingNav(): JSX.Element {
  const pathname = usePathname();
  const links = [
    { href: "/tenders", label: "Tender Preview" },
    { href: "/pricing", label: "Pricing" },
    { href: "/demo", label: "Demo" },
    { href: "/login", label: "Sign in" }
  ];
  return (
    <nav className="sticky top-0 z-40 mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 backdrop-blur-xl">
      <a className="rounded-md px-2 py-1 font-display text-xl font-bold tracking-tight text-foreground transition hover:bg-slate-100" href="/">
        TenderLo
      </a>
      <div className="flex w-full min-w-0 flex-wrap items-center justify-start gap-1 text-sm font-semibold sm:w-auto sm:justify-end sm:gap-3">
        {links.map((link) => (
          <a
            key={link.href}
            className={cn(
              "rounded-md px-2 py-2 text-muted-foreground transition duration-200 hover:bg-slate-100 hover:text-foreground",
              pathname === link.href ? "bg-slate-100 text-foreground shadow-sm" : null
            )}
            href={link.href}
          >
            {link.label}
          </a>
        ))}
        <a className="rounded-md bg-primary px-3 py-2 font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition duration-150 active:scale-[0.98]" href="/signup">
          Sign up
        </a>
      </div>
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }): JSX.Element {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50/50 flex flex-col">
      {/* Top Nav Header */}
      <header className="sticky top-0 z-40 w-full border-b border-border bg-white shadow-sm">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-8">
            <a className="font-display text-xl font-bold tracking-tight text-foreground" href="/dashboard">
              TenderLo
            </a>
            <nav className="hidden lg:flex items-center gap-1">
              {appLinks.map((link) => {
                const Icon = link.icon;
                const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
                return (
                  <a
                    key={link.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition duration-150 hover:bg-slate-100/80 hover:text-foreground",
                      active ? "bg-slate-100 text-foreground text-primary font-bold" : "text-muted-foreground"
                    )}
                    href={link.href}
                  >
                    <Icon className={cn("h-4 w-4", active ? "text-primary" : "text-muted-foreground")} />
                    {link.label}
                  </a>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <span className="hidden sm:inline-flex rounded-md border border-border bg-slate-50 px-2 py-1 text-xs font-bold text-muted-foreground">
              Contractor OS
            </span>
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="lg:hidden p-2 rounded-md border border-border text-muted-foreground hover:bg-slate-50"
              aria-label="Toggle Menu"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                {mobileOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        {mobileOpen && (
          <nav className="lg:hidden border-t border-border bg-white px-4 py-3 flex flex-col gap-1 shadow-inner animate-in">
            {appLinks.map((link) => {
              const Icon = link.icon;
              const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <a
                  key={link.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold transition duration-150 hover:bg-slate-50",
                    active ? "bg-primary-light text-primary" : "text-muted-foreground"
                  )}
                  href={link.href}
                >
                  <Icon className="h-4 w-4" />
                  {link.label}
                </a>
              );
            })}
          </nav>
        )}
      </header>

      {/* Main Content Area */}
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="animate-in">
          {children}
        </div>
      </main>
    </div>
  );
}
