"use client";

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
      <a className="rounded-md px-2 py-1 font-display text-xl font-semibold text-foreground transition hover:bg-white/66" href="/">
        TenderLo
      </a>
      <div className="flex w-full min-w-0 flex-wrap items-center justify-start gap-1 text-sm font-medium sm:w-auto sm:justify-end sm:gap-3">
        {links.map((link) => (
          <a
            key={link.href}
            className={cn(
              "rounded-md px-2 py-2 text-muted-foreground transition duration-200 hover:bg-white/70 hover:text-foreground",
              pathname === link.href ? "bg-white/78 text-foreground shadow-sm" : null
            )}
            href={link.href}
          >
            {link.label}
          </a>
        ))}
        <a className="premium-gradient rounded-md px-3 py-2 font-semibold text-primary-foreground shadow-glow transition motion-safe:hover:-translate-y-0.5" href="/signup">
          Sign up
        </a>
      </div>
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }): JSX.Element {
  const pathname = usePathname();
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[268px_1fr]">
      <aside className="sticky top-0 z-30 border-b border-white/65 bg-white/72 p-3 shadow-soft backdrop-blur-xl lg:h-screen lg:border-b-0 lg:border-r lg:p-4">
        <div className="flex items-center justify-between gap-3 lg:block">
          <a className="block rounded-md px-2 py-2 font-display text-2xl font-semibold text-foreground transition hover:bg-white/70" href="/dashboard">
            TenderLo
          </a>
          <span className="hidden rounded-md border border-white/70 bg-white/70 px-2 py-1 text-xs font-semibold text-muted-foreground shadow-sm sm:inline-flex lg:mt-2">
            Contractor OS
          </span>
        </div>
        <nav className="mt-3 flex gap-1 overflow-x-auto pb-1 lg:grid lg:overflow-visible lg:pb-0">
          {appLinks.map((link) => {
            const Icon = link.icon;
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <a
                key={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex min-w-max items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition duration-200 hover:bg-white/76 hover:text-foreground hover:shadow-sm",
                  active ? "bg-white text-foreground shadow-soft" : null
                )}
                href={link.href}
              >
                <span className={cn("grid size-7 place-items-center rounded-md transition", active ? "premium-gradient text-primary-foreground" : "bg-white/58 text-primary group-hover:bg-white")}>
                  <Icon className="h-4 w-4" />
                </span>
                {link.label}
              </a>
            );
          })}
        </nav>
      </aside>
      <main className="p-4 lg:p-8">{children}</main>
    </div>
  );
}
