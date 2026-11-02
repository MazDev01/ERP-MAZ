"use client";

import { supabase } from "./client";
import { loadPeople, myId, nameById, roleById } from "./people";
import { stamp } from "./stamp";
import type { LeaveRecord, LeaveStatus } from "../leave-data";
import { ROLES, type Role } from "../role";

/*
 * ใบลาจากฐานข้อมูล — แปลงไปเป็นรูปเดียวกับที่หน้าจอใช้อยู่เดิม (LeaveRecord)
 *
 * ของสองอย่างที่ต้องแปลง
 *   สถานะ  ฐานข้อมูลเก็บเป็นอังกฤษ (pending/approved/…) หน้าจอใช้ข้อความไทย
 *   ตัวคน  ฐานข้อมูลอ้างด้วยรหัส หน้าจอใช้ชื่อและหั่นตามบทบาท (ดู people.ts)
 *
 * วันที่และเวลาแปลงเป็นเวลาไทยที่นี่เลย เพราะทุกหน้าถือว่า yyyy-mm-dd hh:mm
 * ที่อ่านได้คือเวลาไทยแล้ว ไม่ใช่ UTC
 */

const TO_TH: Record<string, LeaveStatus> = {
  pending: "รอการอนุมัติ",
  approved: "อนุมัติแล้ว",
  rejected: "ไม่อนุมัติ",
  cancelled: "ยกเลิก",
};

type Row = {
  id: string;
  no: string;
  employee_id: string;
  leave_type: string;
  from_date: string;
  to_date: string;
  days: number | string;
  half: "morning" | "afternoon" | null;
  start_min: number | null;
  end_min: number | null;
  hours: number | string | null;
  reason: string;
  status: string;
  decision_note: string;
  cancel_why: string;
  cancelled_at: string | null;
  undone_at: string | null;
  undone_why: string;
  submitted_at: string;
  decided_at: string | null;
  edited_at: string | null;
};

const COLS =
  "id, no, employee_id, leave_type, from_date, to_date, days, half, start_min, end_min, hours," +
  " reason, status, decision_note, cancel_why, cancelled_at, undone_at, undone_why," +
  " submitted_at, decided_at, edited_at";

export function toLeave(row: Row): LeaveRecord {
  const status = TO_TH[row.status] ?? "รอการอนุมัติ";
  /* ช่องเดียวของหน้าจอ (comment) ใช้ทั้งเหตุผลที่ยื่นและเหตุผลที่ผู้อนุมัติให้
     ฐานข้อมูลแยกสองช่อง จึงให้เหตุผลของผู้อนุมัติทับเมื่อถูกตีกลับ เหมือนที่หน้าจอทำเอง */
  const comment =
    status === "ไม่อนุมัติ" && row.decision_note ? row.decision_note : row.reason;
  return {
    id: row.no,
    date: row.from_date,
    toDate: row.to_date,
    employee: nameById(row.employee_id),
    type: row.leave_type,
    days: Number(row.days),
    ...(row.half ? { half: row.half } : {}),
    ...(row.start_min !== null ? { startMin: row.start_min } : {}),
    ...(row.end_min !== null ? { endMin: row.end_min } : {}),
    ...(row.hours !== null ? { hours: Number(row.hours) } : {}),
    status,
    comment,
    submittedAt: stamp(row.submitted_at),
    ...(row.decided_at ? { decidedAt: stamp(row.decided_at) } : {}),
    ...(row.cancel_why ? { cancelReason: row.cancel_why } : {}),
    ...(row.cancelled_at ? { cancelledAt: stamp(row.cancelled_at) } : {}),
    ...(row.undone_at ? { undoneAt: stamp(row.undone_at) } : {}),
    ...(row.undone_why ? { undoneWhy: row.undone_why } : {}),
    ...(row.edited_at ? { editedAt: stamp(row.edited_at) } : {}),
  };
}

