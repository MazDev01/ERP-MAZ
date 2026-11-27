import { Suspense } from "react";
import { AccWhtPage } from "@/components/acc-wht-page";

export const metadata = { title: "ยื่นภาษี — ERP MAZ" };

/* หน้านี้อ่าน ?month= เพื่อกลับมาเดือนเดิม จึงต้องหุ้ม Suspense */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <AccWhtPage />
    </Suspense>
  );
}
