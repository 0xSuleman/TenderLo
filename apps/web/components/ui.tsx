import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Button({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return (
    <button
      className={cn(
        "premium-gradient inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold text-primary-foreground shadow-glow transition duration-200 motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0.5 disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export function LinkButton({ className, children, href }: { className?: string; children: ReactNode; href: string }): JSX.Element {
  return (
    <a
      className={cn(
        "premium-gradient inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold text-primary-foreground shadow-glow transition duration-200 motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0.5",
        className
      )}
      href={href}
    >
      {children}
    </a>
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div className={cn("premium-surface interactive-lift animate-rise rounded-lg border p-5", className)} {...props} />;
}

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "good" | "warn" | "bad" | "info" }): JSX.Element {
  const toneClass = {
    muted: "border-border/70 bg-white/62 text-muted-foreground",
    good: "border-emerald-200/80 bg-emerald-50/80 text-emerald-700",
    warn: "border-amber-200/90 bg-amber-50/88 text-amber-800",
    bad: "border-red-200/80 bg-red-50/88 text-red-700",
    info: "border-blue-200/80 bg-blue-50/82 text-blue-700"
  }[tone];
  return <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold shadow-sm backdrop-blur", toneClass)}>{children}</span>;
}

export function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <label className="grid gap-2 text-sm font-medium text-foreground">
      {label}
      {children}
    </label>
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return <input className={cn("premium-focus h-10 w-full rounded-md border border-border/80 bg-white/78 px-3 text-sm shadow-sm backdrop-blur placeholder:text-muted-foreground/70", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>): JSX.Element {
  return <textarea className={cn("premium-focus min-h-28 w-full rounded-md border border-border/80 bg-white/78 px-3 py-2 text-sm shadow-sm backdrop-blur placeholder:text-muted-foreground/70", className)} {...props} />;
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>): JSX.Element {
  return <select className={cn("premium-focus h-10 w-full rounded-md border border-border/80 bg-white/78 px-3 text-sm shadow-sm backdrop-blur", className)} {...props} />;
}

export function PageHeader({ eyebrow, title, body }: { eyebrow?: string; title: string; body?: string }): JSX.Element {
  return (
    <div className="mb-6">
      {eyebrow ? <p className="text-sm font-semibold uppercase tracking-normal text-primary">{eyebrow}</p> : null}
      <h1 className="mt-1 font-display text-3xl font-semibold text-foreground md:text-4xl">{title}</h1>
      {body ? <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{body}</p> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }): JSX.Element {
  return <div className={cn("shimmer-surface h-4 rounded-md", className)} />;
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }): JSX.Element {
  return (
    <Card className="grid place-items-center px-6 py-10 text-center">
      <div className="premium-gradient-subtle animate-float grid size-16 place-items-center rounded-lg border border-white/70 text-primary shadow-soft">
        {icon ?? <span className="text-2xl font-semibold">0</span>}
      </div>
      <h2 className="mt-4 text-lg font-semibold">{title}</h2>
      {body ? <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{body}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </Card>
  );
}

export function MetricCard({ label, value, detail, tone = "info" }: { label: string; value: ReactNode; detail?: string; tone?: "muted" | "good" | "warn" | "bad" | "info" }): JSX.Element {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <Badge tone={tone}>{detail ?? "live"}</Badge>
      </div>
      <p className="mt-3 font-display text-3xl font-semibold">{value}</p>
    </Card>
  );
}
