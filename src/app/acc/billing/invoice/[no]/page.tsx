import { AccInvoiceView } from "@/components/acc-doc";

export const metadata = { title: "ใบแจ้งหนี้ — ERP MAZ" };

/* ต้นแบบ invoice-view.html — อยู่ใต้เมนูวางบิล สิทธิ์เข้าหน้าตามเมนูนั้น (canVisit)
   ทุกงวดของดีลใช้เลขใบเดียวกัน (รอบที่ 117) จึงต้องบอกงวดมาที่ ?seq= ด้วย */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ no: string }>;
  searchParams: Promise<{ seq?: string }>;
}) {
  const { no } = await params;
  const { seq } = await searchParams;
  const n = Number(seq);
  return <AccInvoiceView no={decodeURIComponent(no)} seq={Number.isFinite(n) && n > 0 ? n : undefined} />;
}
