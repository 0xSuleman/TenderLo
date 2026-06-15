import { CalendarCheck } from "lucide-react";
import { MarketingNav } from "@/components/nav";
import { SectionReveal } from "@/components/motion";
import { Button, Card, Field, Input, PageHeader, Textarea } from "@/components/ui";

export default function DemoPage(): JSX.Element {
  return (
    <>
      <MarketingNav />
      <main className="mx-auto max-w-2xl px-4 py-12">
        <SectionReveal>
          <PageHeader title="Demo Request" body="For larger contractor teams, source coverage expansion, and manual invoice support." />
        </SectionReveal>
        <Card>
          <form action="mailto:sales@tenderlo.local" method="post" encType="text/plain" className="grid gap-4">
            <Field label="Company">
              <Input name="company" required />
            </Field>
            <Field label="Email">
              <Input name="email" type="email" required />
            </Field>
            <Field label="Contractor focus">
              <Textarea name="focus" />
            </Field>
            <Button type="submit"><CalendarCheck className="h-4 w-4" />Request demo</Button>
          </form>
        </Card>
      </main>
    </>
  );
}