/* ─── อ่าน ─────────────────────────────────────────────────────────
 * ขอทีเดียวได้ทุกใบที่คนนี้มีสิทธิ์เห็น เพราะ RLS คัดให้แล้ว
 * (ของตัวเอง + ที่ตัวเองกรอกแทน + ที่รอตัวเองอนุมัติ + ทั้งหมดถ้าเป็นฝ่ายบุคคล)
 * แล้วค่อยหั่นเป็น Record<Role, …> ให้เข้ารูปที่หน้าจอเดิมใช้
 */
const EMPTY_BY_ROLE = Object.fromEntries(
  ROLES.map((r) => [r.key, [] as LeaveRecord[]]),
) as Record<Role, LeaveRecord[]>;

export async function fetchLeave(): Promise<{
  mine: LeaveRecord[];
  byRole: Record<Role, LeaveRecord[]>;
}> {
  const sb = supabase();
  if (!sb) return { mine: [], byRole: EMPTY_BY_ROLE };
  await loadPeople();

  const { data } = await sb
    .from("leave_requests")
    .select(COLS)
    .order("from_date", { ascending: false })
    .limit(2000);

  const rows = (data ?? []) as unknown as Row[];
  const me = myId();
  const mine: LeaveRecord[] = [];
  const byRole = Object.fromEntries(ROLES.map((r) => [r.key, [] as LeaveRecord[]])) as Record<
    Role,
    LeaveRecord[]
  >;

  for (const row of rows) {
    const rec = toLeave(row);
    if (row.employee_id === me) mine.push(rec);
    const role = roleById(row.employee_id);
    if (role && byRole[role]) byRole[role].push(rec);
  }
  return { mine, byRole };
}

/* ─── เขียน ────────────────────────────────────────────────────────── */

export type LeaveWrite =
  | { ok: true; record: LeaveRecord }
  | { ok: false; reason: string; detail?: string };

/** ข้อความอธิบายเหตุที่ฐานข้อมูลไม่รับ */
export const LEAVE_REASON: Record<string, string> = {
  no_backend: "ยังไม่ได้ต่อฐานข้อมูล",
  no_account: "บัญชีนี้ยังไม่ผูกกับพนักงาน — แจ้งฝ่ายบุคคล",
  no_route: "ยังไม่ได้ตั้งสายอนุมัติของบทบาทนี้ — แจ้งฝ่ายบุคคล",
  not_pending: "ใบนี้ถูกตัดสินไปแล้ว",
  own_request: "อนุมัติใบของตัวเองไม่ได้",
  not_approver: "ไม่ใช่ผู้อนุมัติของใบนี้",
  need_reason: "ต้องกรอกเหตุผลเมื่อไม่อนุมัติ",
  over_quota: "วันลาเกินสิทธิ์ที่เหลือ",
  closed: "รอบเวลาที่ครอบคลุมวันนี้ปิดแล้ว ย้อนไม่ได้",
  decided: "ใบนี้ยังไม่ถูกตัดสิน",
};

/** บทบาทที่ใบลาของบทบาทนี้ต้องไปถึง — อ่านจากตารางสายอนุมัติ ไม่ใช่ค่าคงที่ในโค้ด */
async function routeFor(role: Role): Promise<string | null> {
  const sb = supabase();
  if (!sb) return null;
  const { data } = await sb
    .from("approval_routes")
    .select("approver_role")
    .eq("kind", "leave")
    .eq("from_role", role)
    .maybeSingle();
  return (data as { approver_role?: string } | null)?.approver_role ?? null;
}

