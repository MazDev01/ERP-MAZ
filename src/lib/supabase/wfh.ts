"use client";

import { signedIn, supabase } from "./client";

/*
 * แจ้งทำงานที่บ้านช่วงฉุกเฉิน (รอบที่ 127)
 *
 * ไม่ต้องอนุมัติตามที่ฝ่ายบุคคลยืนยัน 25 พ.ย. 2569 — กดแจ้งแล้วมีผลทันที
 * เขียนผ่านฟังก์ชันของฐานข้อมูลเท่านั้น (ตารางไม่ให้พนักงาน insert ตรง ๆ
 * เพื่อกันการแจ้งแทนคนอื่นหรือย้อนหลังข้ามสัปดาห์)
 */

export type WfhNotice = {
  /** รหัสพนักงาน (uuid ของทะเบียน) */
  empId: string;
  /** วันที่ทำงานที่บ้าน (yyyy-mm-dd) */
  date: string;
  reason: string;
  note: string;
};

type Row = { employee_id: string; on_date: string; reason: string; note: string };

/** รายการที่เห็นได้ — พนักงานได้ของตัวเอง ฝ่ายบุคคลกับผู้บริหารได้ของทุกคน (ชั้น RLS คัดให้) */
export async function fetchWfh(): Promise<WfhNotice[]> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return [];
  const got = await sb
    .from("wfh_notices")
    .select("employee_id, on_date, reason, note")
    .order("on_date", { ascending: false });
  if (got.error) return [];
  return ((got.data ?? []) as unknown as Row[]).map((r) => ({
    empId: r.employee_id,
    date: r.on_date,
    reason: r.reason,
    note: r.note,
  }));
}

export type WfhWrite = { ok: true } | { ok: false; reason: string };

export async function sbWfhNotice(date: string, reason: string, note = ""): Promise<WfhWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return { ok: false, reason: "no_backend" };
  const got = await sb.rpc("wfh_notice", { p_date: date, p_reason: reason, p_note: note });
  if (got.error) return { ok: false, reason: got.error.message };
  const out = got.data as { ok?: boolean; reason?: string } | null;
  return out?.ok ? { ok: true } : { ok: false, reason: out?.reason ?? "unknown" };
}

export async function sbWfhCancel(date: string): Promise<WfhWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return { ok: false, reason: "no_backend" };
  const got = await sb.rpc("wfh_cancel", { p_date: date });
  if (got.error) return { ok: false, reason: got.error.message };
  const out = got.data as { ok?: boolean; reason?: string } | null;
  return out?.ok ? { ok: true } : { ok: false, reason: out?.reason ?? "unknown" };
}
