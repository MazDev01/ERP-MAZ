import { MyReviewsPage } from "@/components/my-reviews-page";

export const metadata = { title: "งานที่รอฉันตรวจ — ERP MAZ" };

/* ที่รวมของผู้ตรวจทุกบทบาท (รอบที่ 130) — ฝ่ายขายกับ BD ไม่มีเมนูของฝ่ายโครงการ
   จึงอยู่ใน SHARED_PAGES เปิดได้ทุกบทบาท แต่เห็นเฉพาะใบที่ตัวเองเป็นผู้ตรวจ */
export default function Page() {
  return <MyReviewsPage />;
}
