"use client";

/*
 * ใครในทีมก่อนการขายกำลังใช้ระบบอยู่ (เจ้าของถาม 5 ต.ค. 2569 "แล้วของ BD ล่ะ")
 *
 * บทบาท "ทีมก่อนการขาย" ไม่ใช่คนเดียว — SA ทำข้อเสนอเชิงเทคนิค BD ทำข้อเสนอเชิงธุรกิจ
 * เดิมระบบตรึงไว้ที่ SA คนเดียว (ROLE_EMPLOYEE.ps) BD จึงไม่มีทางเข้ามาเป็นตัวเอง
 * ชื่อผู้รับงาน ตารางงาน และเมนู "ของฉัน" ต้องเป็นของคนที่เลือก เหมือนที่บทบาทพนักงานทำอยู่
 *
 * เก็บแค่รหัสพนักงาน ข้อมูลอื่นอ่านจากทะเบียนฝ่ายบุคคลเสมอ (ดู staff-identity.ts ที่ใช้กติกาเดียวกัน)
 * TODO: ต่อ backend แล้วอ่านจากบัญชีที่ล็อกอินจริง ไม่ใช่ตัวเลือกในเครื่อง
 */

import { useSyncExternalStore } from "react";
import { HR_EMP, ROLE_EMPLOYEE, hrPos, type Employee } from "./hr-data";
import { createPersistedStore } from "./persisted-store";

const DEFAULT_ID = ROLE_EMPLOYEE.ps ?? "E01";

/** ตำแหน่งที่ทำงานก่อนการขาย — ตรงกับ POSITION_ROLES ที่ให้บทบาท ps กับสองตำแหน่งนี้ */
const PS_POS = ["sa", "bd"];

const store = createPersistedStore<string>(
  "maz-erp.ps-emp.v1",
  DEFAULT_ID,
  (v): v is string => typeof v === "string",
);

/** คนในทีมก่อนการขายที่เลือกเป็นผู้ใช้ได้ — ยังทำงานอยู่และตำแหน่งเป็น SA หรือ BD */
export function psTeam(): Employee[] {
  return HR_EMP.filter((e) => e.status === "active" && PS_POS.includes(e.pos));
}

/** รหัสพนักงานของคนที่ใช้อยู่ — คนที่ถูกลบหรือย้ายตำแหน่งไปแล้วถอยกลับไปคนตั้งต้น */
export function psEmployeeId() {
  const id = store.get();
  return psTeam().some((e) => e.id === id) ? id : DEFAULT_ID;
}

export function psEmployee(): Employee | undefined {
  const id = psEmployeeId();
  return HR_EMP.find((e) => e.id === id);
}

export function setPsEmployee(id: string) {
  store.set(id);
}

export const subscribePsEmployee = store.subscribe;

export function usePsEmployeeId() {
  return useSyncExternalStore(store.subscribe, psEmployeeId, () => DEFAULT_ID);
}

/** ชื่อในคิวงานตามต้นแบบ "ปิยะวัฒน์ (SA)" — ชื่อต้นกับตำแหน่งของคนที่ใช้อยู่ */
export function psMeOf(id: string) {
  const e = HR_EMP.find((x) => x.id === id) ?? HR_EMP.find((x) => x.id === DEFAULT_ID)!;
  const pos = hrPos(e.pos).label;
  return {
    name: `${e.name.split(" ")[0]} (${pos})`,
    full: e.name,
    employeeId: e.id,
    /* ประเภทงานที่คนนี้ถนัด — ใช้บอกว่าเป็น SA หรือ BD ไม่ได้ใช้กรองกล่องงาน */
    kind: (e.pos === "bd" ? "BD" : "SA") as "SA" | "BD",
  };
}
