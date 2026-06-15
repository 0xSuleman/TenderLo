import { LogIn, ShieldCheck } from "lucide-react";
import { MarketingNav } from "@/components/nav";
import { SectionReveal } from "@/components/motion";
import { Button, Card, Field, Input, PageHeader } from "@/components/ui";
import { signInAction } from "../auth-actions";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function LoginPage({ searchParams }: { searchParams?: SearchParams }): Promise<JSX.Element> {
  const params = searchParams ? await searchParams : {};
  const error = firstParam(params.error);
  const message = firstParam(params.message);
  const next = firstParam(params.next);

  return (
    <>
      <MarketingNav />
      <main className="mx-auto grid max-w-5xl gap-6 px-4 py-12 md:grid-cols-[1fr_420px] md:items-center">
        <SectionReveal>
          <PageHeader title="Sign in" body="Access your contractor workspace." />
          <Card className="hidden md:block">
            <div className="grid size-12 place-items-center rounded-lg border border-white/70 bg-white/76 text-primary shadow-sm">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h2 className="mt-4 font-display text-2xl font-semibold">Profile Vault, recommendations, and compliance checks stay inside the SaaS workspace.</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">Authentication protects company documents, team settings, and paid tender intelligence through server-side Supabase session checks.</p>
          </Card>
        </SectionReveal>
        <Card>
          <form action={signInAction} className="grid gap-4">
            {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}
            {message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{message}</p> : null}
            {next ? <input name="next" type="hidden" value={next} /> : null}
            <Field label="Email">
              <Input name="email" type="email" required />
            </Field>
            <Field label="Password">
              <Input name="password" type="password" required />
            </Field>
            <Button type="submit"><LogIn className="h-4 w-4" />Sign in</Button>
            <p className="text-sm text-muted-foreground">
              Need an account? <a className="font-semibold text-primary" href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}>Create one</a>
            </p>
          </form>
        </Card>
      </main>
    </>
  );
}
