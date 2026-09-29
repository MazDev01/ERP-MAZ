"use client";

/*
 * ทางเข้าหน้าโปรเจคจากเมนูซ้าย
 *
 * ไม่ระบุ ?deal= = หน้ารายการโปรเจคแบบโฟลเดอร์ · ระบุ = รายละเอียดโปรเจคใบนั้น
 * ใช้พาธเดียวกันทั้งสองแบบ เพราะลิงก์จากแดชบอร์ด ฝ่ายบุคคล และบัญชี
 * ส่งมาเป็น /pm/projects?deal= อยู่แล้ว ทุกลิงก์จึงยังเปิดถูกใบโดยไม่ต้องไล่แก้
 */

import { useSearchParams } from "next/navigation";
import { PmProjectPage } from "./pm-project-page";
import { PmProjectsPage } from "./pm-projects-page";

export function PmProjectEntry() {
  const deal = useSearchParams().get("deal");
  return deal ? <PmProjectPage deal={deal} /> : <PmProjectsPage />;
}