/** ยื่นใบลา — เลขที่ใบออกจากฐานข้อมูล (trigger stamp_leave_no) ไม่ใช่จากเบราว์เซอร์ */
export async function fileLeave(input: {
  type: string;
  from: string;
  to: string;
  days: number;
  half?: "morning" | "afternoon";
  startMin?: number;
  endMin?: number;
  hours?: number;
  reason: string;
  /** ยื่นแทนคนที่ยังไม่มีบัญชี — ไม่ส่งมาคือยื่นของตัวเอง */
  employeeId?: string;
}): Promise<LeaveWrite> {
  const sb = supabase();
  if (!sb) return { ok: false, reason: "no_backend" };
  await loadPeople();

  const owner = input.employeeId ?? myId();
  if (!owner) return { ok: false, reason: "no_account" };
  const role = roleById(owner);
  const route = role ? await routeFor(role) : null;
  if (!route) return { ok: false, reason: "no_route" };

  const { data, error } = await sb
    .from("leave_requests")
    .insert({
      employee_id: owner,
      leave_type: input.type,
      from_date: input.from,
      to_date: input.to,
      days: input.days,
      half: input.half ?? null,
      start_min: input.startMin ?? null,
      end_min: input.endMin ?? null,
      hours: input.hours ?? null,
      reason: input.reason,
      approver_role: route,
      filed_by: myId(),
    })
    .select(COLS)
    .single();

  if (error || !data) return { ok: false, reason: "insert_failed", detail: error?.message };
  return { ok: true, record: toLeave(data as unknown as Row) };
}

/** uuid ของใบจากเลขที่ใบที่หน้าจอถืออยู่ (LV-2569-0001) */
async function idOf(no: string): Promise<string | null> {
  const sb = supabase();
  if (!sb) return null;
  const { data } = await sb.from("leave_requests").select("id").eq("no", no).maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

export type Decided = { ok: true } | { ok: false; reason: string; asked?: number; left?: number };

/** ผู้อนุมัติตัดสินใบลา — ฐานข้อมูลตรวจสายอนุมัติและสิทธิ์วันลาเองอีกชั้น */
export async function decideLeave(no: string, ok: boolean, note: string): Promise<Decided> {
  const sb = supabase();
  if (!sb) return { ok: false, reason: "no_backend" };
  const id = await idOf(no);
  if (!id) return { ok: false, reason: "not_found" };

  const { data, error } = await sb.rpc("decide_request", {
    p_kind: "leave",
    p_id: id,
    p_ok: ok,
    p_note: note,
  });
  if (error) return { ok: false, reason: error.message };
  const res = (data ?? {}) as { ok?: boolean; reason?: string; asked?: number; left?: number };
  return res.ok
    ? { ok: true }
    : { ok: false, reason: res.reason ?? "unknown", asked: res.asked, left: res.left };
}

/** ผู้ยื่นถอนใบที่ยังรออนุมัติ — ไม่ลบทิ้ง เปลี่ยนสถานะเป็นยกเลิกพร้อมเหตุผล */
export async function cancelLeave(no: string, why: string): Promise<Decided> {
  const sb = supabase();
  if (!sb) return { ok: false, reason: "no_backend" };
  const id = await idOf(no);
  if (!id) return { ok: false, reason: "not_found" };

  const { error } = await sb
    .from("leave_requests")
    .update({ status: "cancelled", cancel_why: why.trim(), cancelled_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending");
  return error ? { ok: false, reason: error.message } : { ok: true };
}

/** ดึงใบที่ตัดสินแล้วกลับมารออนุมัติใหม่ — ฐานข้อมูลกันไว้ว่ารอบเงินเดือนปิดแล้วห้ามย้อน */
export async function undoLeave(no: string, why: string): Promise<Decided> {
  const sb = supabase();
  if (!sb) return { ok: false, reason: "no_backend" };
  const id = await idOf(no);
  if (!id) return { ok: false, reason: "not_found" };

  const { data, error } = await sb.rpc("undo_decision", {
    p_kind: "leave",
    p_id: id,
    p_why: why,
  });
  if (error) return { ok: false, reason: error.message };
  const res = (data ?? {}) as { ok?: boolean; reason?: string };
  return res.ok ? { ok: true } : { ok: false, reason: res.reason ?? "unknown" };
}
