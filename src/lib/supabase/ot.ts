"use client";

import { signedIn, supabase } from "./client";
import { loadPeople, myId, nameById, roleById } from "./people";
import { stamp } from "./stamp";
import type { OtRecord, OtStatus } from "../ot-data";
import { ROLES, type Role } from "../role";

/*
 * ใบโอทีจากฐานข้อมูล — แปลงไปเป็นรูปเดียวกับที่หน้าจอใช้อยู่เดิม (OtRecord)
 * วิธีเดียวกับใบลาใน leave.ts ทุกอย่าง ต่างกันแค่ชื่อช่องและชั่วโมงที่อนุมัติ
 */

const TO_TH: Record<string, OtStatus> = {
  pending: "รออนุมัติ",
  approved: "อนุมัติแล้ว",
  rejected: "ไม่อนุมัติ",
  cancelled: "ยกเลิก",
};

type Row = {
  id: string;
  no: string;
  employee_id: string;
  work_date: string;
  start_min: number;
  end_min: number;
  hours: number | string;
  approved_hours: number | string | null;
  reason: string;
  status: string;
  decision_note: string;
  decided_at: string | null;
  undone_at: string | null;
  undone_why: string;
  submitted_at: string;
  edited_at: string | null;
};

const COLS =
  "id, no, employee_id, work_date, start_min, end_min, hours, approved_hours, reason," +
  " status, decision_note, decided_at, undone_at, undone_why, submitted_at, edited_at";

export function toOt(row: Row): OtRecord {
  return {
    id: row.no,
    date: row.work_date,
    startMin: row.start_min,
    endMin: row.end_min,
    hours: Number(row.hours),
    approvedHours: row.approved_hours === null ? null : Number(row.approved_hours),
    reason: row.reason,
    status: TO_TH[row.status] ?? "รออนุมัติ",
    comment: row.decision_note,
    submittedAt: stamp(row.submitted_at) ?? "",
    ...(row.decided_at ? { decidedAt: stamp(row.decided_at) } : {}),
    ...(row.edited_at ? { editedAt: stamp(row.edited_at) } : {}),
    employee: nameById(row.employee_id),
    ...(row.undone_at ? { undoneAt: stamp(row.undone_at) } : {}),
    ...(row.undone_why ? { undoneWhy: row.undone_why } : {}),
  };
}

const EMPTY_BY_ROLE = Object.fromEntries(
  ROLES.map((r) => [r.key, [] as OtRecord[]]),
) as Record<Role, OtRecord[]>;

/** ทุกใบที่คนนี้มีสิทธิ์เห็น (RLS คัดให้) แล้วหั่นเข้ารูปที่หน้าจอเดิมใช้ */
export async function fetchOt(): Promise<{
  mine: OtRecord[];
  byRole: Record<Role, OtRecord[]>;
}> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return { mine: [], byRole: EMPTY_BY_ROLE };
  await loadPeople();

  const { data } = await sb
    .from("ot_requests")
    .select(COLS)
    .order("work_date", { ascending: false })
    .limit(2000);

  const rows = (data ?? []) as unknown as Row[];
  const me = myId();
  const mine: OtRecord[] = [];
  const byRole = Object.fromEntries(
    ROLES.map((r) => [r.key, [] as OtRecord[]]),
  ) as Record<Role, OtRecord[]>;

  for (const row of rows) {
    const rec = toOt(row);
    if (row.employee_id === me) mine.push(rec);
    const role = roleById(row.employee_id);
    if (role && byRole[role]) byRole[role].push(rec);
  }
  return { mine, byRole };
}

/* ─── เขียน ────────────────────────────────────────────────────────── */

export type OtWrite = { ok: true; record: OtRecord } | { ok: false; reason: string };
export type OtDecided = { ok: true } | { ok: false; reason: string; asked?: number };

/** ข้อความอธิบายเหตุที่ฐานข้อมูลไม่รับ */
export const OT_REASON: Record<string, string> = {
  no_backend: "ยังไม่ได้ต่อฐานข้อมูล",
  no_account: "บัญชีนี้ยังไม่ผูกกับพนักงาน — แจ้งฝ่ายบุคคล",
  no_route: "ยังไม่ได้ตั้งสายอนุมัติของบทบาทนี้ — แจ้งฝ่ายบุคคล",
  not_pending: "ใบนี้ถูกตัดสินไปแล้ว",
  own_request: "อนุมัติใบของตัวเองไม่ได้",
  not_approver: "ไม่ใช่ผู้อนุมัติของใบนี้",
  need_reason: "ต้องกรอกเหตุผลเมื่อไม่อนุมัติ",
  bad_hours: "ชั่วโมงที่อนุมัติต้องมากกว่า 0 และไม่เกินที่ขอ",
  closed: "รอบเวลาที่ครอบคลุมวันนี้ปิดแล้ว ย้อนไม่ได้",
  not_found: "ไม่พบใบนี้ในระบบ",
};

