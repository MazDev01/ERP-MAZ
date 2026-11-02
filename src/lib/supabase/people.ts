"use client";

import { supabase } from "./client";
import type { Role } from "../role";

/*
 * รายชื่อพนักงาน — ที่เดียวที่แปลงระหว่าง "รหัสพนักงาน" ของฐานข้อมูลกับ
 * "ชื่อ" และ "บทบาท" ที่หน้าจออ่านอยู่เดิม
 *
 * หน้าจอชุดเดิมอ้างคนด้วยชื่อ (LeaveRecord.employee) และหั่นข้อมูลตามบทบาท
 * ฐานข้อมูลอ้างด้วย uuid และเก็บบทบาทไว้ที่ตำแหน่งงาน (employees.position)
 * ชั้นนี้จึงทำหน้าที่แปลงให้ ไม่ต้องรื้อหน้าจอทั้งระบบ
 *
 * โหลดครั้งเดียวต่อการเปิดหน้า เพราะรายชื่อแทบไม่เปลี่ยนระหว่างใช้งาน
 * ฝ่ายบุคคลเพิ่มคนใหม่แล้วรีเฟรชหน้าก็เห็น
 */

export type Person = {
  id: string;
  empNo: string;
  name: string;
  role: Role;
};

let cache: Person[] | null = null;
let pending: Promise<Person[]> | null = null;
let mineId: string | null = null;

type Row = {
  id: string;
  emp_no: string;
  first_name: string;
  last_name: string | null;
  nick: string | null;
  position: string;
};

/** ชื่อที่หน้าจอใช้เรียกคน — ชื่อจริง + นามสกุล เหมือน USERS ในข้อมูลจำลอง */
function nameOf(r: Row) {
  return [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || r.emp_no;
}

export async function loadPeople(): Promise<Person[]> {
  if (cache) return cache;
  if (pending) return pending;
  const sb = supabase();
  if (!sb) return [];

  pending = (async () => {
    const { data } = await sb
      .from("employees")
      .select("id, emp_no, first_name, last_name, nick, position")
      .order("emp_no");
    cache = ((data ?? []) as unknown as Row[]).map((r) => ({
      id: r.id,
      empNo: r.emp_no,
      name: nameOf(r),
      role: r.position as Role,
    }));
    /* รหัสของคนที่ล็อกอินอยู่ — ถามฐานข้อมูลเพราะ RLS เป็นคนตัดสิน ไม่ใช่ค่าใน token */
    const { data: me } = await sb.rpc("my_employee_id");
    mineId = typeof me === "string" ? me : null;
    pending = null;
    return cache;
  })();
  return pending;
}

export function peopleNow(): Person[] {
  return cache ?? [];
}

/** รหัสพนักงานของคนที่ล็อกอินอยู่ — null เมื่อยังไม่โหลดหรือบัญชียังไม่ผูกกับพนักงาน */
export function myId(): string | null {
  return mineId;
}

export function personById(id: string): Person | null {
  return (cache ?? []).find((p) => p.id === id) ?? null;
}

/** ชื่อของคนนั้น — คืนค่าว่างเมื่อยังไม่รู้จัก ปล่อยให้หน้าจอตัดสินเอง */
export function nameById(id: string): string {
  return personById(id)?.name ?? "";
}

/** บทบาทของคนนั้น — ใช้หั่นข้อมูลให้เข้ารูป Record<Role, T> ที่หน้าจอเดิมใช้ */
export function roleById(id: string): Role | null {
  return personById(id)?.role ?? null;
}

/** ล้างแคช — ใช้หลังฝ่ายบุคคลเพิ่มหรือแก้พนักงาน */
export function forgetPeople() {
  cache = null;
  pending = null;
  mineId = null;
}
