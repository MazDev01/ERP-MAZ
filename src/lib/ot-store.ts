"use client";
import { bkkStamp, nextDocNo } from "./format";

import { OT_RECORDS, type OtRecord } from "./ot-data";
import type { Role } from "./role";
import { createRoleStore } from "./role-store";
import {
  OT_REASON,
  cancelOt as sbCancel,
  decideOt as sbDecide,
  fetchOt,
  fileOt,
  undoOt as sbUndo,
} from "./supabase/ot";

/* คำขอโอทีของผู้ที่ล็อกอินอยู่ — แยกเก็บตามบทบาท เพราะหนึ่งบทบาทคือหนึ่งคน
   ต่อฐานข้อมูลแล้วอ่านจากตาราง ot_requests แทน (วิธีเดียวกับใบลา) */
const store = createRoleStore<OtRecord[]>(
  "maz-erp.ot.v2",
  OT_RECORDS,
  (v): v is OtRecord[] => Array.isArray(v),
  undefined,
  { fetch: fetchOt, empty: [] },
);

/* ต่อฐานข้อมูลแล้วการเขียนพลาดได้จริง หน้าจอต้องได้รู้ว่าพลาดเพราะอะไร */
export type OtWriteResult = { ok: true } | { ok: false; message: string };

function say(reason: string, extra?: { asked?: number }) {
  const base = OT_REASON[reason] ?? "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง";
  if (reason === "bad_hours" && extra?.asked !== undefined) {
    return `${base} — ขอไว้ ${extra.asked} ชม.`;
  }
  return base;
}

export function useOtRecords() {
  return store.use();
}

export async function addOtRequest(input: {
  date: string;
  startMin: number;
  endMin: number;
  hours: number;
  reason: string;
}): Promise<OtRecord | null> {
  /* เลขที่ใบและเวลาที่ยื่นออกจากฐานข้อมูล ไม่ใช่จากเบราว์เซอร์
     เลขที่ต้องไม่ซ้ำทั้งบริษัท สองคนยื่นพร้อมกันจึงนับที่เดียวได้เท่านั้น */
  if (store.live) {
    const res = await fileOt(input);
    store.refresh();
    return res.ok ? res.record : null;
  }

  const record: OtRecord = {
    /* เลขที่ใบขอตาม ERD: OT-ปี พ.ศ.-ลำดับ เดินต่อกันทั้งบริษัท */
    id: nextDocNo("OT", store.all().flat().map((r) => r.id)),
    date: input.date,
    startMin: input.startMin,
    endMin: input.endMin,
    hours: input.hours,
    approvedHours: null,
    reason: input.reason,
    status: "รออนุมัติ",
    comment: "",
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
export async function cancelOtRequest(id: string): Promise<OtWriteResult> {
  if (store.live) {
    const res = await sbCancel(id);
    store.refresh();
    return res.ok ? { ok: true } : { ok: false, message: say(res.reason) };
  }
  store.update((rs) =>
    rs.map((r) =>
      r.id === id && r.status === "รออนุมัติ" ? { ...r, status: "ยกเลิก" as const } : r,
    ),
  );
  return { ok: true };
}

/** คำขอโอทีของทุกบทบาท — หน้าอนุมัติเท่านั้น */
export function useAllOt() {
  return store.useAll();
}

/**
 * หัวหน้าอนุมัติโอที — ปรับชั่วโมงที่อนุมัติได้ เช่นตัดตามเวลาตอกบัตรจริง
 * ต่อฐานข้อมูลแล้วฐานข้อมูลตรวจเองว่าชั่วโมงที่อนุมัติไม่เกินที่ขอ เพราะชั่วโมงคือเงิน
 */
export async function approveOt(
  role: Role,
  id: string,
  approvedHours: number,
  comment: string,
): Promise<OtWriteResult> {
  if (store.live) {
    const res = await sbDecide(id, true, comment, approvedHours);
    store.refresh();
    return res.ok ? { ok: true } : { ok: false, message: say(res.reason, res) };
  }
  store.updateRole(role, (rs) =>
    rs.map((r) =>
      r.id === id && r.status === "รออนุมัติ"
        ? { ...r, status: "อนุมัติแล้ว" as const, approvedHours, comment, decidedAt: bkkStamp() }
        : r,
    ),
  );
  return { ok: true };
}

export async function rejectOt(role: Role, id: string, comment: string): Promise<OtWriteResult> {
  if (store.live) {
    const res = await sbDecide(id, false, comment);
    store.refresh();
    return res.ok ? { ok: true } : { ok: false, message: say(res.reason, res) };
  }
  store.updateRole(role, (rs) =>
    rs.map((r) =>
      r.id === id && r.status === "รออนุมัติ"
        ? { ...r, status: "ไม่อนุมัติ" as const, approvedHours: null, comment, decidedAt: bkkStamp() }
        : r,
    ),
  );
  return { ok: true };
}

/*
 * ยกเลิกการอนุมัติโอที — กลับมารออนุมัติใหม่ และล้างชั่วโมงที่อนุมัติไว้
 * ชั่วโมงที่อนุมัติคือเงิน (paidHours) ย้อนได้เฉพาะรอบที่ยังไม่ปิด — หน้าจอกันให้
 */
export async function undoOtDecision(role: Role, id: string, why: string): Promise<boolean> {
  const reason = why.trim();
  if (!reason) return false;

  /* ชั่วโมงที่อนุมัติคือเงิน (paidHours) ฐานข้อมูลจึงกันไว้อีกชั้นว่ารอบที่ปิดแล้วห้ามย้อน */
  if (store.live) {
    const res = await sbUndo(id, reason);
    store.refresh();
    return res.ok;
  }

  let done = false;
  store.updateRole(role, (rs) =>
    rs.map((r) => {
      if (r.id !== id) return r;
      if (r.status !== "อนุมัติแล้ว" && r.status !== "ไม่อนุมัติ") return r;
      done = true;
      return {
        ...r,
        status: "รออนุมัติ" as const,
        approvedHours: null,
        decidedAt: undefined,
        comment: `ยกเลิกการอนุมัติ: ${reason}`,
        undoneAt: bkkStamp(),
        undoneWhy: reason,
      };
    }),
  );
  return done;
}

export function resetOtRecords() {
  store.reset();
}
