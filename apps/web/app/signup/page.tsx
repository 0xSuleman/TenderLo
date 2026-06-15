import { Building2, UserPlus } from "lucide-react";
import { MarketingNav } from "@/components/nav";
import { SectionReveal } from "@/components/motion";
import { Button, Card, Field, Input, PageHeader } from "@/components/ui";
import { signUpAction } from "../auth-actions";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function SignupPage({ searchParams }: { searchParams?: SearchParams }): Promise<JSX.Element> {
  const params = searchParams ? await searchParams : {};
  const error = firstParam(params.error);
  const next = firstParam(params.next);

  return (
    <>
      <MarketingNav />
      <main className="mx-auto grid max-w-5xl gap-6 px-4 py-12 md:grid-cols-[1fr_420px] md:items-center">
        <SectionReveal>
          <PageHeader title="Sign up" body="Create an owner account for your contractor company." />
          <Card className="hidden md:block">
            <div className="grid size-12 place-items-center rounded-lg border border-white/70 bg-white/76 text-primary shadow-sm">
              <Building2 className="h-6 w-6" />
            </div>
            <h2 className="mt-4 font-display text-2xl font-semibold">Start with the company record, then complete PEC and document readiness.</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">TenderLo is built for Pakistani contractor teams that need better tender discovery, compliance checks, and bid-preparation visibility.</p>
          </Card>
        </SectionReveal>
        <Card>
          <form action={signUpAction} className="grid gap-4">
            {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}
            {next ? <input name="next" type="hidden" value={next} /> : null}
            <Field label="Full name">
              <Input name="full_name" required />
            </Field>
            <Field label="Email">
              <Input name="email" type="email" required />
            </Field>
            <Field label="Password">
              <Input name="password" type="password" minLength={8} required />
            </Field>
            <Field label="Confirm password">
              <Input name="confirm_password" type="password" minLength={8} required />
            </Field>
            <Button type="submit"><UserPlus className="h-4 w-4" />Create account</Button>
            <p className="text-sm text-muted-foreground">
              Already registered? <a className="font-semibold text-primary" href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}>Sign in</a>
            </p>
          </form>
        </Card>
      </main>
    </>
  );
}
