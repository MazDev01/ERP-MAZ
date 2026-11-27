import { CeoView } from "@/components/ceo-view";
import { DealDetailPage } from "@/components/deal-detail-page";

export const metadata = { title: "รายละเอียดดีล — ERP MAZ" };

/*
 * รายละเอียดดีลสำหรับผู้บริหาร — ดูอย่างเดียว (รอบที่ 147 · ยกมาจาก ERP_Test)
 * อยู่ใต้ /ceo/sales จึงเป็นหน้าของผู้บริหารเอง ไม่ใช่การเข้าไปใช้หน้าของฝ่ายขาย
 * เดิมหน้ารายการดีลของผู้บริหารขึ้นเลขที่ดีลเป็นข้อความเฉย ๆ เพราะยังไม่มีหน้านี้
 */
export default async function Page({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  return (
    <CeoView>
      <DealDetailPage no={decodeURIComponent(no)} ceo />
    </CeoView>
  );
}
