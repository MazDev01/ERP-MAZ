"use client";

import { signedIn, supabase } from "./client";
import { loadPeople, peopleNow } from "./people";

/*
 * ผลการตรวจเวลาทำงาน และเงินเพิ่ม/เงินหักรายคน
 *
 * สองเรื่องนี้เคยอยู่ในเครื่องของฝ่ายบุคคลที่เปิดหน้าอยู่ ซึ่งแปลว่า
 * ฝ่ายบุคคลอีกคนเปิดอีกเครื่องจะไม่เห็นว่าตรวจไปแล้ว และยอดเงินเดือนที่คิดได้คนละตัว
 * ทั้งที่ทั้งคู่มีผลกับเงินที่จ่ายจริง จึงต้องเป็นชุดเดียวกันทั้งบริษัท
 *
 * ฐานข้อมูลเก็บด้วย uuid ส่วนหน้าจอเรียกคนด้วยรหัสพนักงาน (E05) — แปลงที่ชั้นนี้ชั้นเดียว
 */

export type Review = { emp: string; day: string; note: string; absent: boolean };
export type ExtraRow = { emp: string; incentive: number; allowance: number };
export type AdjustRow = { id: string; emp: string; amount: number; why: string };

export type ReviewResult = { ok: true } | { ok: false; reason: string };

export const REVIEW_REASON: Record<string, string> = {
  no_backend: "ยังไม่ได้ต่อฐานข้อมูล",
  no_right: "ต้องเป็นฝ่ายบุคคลจึงบันทึกได้",
  no_person: "ไม่พบพนักงานคนนี้ในทะเบียน",
  need_note: "ต้องระบุเหตุผลก่อนบันทึก",
};

async function db() {
  const sb = supabase();
  return sb && (await signedIn()) ? sb : null;
}

/* ── ผลการตรวจเวลาทำงาน ────────────────────────────────────────── */

/** ผลการตรวจทั้งหมดที่คนนี้เห็นได้ (RLS คัดให้) */
export async function fetchReviews(): Promise<Review[]> {
  const sb = await db();
  if (!sb) return [];
  const { data, error } = await sb
    .from("time_reviews")
    .select("employee_id, on_date, note, absent")
    .order("on_date");
  if (error || !data) return [];

  await loadPeople();
  const name = new Map(peopleNow().map((p) => [p.id, p.empNo]));
  return (data as { employee_id: string; on_date: string; note: string; absent: boolean }[])
    .map((r) => ({ emp: name.get(r.employee_id) ?? "", day: r.on_date, note: r.note, absent: r.absent }))
    .filter((r) => r.emp);
}

/** บันทึกผลการตรวจของวันหนึ่ง — คนเดิมวันเดิมเขียนทับของเก่า */
export async function saveReview(emp: string, day: string, note: string, absent: boolean): Promise<ReviewResult> {
  const sb = await db();
  if (!sb) return { ok: false, reason: "no_backend" };
  if (!note.trim()) return { ok: false, reason: "need_note" };

  await loadPeople();
  const uuid = peopleNow().find((p) => p.empNo === emp)?.id;
  if (!uuid) return { ok: false, reason: "no_person" };

  const { data, error } = await sb
    .from("time_reviews")
    .upsert(
      { employee_id: uuid, on_date: day, note: note.trim(), absent, decided_at: new Date().toISOString() },
      { onConflict: "employee_id,on_date" },
    )
    .select("on_date");
  if (error) return { ok: false, reason: error.message };
  /* RLS ปฏิเสธเงียบด้วยการไม่คืนแถว — ต้องถือว่าไม่สำเร็จ */
  if (!data || data.length === 0) return { ok: false, reason: "no_right" };
  return { ok: true };
}

/* ── เงินเพิ่มและรายการปรับปรุง ─────────────────────────────────── */

/** เงินเพิ่มของรอบนั้น (Incentive · ค่าตำแหน่ง) */
export async function fetchExtras(month: string): Promise<ExtraRow[]> {
  const sb = await db();
  if (!sb || !month) return [];
  const { data, error } = await sb
    .from("pay_extras")
    .select("employee_id, incentive, allowance")
    .eq("month", month);
  if (error || !data) return [];

  await loadPeople();
  const name = new Map(peopleNow().map((p) => [p.id, p.empNo]));
  return (data as { employee_id: string; incentive: number; allowance: number }[])
    .map((r) => ({ emp: name.get(r.employee_id) ?? "", incentive: Number(r.incentive), allowance: Number(r.allowance) }))
    .filter((r) => r.emp);
}

/** รายการปรับปรุงด้วยมือของรอบนั้น — บวกหรือลบก็ได้ แต่ต้องมีเหตุผล */
export async function fetchAdjusts(month: string): Promise<AdjustRow[]> {
  const sb = await db();
  if (!sb || !month) return [];
  const { data, error } = await sb
    .from("pay_adjusts")
    .select("id, employee_id, amount, why")
    .eq("month", month)
    .order("created_at");
  if (error || !data) return [];

  await loadPeople();
  const name = new Map(peopleNow().map((p) => [p.id, p.empNo]));
  return (data as { id: string; employee_id: string; amount: number; why: string }[])
    .map((r) => ({ id: r.id, emp: name.get(r.employee_id) ?? "", amount: Number(r.amount), why: r.why }))
    .filter((r) => r.emp);
}

/**
 * บันทึกเงินเพิ่มและรายการปรับปรุงของคนหนึ่งในรอบหนึ่ง
 * รายการปรับปรุงส่งมาทั้งชุด — ของเดิมในรอบนั้นของคนนั้นถูกแทนที่ทั้งหมด
 */
