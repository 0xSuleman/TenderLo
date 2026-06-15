import { FileUp, FolderOpen } from "lucide-react";
import { AppShell } from "@/components/nav";
import { MotionItem, MotionList } from "@/components/motion";
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui";
import { getPageContext } from "@/lib/page-context";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DocumentsPage(): Promise<JSX.Element> {
  const context = await getPageContext();
  const { data: docs } = context ? await context.admin.from("profile_documents").select("*").eq("organization_id", context.organizationId).order("created_at", { ascending: false }) : { data: [] };
  return (
    <AppShell>
      <PageHeader title="Document Manager" body="Private Profile Vault documents are stored in signed-url buckets." />
      <Card>
        <form action="/api/company-profile/documents" method="post" encType="multipart/form-data" className="grid gap-4 md:grid-cols-[180px_1fr_180px_auto]">
          <Field label="Type">
            <Select name="document_type">
              {["pec_license", "tax_certificate", "experience_certificate", "audited_financials", "bank_letter", "insurance", "guarantee"].map((item) => <option key={item}>{item}</option>)}
            </Select>
          </Field>
          <Field label="File"><Input className="cursor-pointer border-dashed bg-white/68 file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-foreground" name="file" type="file" required /></Field>
          <Field label="Expiry"><Input name="expiry_date" type="date" /></Field>
          <Button className="mt-7" type="submit"><FileUp className="h-4 w-4" />Upload</Button>
        </form>
      </Card>
      {(docs ?? []).length === 0 ? (
        <div className="mt-6">
          <EmptyState
            body="Upload PEC, tax, financial, insurance, guarantee, and experience documents to improve bid-readiness checks."
            icon={<FolderOpen className="h-7 w-7" />}
            title="No profile documents yet"
          />
        </div>
      ) : (
        <MotionList className="mt-6 grid gap-4">
          {(docs ?? []).map((doc: any) => (
            <MotionItem key={doc.id}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{doc.original_filename}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{doc.document_type} · expires {formatDate(doc.expiry_date)}</p>
                  </div>
                  <Badge tone={doc.verification_status === "verified" ? "good" : doc.verification_status === "expired" ? "bad" : "warn"}>{doc.verification_status}</Badge>
                </div>
              </Card>
            </MotionItem>
          ))}
        </MotionList>
      )}
    </AppShell>
  );
}
