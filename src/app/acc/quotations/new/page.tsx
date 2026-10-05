import { Suspense } from "react";
import { QuotationNewPage } from "@/components/quotation-new-page";

export const metadata = { title: "สร้างใบเสนอราคา (บัญชี) — ERP MAZ" };

export default function Page() {
  /* ฝั่งบัญชีเลือกได้เฉพาะลูกค้าที่ปิดการขายแล้ว และลิงก์อยู่ในหน้าของบัญชี */
  return (
    <Suspense fallback={null}>
      <QuotationNewPage acc />
    </Suspense>
  );
}
