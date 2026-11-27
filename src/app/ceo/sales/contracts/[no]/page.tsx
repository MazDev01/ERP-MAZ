import { ContractPage } from "@/components/contract-page";
import { CeoView } from "@/components/ceo-view";

export const metadata = { title: "ใบสัญญา — ERP MAZ" };

/*
 * ใบสัญญาของดีลสำหรับผู้บริหาร — ดูอย่างเดียว (รอบที่ 147 · ยกมาจาก ERP_Test)
 * ปุ่ม "ดูใบสัญญา" ในหน้าดีลของผู้บริหารชี้มาที่นี่อยู่แล้ว แต่ยังไม่มีหน้า กดแล้วเจอหน้าไม่พบ
 * ?v=n เปิดฉบับเก่า · ?pdf=1 เปิดหน้าต่างบันทึก PDF (กติกาเดียวกับฝั่งฝ่ายขาย)
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ no: string }>;
  searchParams: Promise<{ v?: string; pdf?: string }>;
}) {
  const { no } = await params;
  const { v, pdf } = await searchParams;
  return (
    <CeoView>
      <ContractPage dealNo={decodeURIComponent(no)} v={v ? Number(v) : undefined} pdf={pdf === "1"} ceo />
    </CeoView>
  );
}
