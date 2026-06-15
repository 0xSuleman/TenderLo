import { Bell } from "lucide-react";
import { AppShell } from "@/components/nav";
import { MotionItem, MotionList } from "@/components/motion";
import { Button, Card, EmptyState, Field, Input, PageHeader } from "@/components/ui";
import { getPageContext } from "@/lib/page-context";
import { createSavedSearchAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function SavedSearchesPage(): Promise<JSX.Element> {
  const context = await getPageContext();
  const { data: searches } = context ? await context.admin.from("saved_searches").select("*").eq("organization_id", context.organizationId).order("created_at", { ascending: false }) : { data: [] };
  return (
    <AppShell>
      <PageHeader title="Saved Searches" body="Saved tender filters for immediate, daily, and weekly alerts." />
      <Card>
        <form action={createSavedSearchAction} className="grid gap-4 md:grid-cols-[180px_1fr_160px_160px_auto]">
          <Field label="Name"><Input name="name" required /></Field>
          <Field label="Keyword"><Input name="query" /></Field>
          <Field label="Province"><Input name="province" /></Field>
          <Field label="Sector"><Input name="sector" /></Field>
          <Button className="mt-7" type="submit">Save</Button>
        </form>
      </Card>
      {(searches ?? []).length === 0 ? (
        <div className="mt-6">
          <EmptyState
            body="Save tender filters to power immediate, daily, and weekly alert rules."
            icon={<Bell className="h-7 w-7" />}
            title="No saved searches yet"
          />
        </div>
      ) : (
        <MotionList className="mt-6 grid gap-4">
          {(searches ?? []).map((search: any) => (
            <MotionItem key={search.id}>
              <Card><h2 className="font-semibold">{search.name}</h2><p className="text-sm text-muted-foreground">{search.query || "All tenders"}</p></Card>
            </MotionItem>
          ))}
        </MotionList>
      )}
    </AppShell>
  );
}
