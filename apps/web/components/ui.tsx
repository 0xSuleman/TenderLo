import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Button({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return (
    <button
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
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
        "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition duration-150 active:scale-[0.98]",
        className
      )}
      href={href}
    >
      {children}
    </a>
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div className={cn("card lift animate-in", className)} {...props} />;
}

export function Badge({ children, tone = "muted", className }: { children: ReactNode; tone?: "muted" | "good" | "warn" | "bad" | "info"; className?: string }): JSX.Element {
  const toneClass = {
    muted: "border-border bg-surface-raised text-muted-foreground",
    good: "border-success/30 bg-success-bg text-success",
    warn: "border-warning/30 bg-warning-bg text-warning",
    bad: "border-destructive/30 bg-destructive-bg text-destructive",
    info: "border-border bg-slate-100 text-slate-700"
  }[tone];
  return <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold shadow-sm", toneClass, className)}>{children}</span>;
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
  return <input className={cn("field-input", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>): JSX.Element {
  return <textarea className={cn("field-input min-h-28 py-2", className)} {...props} />;
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>): JSX.Element {
  return <select className={cn("field-input pr-8", className)} {...props} />;
}

export function PageHeader({ eyebrow, title, body }: { eyebrow?: string; title: string; body?: string }): JSX.Element {
  return (
    <div className="mb-8">
      {eyebrow ? <p className="text-sm font-bold uppercase tracking-wider text-primary">{eyebrow}</p> : null}
      <h1 className="mt-1 font-display text-4xl font-extrabold tracking-tight text-foreground">{title}</h1>
      {body ? <p className="mt-2 max-w-3xl text-base leading-relaxed text-muted-foreground">{body}</p> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }): JSX.Element {
  return <div className={cn("skeleton h-4", className)} />;
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }): JSX.Element {
  return (
    <Card className="grid place-items-center px-6 py-12 text-center border-dashed">
      <div className="grid size-14 place-items-center rounded-xl bg-primary-light text-primary border border-primary/10 mb-4 animate-bounce [animation-duration:3s]">
        {icon ?? <span className="text-xl font-bold">0</span>}
      </div>
      <h2 className="text-lg font-bold text-foreground">{title}</h2>
      {body ? <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{body}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </Card>
  );
}

export function MetricCard({ label, value, detail, tone = "info" }: { label: string; value: ReactNode; detail?: string; tone?: "muted" | "good" | "warn" | "bad" | "info" }): JSX.Element {
  return (
    <Card className="flex flex-col justify-between">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-muted-foreground">{label}</p>
        {detail ? <Badge tone={tone}>{detail}</Badge> : null}
      </div>
      <p className="mt-4 font-display text-4xl font-extrabold tracking-tight text-foreground">{value}</p>
    </Card>
  );
}
