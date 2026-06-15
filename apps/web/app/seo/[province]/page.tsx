import { MarketingNav } from "@/components/nav";
import { Card, PageHeader } from "@/components/ui";

export default async function SeoProvincePage({ params }: { params: Promise<{ province: string }> }): Promise<JSX.Element> {
  const { province } = await params;
  const label = decodeURIComponent(province).replaceAll("-", " ");
  return (
    <>
      <MarketingNav />
      <main className="mx-auto max-w-5xl px-4 py-12">
        <PageHeader title={`${label} contractor tenders`} body="TenderLo tracks contractor-relevant tenders, public notices, and bid-readiness requirements." />
        <Card>
          <a className="font-medium text-primary" href={`/tenders?province=${encodeURIComponent(label)}`}>View tender previews</a>
        </Card>
      </main>
    </>
  );
}
