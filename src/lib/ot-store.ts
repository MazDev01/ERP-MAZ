"use client";
import { bkkStamp, nextDocNo } from "./format";
import { currentProfile } from "./profile-data";
import { settings } from "./system-settings";

import { OT_RECORDS, type OtRecord } from "./ot-data";
import type { Role } from "./role";
import { createRoleStore } from "./role-store";

/* คำขอโอทีของผู้ที่ล็อกอินอยู่ — แยกเก็บตามบทบาท เพราะหนึ่งบทบาทคือหนึ่งคน */
const store = createRoleStore<OtRecord[]>(
  "maz-erp.ot.v2",
  OT_RECORDS,
  (v): v is OtRecord[] => Array.isArray(v),
  undefined,
  /* หน้าอนุมัติมองทีมงานเป็นก้อนเดียว — รวมใบของทุกคนในบทบาทเข้าด้วยกัน */
  (list) => list.flat(),
  /* ทีมงานคนอื่นเริ่มจากไม่มีใบเลย ไม่ใช่ได้ใบตัวอย่างของคนตั้งต้นติดมา */
  [],
);

export function useOtRecords() {
  return store.use();
}

export function addOtRequest(input: {
  date: string;
  startMin: number;
  endMin: number;
  hours: number;
  reason: string;
}) {
  const record: OtRecord = {
    /* เลขที่ใบขอตาม ERD: OT-ปี พ.ศ.-ลำดับ เดินต่อกันทั้งบริษัท */
    id: nextDocNo(settings().docs.ot, store.all().flat().map((r) => r.id)),
    date: input.date,
    startMin: input.startMin,
    endMin: input.endMin,
    hours: input.hours,
    approvedHours: null,
    reason: input.reason,
    status: "รออนุมัติ",
    comment: "",
    employee: currentProfile().name,
    submittedAt: bkkStamp(),
  };
  store.update((rs) => [record, ...rs]);
  return record;
}

/*
 * ยกเลิกคำขอโอทีของตัวเอง — ได้เฉพาะใบที่ยังไม่ถูกตัดสิน
 * กันที่นี่เหมือนใบลา (cancelLeaveRequest) ไม่ใช่เชื่อว่าหน้าจอซ่อนปุ่มให้แล้ว
 * ใบที่อนุมัติไปแล้วถูกพลิกเป็น "ยกเลิก" = ชั่วโมงที่คิดเงินไปแล้วหายจากรอบ
 */
export function cancelOtRequest(id: string) {
  store.update((rs) =>
    rs.map((r) =>
      r.id === id && r.status === "รออนุมัติ" ? { ...r, status: "ยกเลิก" as const } : r,
    ),
  );
}

/**
 * แก้คำขอโอทีที่ยังรออนุมัติ (เจ้าของสั่ง 29 ก.ย. 2569)
 * เหมือนใบลา — ของเดิมต้องยกเลิกแล้วขอใหม่ ทิ้งเลขที่ใบไปเปล่า ๆ
 * แก้ได้เฉพาะใบที่ยังไม่ถูกตัดสิน · เลขที่ใบและเวลาที่ยื่นคงเดิม
 */
export function editOtRequest(
  id: string,
  patch: { date: string; startMin: number; endMin: number; hours: number; reason: string },
) {
  store.update((rs) =>
    rs.map((r) =>
      r.id === id && r.status === "รออนุมัติ"
        ? {
            ...r,
            date: patch.date,
            startMin: patch.startMin,
            endMin: patch.endMin,
            hours: patch.hours,
            reason: patch.reason.trim(),
            editedAt: bkkStamp(),
          }
        : r,
    ),
  );
}

/** คำขอโอทีของทุกบทบาท — หน้าอนุมัติเท่านั้น */
export function useAllOt() {
  return store.useAll();
}

/** หัวหน้าอนุมัติโอที — ปรับชั่วโมงที่อนุมัติได้ เช่นตัดตามเวลาตอกบัตรจริง */
export function approveOt(role: Role, id: string, approvedHours: number, comment: string) {
  store.updateRole(role, (rs) =>
    rs.map((r) =>
      r.id === id && r.status === "รออนุมัติ"
        ? { ...r, status: "อนุมัติแล้ว" as const, approvedHours, comment, decidedAt: bkkStamp() }
        : r,
    ),
  );
}

export function rejectOt(role: Role, id: string, comment: string) {
  store.updateRole(role, (rs) =>
    rs.map((r) =>
      r.id === id && r.status === "รออนุมัติ"
        ? { ...r, status: "ไม่อนุมัติ" as const, approvedHours: null, comment, decidedAt: bkkStamp() }
        : r,
    ),
  );
}

export function resetOtRecords() {
  store.reset();
}
