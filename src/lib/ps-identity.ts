"use client";

/*
 * ใครในทีมก่อนการขายกำลังใช้ระบบอยู่ (เจ้าของถาม 5 ต.ค. 2569 "แล้วของ BD ล่ะ")
 *
 * บทบาท "ทีมก่อนการขาย" ไม่ใช่คนเดียว — SA ทำข้อเสนอเชิงเทคนิค BD ทำข้อเสนอเชิงธุรกิจ
 * เดิมระบบตรึงไว้ที่ SA คนเดียว (ROLE_EMPLOYEE.ps) BD จึงไม่มีทางเข้ามาเป็นตัวเอง
 * ชื่อผู้รับงาน ตารางงาน และเมนู "ของฉัน" ต้องเป็นของคนที่เลือก เหมือนที่บทบาทพนักงานทำอยู่
 *
 * เก็บแค่รหัสพนักงาน ข้อมูลอื่นอ่านจากทะเบียนฝ่ายบุคคลเสมอ (ดู staff-identity.ts ที่ใช้กติกาเดียวกัน)
 *
 * ต่อฐานข้อมูลแล้ว (ผู้ใช้สั่ง 25 พ.ย. 2569) — ตัวตนมาจากบัญชีที่ล็อกอินจริง
 * ไม่ใช่ตัวเลือกในเครื่องอีกแล้ว ล็อกอินเป็น ธนดล แล้วชื่อผู้รับงานต้องเป็นธนดล
 * บัญชีที่ไม่มีแถวในทะเบียน (หรือ dev ที่ยังไม่มีคีย์) ถอยไปใช้ตัวเลือกในเครื่องเหมือนเดิม
 */

import { useSyncExternalStore } from "react";
import { HR_EMP, ROLE_EMPLOYEE, hrPos, type Employee } from "./hr-data";
import { createPersistedStore } from "./persisted-store";
import { hrSnapshot, subscribeHr } from "./hr-store";
import { hasBackend } from "./supabase/env";
import { loadMe, meNow, subscribeMe } from "./supabase/me";

const DEFAULT_ID = ROLE_EMPLOYEE.ps ?? "E01";

/** ตำแหน่งที่ทำงานก่อนการขาย — ตรงกับ POSITION_ROLES ที่ให้บทบาท ps กับสองตำแหน่งนี้ */
const PS_POS = ["sa", "bd"];

const store = createPersistedStore<string>(
  "maz-erp.ps-emp.v1",
  DEFAULT_ID,
  (v): v is string => typeof v === "string",
);

const live = hasBackend;

/** ทะเบียนที่ใช้ตัดสิน — ของจริงจากฐานข้อมูลถ้ามี ไม่มีก็ชุดตั้งต้น */
function register(): Employee[] {
  const db = live ? hrSnapshot().emp : [];
  return db.length ? db : HR_EMP;
}

/** คนในทีมก่อนการขายที่เลือกเป็นผู้ใช้ได้ — ยังทำงานอยู่และตำแหน่งเป็น SA หรือ BD */
export function psTeam(): Employee[] {
  return register().filter((e) => e.status === "active" && PS_POS.includes(e.pos));
}

/**
 * ตัวตนจากบัญชีที่ล็อกอินอยู่ — null คือยังไม่รู้ หรือบัญชีนี้ไม่ได้ทำงานก่อนการขาย
 *
 * อ่านจาก "ฉันเป็นใคร" ตรง ๆ ไม่ผ่านทะเบียนฝ่ายบุคคล เพราะบัญชีทั่วไปอ่านทะเบียน
 * ทั้งก้อนไม่ได้ (เป็นข้อมูลของฝ่ายบุคคล) แต่อ่านข้อมูลของตัวเองได้เสมอ
 */
function psFromAccount(): { id: string; name: string; pos: string } | null {
  if (!live) return null;
  loadMe();
  const me = meNow();
  if (!me?.empNo || !PS_POS.includes(me.pos)) return null;
  return { id: me.empNo, name: me.name, pos: me.pos };
}

/** รหัสพนักงานของบัญชีที่ล็อกอินอยู่ — ว่างคือยังไม่รู้ */
function meId(): string {
  return psFromAccount()?.id ?? "";
}

/**
 * รหัสพนักงานของคนที่ใช้ระบบอยู่
 * บัญชีที่ล็อกอินมาก่อน — ตัวเลือกในเครื่องใช้เฉพาะตอนที่ยังไม่รู้ว่าบัญชีนี้เป็นใคร
 * คนที่ถูกลบหรือย้ายตำแหน่งไปแล้วถอยกลับไปคนตั้งต้น
 */
export function psEmployeeId() {
  const mine = meId();
  if (mine) return mine;
  const id = store.get();
  return psTeam().some((e) => e.id === id) ? id : DEFAULT_ID;
}

export function psEmployee(): Employee | undefined {
  const id = psEmployeeId();
  return register().find((e) => e.id === id);
}

/** สลับคนที่ใช้ระบบ — ใช้ได้เฉพาะตอนยังไม่ต่อฐานข้อมูล ของจริงเปลี่ยนด้วยการล็อกอินบัญชีนั้น */
export function setPsEmployee(id: string) {
  if (live) return;
  store.set(id);
}

/* ตัวตนเปลี่ยนได้สามทาง — สลับในเครื่อง · รู้ว่าบัญชีนี้เป็นใคร · ทะเบียนฝ่ายบุคคลเปลี่ยน */
export function subscribePsEmployee(onChange: () => void) {
  const off = [store.subscribe(onChange), ...(live ? [subscribeMe(onChange), subscribeHr(onChange)] : [])];
  return () => {
    for (const fn of off) fn();
  };
}

export function usePsEmployeeId() {
  return useSyncExternalStore(subscribePsEmployee, psEmployeeId, () => DEFAULT_ID);
}

/** ชื่อในคิวงานตามต้นแบบ "ปิยะวัฒน์ (SA)" — ชื่อต้นกับตำแหน่งของคนที่ใช้อยู่ */
export function psMeOf(id: string) {
  /* บัญชีที่ล็อกอินอยู่ไม่ต้องไปหาในทะเบียน ชื่อกับตำแหน่งมาจาก "ฉันเป็นใคร" อยู่แล้ว */
  const mine = psFromAccount();
  const from = mine && mine.id === id ? mine : undefined;
  const list = register();
  const e = from ?? list.find((x) => x.id === id) ?? list.find((x) => x.id === DEFAULT_ID) ?? HR_EMP.find((x) => x.id === DEFAULT_ID)!;
  const pos = hrPos(e.pos as Employee["pos"]).label;
  return {
    name: `${e.name.split(" ")[0]} (${pos})`,
    full: e.name,
    employeeId: e.id,
    /* ประเภทงานที่คนนี้ถนัด — ใช้บอกว่าเป็น SA หรือ BD ไม่ได้ใช้กรองกล่องงาน */
    kind: (e.pos === "bd" ? "BD" : "SA") as "SA" | "BD",
  };
}