async function routeFor(role: Role): Promise<string | null> {
  const sb = supabase();
  if (!sb) return null;
  const { data } = await sb
    .from("approval_routes")
    .select("approver_role")
    .eq("kind", "ot")
    .eq("from_role", role)
    .maybeSingle();
  return (data as { approver_role?: string } | null)?.approver_role ?? null;
}

/** ยื่นใบโอที — เลขที่ใบออกจากฐานข้อมูล (trigger stamp_ot_no) */
export async function fileOt(input: {
  date: string;
  startMin: number;
  endMin: number;
  hours: number;
  reason: string;
}): Promise<OtWrite> {
  const sb = supabase();
  if (!sb) return { ok: false, reason: "no_backend" };
  await loadPeople();

  const owner = myId();
  if (!owner) return { ok: false, reason: "no_account" };
  const role = roleById(owner);
  const route = role ? await routeFor(role) : null;
  if (!route) return { ok: false, reason: "no_route" };

  const { data, error } = await sb
    .from("ot_requests")
    .insert({
      employee_id: owner,
      work_date: input.date,
      start_min: input.startMin,
      end_min: input.endMin,
      hours: input.hours,
      reason: input.reason,
      approver_role: route,
      filed_by: owner,
    })
    .select(COLS)
    .single();

  if (error || !data) return { ok: false, reason: error?.message ?? "insert_failed" };
  return { ok: true, record: toOt(data as unknown as Row) };
}

async function idOf(no: string): Promise<string | null> {
  const sb = supabase();
  if (!sb) return null;
  const { data } = await sb.from("ot_requests").select("id").eq("no", no).maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

/**
 * ผู้อนุมัติตัดสินใบโอที — ส่งชั่วโมงที่อนุมัติได้ (ตัดตามเวลาตอกบัตรจริง)
 * ฐานข้อมูลตรวจเองว่าชั่วโมงที่อนุมัติไม่เกินที่ขอ เพราะชั่วโมงคือเงิน
 */
export async function decideOt(
  no: string,
  ok: boolean,
  note: string,
  hours?: number,
): Promise<OtDecided> {
  const sb = supabase();
  if (!sb) return { ok: false, reason: "no_backend" };
  const id = await idOf(no);
  if (!id) return { ok: false, reason: "not_found" };

  const { data, error } = await sb.rpc("decide_request", {
    p_kind: "ot",
    p_id: id,
    p_ok: ok,
    p_note: note,
    p_hours: ok && hours !== undefined ? hours : null,
  });
  if (error) return { ok: false, reason: error.message };
  const res = (data ?? {}) as { ok?: boolean; reason?: string; asked?: number };
  return res.ok ? { ok: true } : { ok: false, reason: res.reason ?? "unknown", asked: res.asked };
}

/** ผู้ยื่นถอนใบที่ยังรออนุมัติ */
export async function cancelOt(no: string): Promise<OtDecided> {
  const sb = supabase();
  if (!sb) return { ok: false, reason: "no_backend" };
  const id = await idOf(no);
  if (!id) return { ok: false, reason: "not_found" };

  const { error } = await sb
    .from("ot_requests")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending");
  return error ? { ok: false, reason: error.message } : { ok: true };
}

/** ดึงใบที่ตัดสินแล้วกลับมารออนุมัติใหม่ — ฐานข้อมูลกันไว้ว่ารอบเงินเดือนปิดแล้วห้ามย้อน */
export async function undoOt(no: string, why: string): Promise<OtDecided> {
  const sb = supabase();
  if (!sb) return { ok: false, reason: "no_backend" };
  const id = await idOf(no);
  if (!id) return { ok: false, reason: "not_found" };

  const { data, error } = await sb.rpc("undo_decision", { p_kind: "ot", p_id: id, p_why: why });
  if (error) return { ok: false, reason: error.message };
  const res = (data ?? {}) as { ok?: boolean; reason?: string };
  return res.ok ? { ok: true } : { ok: false, reason: res.reason ?? "unknown" };
}