export async function saveExtraRemote(
  month: string,
  emp: string,
  extra: { incentive: number; allowance: number; adjust: { amt: number; why: string }[] },
): Promise<ReviewResult> {
  const sb = await db();
  if (!sb) return { ok: false, reason: "no_backend" };

  await loadPeople();
  const uuid = peopleNow().find((p) => p.empNo === emp)?.id;
  if (!uuid) return { ok: false, reason: "no_person" };

  const up = await sb
    .from("pay_extras")
    .upsert(
      {
        month,
        employee_id: uuid,
        incentive: Math.max(0, extra.incentive),
        allowance: Math.max(0, extra.allowance),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "month,employee_id" },
    )
    .select("month");
  if (up.error) return { ok: false, reason: up.error.message };
  if (!up.data || up.data.length === 0) return { ok: false, reason: "no_right" };

  const del = await sb.from("pay_adjusts").delete().eq("month", month).eq("employee_id", uuid);
  if (del.error) return { ok: false, reason: del.error.message };

  const rows = extra.adjust
    .filter((a) => a.amt !== 0 && a.why.trim())
    .map((a) => ({ month, employee_id: uuid, amount: a.amt, why: a.why.trim() }));
  if (rows.length) {
    const ins = await sb.from("pay_adjusts").insert(rows);
    if (ins.error) return { ok: false, reason: ins.error.message };
  }
  return { ok: true };
}

/* ── ฝ่ายบุคคลแก้ตัวเลขเวลา และเติมเวลาที่ขาด ─────────────────── */

export type TimeEdit = { emp: string; day: string; kind: "late" | "ot"; value: number; was: number | null; why: string };

/** รายการแก้ตัวเลขเวลาทั้งหมดที่คนนี้เห็นได้ */
export async function fetchTimeEdits(): Promise<TimeEdit[]> {
  const sb = await db();
  if (!sb) return [];
  const { data, error } = await sb
    .from("time_edits")
    .select("employee_id, on_date, kind, value, was, why")
    .order("on_date");
  if (error || !data) return [];

  await loadPeople();
  const name = new Map(peopleNow().map((p) => [p.id, p.empNo]));
  return (data as { employee_id: string; on_date: string; kind: "late" | "ot"; value: number; was: number | null; why: string }[])
    .map((r) => ({
      emp: name.get(r.employee_id) ?? "",
      day: r.on_date,
      kind: r.kind,
      value: Number(r.value),
      was: r.was === null ? null : Number(r.was),
      why: r.why,
    }))
    .filter((r) => r.emp);
}

/**
 * แก้นาทีมาสายหรือชั่วโมงโอทีของวันหนึ่ง
 * เก็บค่าที่เครื่องคำนวณได้ (was) ไว้ครั้งแรกที่แก้ — ต้องตรวจย้อนได้ว่าเดิมเท่าไร
 */
export async function saveTimeEdit(
  emp: string,
  day: string,
  kind: "late" | "ot",
  value: number,
  was: number | null,
  why: string,
): Promise<ReviewResult> {
  const sb = await db();
  if (!sb) return { ok: false, reason: "no_backend" };
  if (!why.trim()) return { ok: false, reason: "need_note" };

  await loadPeople();
  const uuid = peopleNow().find((p) => p.empNo === emp)?.id;
  if (!uuid) return { ok: false, reason: "no_person" };

  /* ค่าเดิมมีอยู่แล้วไม่ทับ — was คือ "ก่อนมนุษย์แตะครั้งแรก" ไม่ใช่ก่อนแก้รอบล่าสุด */
  const old = await sb
    .from("time_edits")
    .select("was")
    .eq("employee_id", uuid)
    .eq("on_date", day)
    .eq("kind", kind)
    .maybeSingle();
  const keepWas = (old.data as { was: number | null } | null)?.was ?? was;

  const { data, error } = await sb
    .from("time_edits")
    .upsert(
      { employee_id: uuid, on_date: day, kind, value, was: keepWas, why: why.trim(), edited_at: new Date().toISOString() },
      { onConflict: "employee_id,on_date,kind" },
    )
    .select("on_date");
  if (error) return { ok: false, reason: error.message };
  if (!data || data.length === 0) return { ok: false, reason: "no_right" };
  return { ok: true };
}

export const FILL_REASON: Record<string, string> = {
  not_hr: "ต้องเป็นฝ่ายบุคคลจึงเติมเวลาได้",
  bad_type: "ชนิดการตอกไม่ถูกต้อง",
  bad_time: "เวลาต้องอยู่ในรูป ชช:นน",
  need_reason: "ต้องระบุเหตุผล",
  future: "เติมเวลาในอนาคตไม่ได้",
  period_closed: "รอบนี้ปิดแล้ว แก้ย้อนหลังไม่ได้",
};

/** เติมเวลาเข้าหรือออกที่พนักงานลืมกด — ลงบันทึกว่าใครเติมและเพราะอะไร */
export async function fillPunch(
  emp: string,
  type: "in" | "out",
  day: string,
  time: string,
  why: string,
): Promise<ReviewResult> {
  const sb = await db();
  if (!sb) return { ok: false, reason: "no_backend" };
  if (!why.trim()) return { ok: false, reason: "need_note" };

  await loadPeople();
  const uuid = peopleNow().find((p) => p.empNo === emp)?.id;
  if (!uuid) return { ok: false, reason: "no_person" };

  const { data, error } = await sb.rpc("hr_fill_punch", {
    p_employee: uuid,
    p_type: type,
    p_date: day,
    p_time: time,
    p_why: why.trim(),
  });
  if (error) return { ok: false, reason: error.message };

  const res = (data ?? {}) as { ok?: boolean; reason?: string };
  if (!res.ok) return { ok: false, reason: FILL_REASON[res.reason ?? ""] ?? res.reason ?? "unknown" };
  return { ok: true };
}
