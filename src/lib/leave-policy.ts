"use client";

/*
 * กติกาวันลาตาม "ประเภทการจ้าง" (เอกสารสอบถามฝ่ายบุคคล ที่เจ้าของส่งมา 30 ก.ย. 2569)
 *
 *   พนักงานประจำ  มีสิทธิ์วันลาตามโควตา ลาในสิทธิ์แล้วยังได้เงินเดือนเต็ม
 *                 ลาเกินสิทธิ์หัก (ฐานเงินเดือน ÷ 30) × วันที่เกิน (ข้อ 5.1)
 *   ทดลองงาน      หยุดเสาร์-อาทิตย์เหมือนประจำ แต่ "ลาแล้วไม่จ่ายค่าจ้างเฉพาะส่วนที่ลา
 *                 จ่ายเฉพาะวันที่มางาน" (ข้อ 1.5) จึงไม่มีโควตาวันลา ลาได้ไม่จำกัดแต่ไม่ได้เงิน
 *                 ค่าจ้างเป็นรายวัน = ฐานเงินเดือน ÷ 22 วัน (ข้อ 1.2)
 *   ฝึกงาน        ไม่มีค่าจ้างและสลิป จึงไม่มีอะไรให้หัก · ไม่จำกัดวันลา · ฝ่ายบุคคลเป็นผู้อนุมัติ
 *
 * ลาไม่เต็มวันนับ "ตามชั่วโมง" ทุกประเภท (ข้อ 3.1) — ระบบคิดวันลาเป็นชั่วโมง ÷ ชั่วโมงทำงานต่อวันอยู่แล้ว
 */

import { useMemo } from "react";
import { HR_EMP, type EmpType } from "./hr-data";
import { useStaffEmployeeId } from "./staff-identity";
import { useRole, type Role } from "./role";
import { ROLE_EMPLOYEE } from "./hr-data";

export type LeavePolicy = {
  type: EmpType;
  /** มีโควตาวันลาไหม — ไม่มีคือลาได้ไม่จำกัดวัน */
  quota: boolean;
  /** ลาแล้วยังได้ค่าจ้างของช่วงที่ลาไหม */
  paid: boolean;
  /** ฝ่ายบุคคลเป็นผู้อนุมัติแทนสายปกติไหม (นักศึกษาฝึกงาน) */
  hrApproves: boolean;
  /** ข้อความอธิบายกติกาให้ผู้ยื่นอ่านก่อนกดส่ง */
  note: string;
};

const POLICY: Record<EmpType, LeavePolicy> = {
  full: {
    type: "full",
    quota: true,
    paid: true,
    hrApproves: false,
    note: "ลาในสิทธิ์ได้รับเงินเดือนเต็ม · ส่วนที่เกินสิทธิ์หักตามจำนวนวันที่เกิน",
  },
  probat: {
    type: "probat",
    quota: false,
    paid: false,
    hrApproves: false,
    note: "ช่วงทดลองงานจ่ายค่าจ้างเฉพาะวันที่มาทำงาน — ลาได้ แต่ช่วงที่ลาไม่ได้ค่าจ้าง (คิดตามชั่วโมงที่ลาจริง)",
  },
  intern: {
    type: "intern",
    quota: false,
    paid: false,
    hrApproves: true,
    note: "นักศึกษาฝึกงานลาได้ไม่จำกัดวัน ไม่มีการหักเงิน · ฝ่ายบุคคลเป็นผู้อนุมัติ",
  },
};

export function leavePolicyOf(type: EmpType): LeavePolicy {
  return POLICY[type] ?? POLICY.full;
}

/** ประเภทการจ้างของคนที่ล็อกอินอยู่ — พนักงานอ่านจากคนที่เลือกไว้ บทบาทอื่นอ่านจากคนที่ผูกไว้ */
export function empTypeOfRole(role: Role, staffId: string): EmpType {
  const id = role === "staff" ? staffId : ROLE_EMPLOYEE[role];
  return HR_EMP.find((e) => e.id === id)?.type ?? "full";
}

/** ประเภทการจ้างของคนที่ล็อกอินอยู่ — เมนู "ของฉัน" ใช้ตัดรายการที่ไม่เกี่ยวกับคนนั้น */
export function useMyEmpType(): EmpType {
  const role = useRole();
  const staffId = useStaffEmployeeId();
  return useMemo(() => empTypeOfRole(role, staffId), [role, staffId]);
}

export function useMyLeavePolicy(): LeavePolicy {
  const role = useRole();
  const staffId = useStaffEmployeeId();
  return useMemo(() => leavePolicyOf(empTypeOfRole(role, staffId)), [role, staffId]);
}
