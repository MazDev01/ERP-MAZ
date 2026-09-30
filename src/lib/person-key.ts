"use client";

/*
 * "ช่องข้อมูลส่วนตัว" ของแต่ละคน (เจ้าของสั่ง 29 ก.ย. 2569 — เอาตามคน ไม่ใช่ตามบทบาท)
 *
 * ของส่วนตัว (ตอกบัตร ใบลา โอที ใบเบิก) เป็นของ "คน" ไม่ใช่ของบทบาท
 * บทบาทอื่นหนึ่งบทบาทคือหนึ่งคน คีย์จึงเป็นชื่อบทบาทตรง ๆ เหมือนเดิม ข้อมูลเก่าไม่หาย
 * แต่บทบาท "พนักงาน" มีหลายคนหลายตำแหน่ง คีย์จึงเป็น staff:<รหัสพนักงาน>
 *
 * TODO: ต่อ backend แล้วเปลี่ยนเป็นกรองด้วย employee_id ของผู้ล็อกอินจริง
 */

import { currentRole, subscribeRole, type Role } from "./role";
import { staffEmployeeId, staffTeam, subscribeStaffEmployee } from "./staff-identity";

/** คีย์ของคนที่ล็อกอินอยู่ */
export function personKey(role: Role = currentRole()) {
  return role === "staff" ? `staff:${staffEmployeeId()}` : role;
}

/** คีย์ทั้งหมดของบทบาทนั้น — พนักงานมีหลายคน บทบาทอื่นมีคนเดียว */
export function personKeysOf(role: Role): string[] {
  return role === "staff" ? staffTeam().map((e) => `staff:${e.id}`) : [role];
}

/** รหัสพนักงานที่อยู่ในคีย์ — ไม่ใช่คีย์ของพนักงานคืนค่าว่าง */
export function empIdOfKey(key: string) {
  return key.startsWith("staff:") ? key.slice("staff:".length) : "";
}

/* ข้อมูลส่วนตัวเปลี่ยนคนได้สองทาง — สลับบทบาท หรือสลับคนในทีม */
export function subscribePerson(onChange: () => void) {
  const off = [subscribeRole(onChange), subscribeStaffEmployee(onChange)];
  return () => off.forEach((fn) => fn());
}
