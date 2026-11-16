"use client";

/*
 * พนักงานคนไหนกำลังใช้ระบบอยู่ (เจ้าของสั่ง 29 ก.ย. 2569)
 *
 * บทบาท "พนักงาน" ไม่ใช่คนเดียว — มีทั้ง SA, Dev, Graphic, Content, Website, Media, BD
 * งานที่ได้รับ ตารางงาน และชื่อบนโปรไฟล์ต้องเป็นของคนที่เลือก ไม่ใช่กมลชนกตายตัว
 *
 * เก็บแค่รหัสพนักงาน ข้อมูลอื่นอ่านจากทะเบียนฝ่ายบุคคลเสมอ
 * (ฝ่ายบุคคลแก้ตำแหน่งแล้วต้องเปลี่ยนตาม ไม่ใช่ค้างค่าที่คัดลอกไว้)
 *
 * ต่อฐานข้อมูลแล้ว "ฉันเป็นใคร" มาจากบัญชีที่ล็อกอินจริง (supabase/me)
 * ตัวเลือกในเครื่องเหลือไว้ใช้ตอนไม่มีฐานข้อมูล (เดโม) เท่านั้น
 * ไม่งั้นล็อกอินเป็นคนหนึ่ง แต่ใบลา สลิป และวันลาคงเหลือเป็นของอีกคน
 */

import { useSyncExternalStore } from "react";
import { HR_EMP, HR_EMPTYPE, ROLE_EMPLOYEE, hrPos, type Employee } from "./hr-data";
import { createPersistedStore } from "./persisted-store";
import { meNow, subscribeMe } from "./supabase/me";

const DEFAULT_ID = ROLE_EMPLOYEE.staff ?? "E05";

const store = createPersistedStore<string>(
  "maz-erp.staff-emp.v1",
  DEFAULT_ID,
  (v): v is string => typeof v === "string",
);

/* ตำแหน่งที่มีหน้าจอของตัวเองอยู่แล้ว เข้าระบบเป็นบทบาทนั้นโดยตรง ไม่ใช่ "พนักงาน"
   แม่บ้านใช้ระบบเฉพาะส่วน "ของฉัน" จึงยังเข้าเป็นพนักงานได้ (เอกสารตำแหน่ง 29 ก.ย. 2569) */
const NOT_TEAM = ["gm", "pm", "acc", "hr", "account_hr", "sales"];
/* คนที่ผูกกับบทบาทอื่นไว้แล้ว (ขาย ก่อนการขาย PM บัญชี บุคคล GM) */
const BOUND = new Set(Object.values(ROLE_EMPLOYEE).filter((id) => id !== DEFAULT_ID));

/** พนักงานที่เลือกเป็นผู้ใช้ได้ — คนที่ยังทำงานอยู่และไม่ได้ผูกกับบทบาทอื่น */
export function staffTeam(): Employee[] {
  return HR_EMP.filter(
    (e) => e.status === "active" && !NOT_TEAM.includes(e.pos) && (!BOUND.has(e.id) || e.id === DEFAULT_ID),
  );
}

/**
 * รหัสพนักงานของคนที่ล็อกอินอยู่
 * ล็อกอินจริงแล้วใช้รหัสจากบัญชี — ตัวเลือกในเครื่องใช้เฉพาะตอนยังไม่รู้ว่าเป็นใคร
 * คนที่ถูกลบหรือพ้นสภาพไปแล้วถอยกลับไปคนตั้งต้น
 */
export function staffEmployeeId() {
  const mine = meNow()?.empNo;
  if (mine) return mine;
  const id = store.get();
  return staffTeam().some((e) => e.id === id) ? id : DEFAULT_ID;
}

/** รหัสพนักงานจากบัญชีที่ล็อกอิน — ว่างคือยังไม่รู้ หรือบัญชีนี้ไม่ใช่พนักงาน (ผู้บริหาร) */
export function myEmpNo() {
  return meNow()?.empNo ?? "";
}

export function staffEmployee(): Employee | undefined {
  const id = staffEmployeeId();
  return HR_EMP.find((e) => e.id === id);
}

export function setStaffEmployee(id: string) {
  store.set(id);
}

export function subscribeStaffEmployee(fn: () => void) {
  /* ทั้งตัวเลือกในเครื่องและ "ฉันเป็นใคร" จากฐานข้อมูล — อย่างหลังมาถึงหลัง hydrate */
  const offStore = store.subscribe(fn);
  const offMe = subscribeMe(fn);
  return () => {
    offStore();
    offMe();
  };
}

export function useStaffEmployeeId() {
  return useSyncExternalStore(subscribeStaffEmployee, staffEmployeeId, () => DEFAULT_ID);
}

/** ชื่อ + ตำแหน่ง สำหรับดรอปดาวน์เลือกคน — ทดลองงานกับฝึกงานกำกับไว้ด้วย เพราะกติกาวันลาต่างกัน */
export function staffLabel(e: Employee) {
  const type = e.type === "full" ? "" : ` · ${HR_EMPTYPE[e.type].label}`;
  return `${e.name} · ${hrPos(e.pos).label}${type}`;
}
