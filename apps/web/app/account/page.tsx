import { UserCircle } from "lucide-react";
import { AppShell } from "@/components/nav";
import { Card, PageHeader } from "@/components/ui";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";

export default async function AccountPage(): Promise<JSX.Element> {
  const context = await getPageContext();
  const { data: profile } = context ? await context.admin.from("profiles").select("*").eq("user_id", context.userId).maybeSingle() : { data: null };
  return (
    <AppShell>
      <PageHeader title="Account Settings" body="User profile and contractor workspace membership." />
      <Card>
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-lg bg-white/72 text-primary shadow-sm"><UserCircle className="h-6 w-6" /></div>
          <div>
            <h2 className="font-semibold">{profile?.full_name ?? "User"}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{profile?.phone ?? "No phone on file"}</p>
          </div>
        </div>
      </Card>
    </AppShell>
  );
}
