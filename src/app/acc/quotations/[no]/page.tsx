import { QuotationDocPage } from "@/components/quotation-doc-page";

export const metadata = { title: "เอกสารใบเสนอราคา (บัญชี) — ERP MAZ" };

export default async function Page({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  return <QuotationDocPage no={decodeURIComponent(no)} acc />;
}
