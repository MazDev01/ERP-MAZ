import { PmSchedulePage } from "@/components/pm-schedule-page";

export const metadata = { title: "ตารางงาน — ERP MAZ" };

/* ตารางงานของฝ่ายขาย — รูปแบบเดียวกับของ PM ผู้เข้าร่วมเป็นผู้สนใจ (ยกมาจากระบบต้นฉบับ) */
export default function Page() {
  return <PmSchedulePage sales />;
}
