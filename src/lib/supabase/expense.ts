"use client";

import { signedIn, supabase } from "./client";
import { loadPeople, myId, nameById, roleById } from "./people";
import { stamp } from "./stamp";
import type { ClaimStatus, ExpenseClaim, FuelRow, IncomeRow, OtherRow } from "../expense-data";
import { ROLES, type Role } from "../role";

/*
 * ใบเบิกจากฐานข้อมูล — แปลงไปเป็นรูปเดียวกับที่หน้าจอใช้อยู่เดิม (ExpenseClaim)
 *
 * ต่างจากใบลากับใบโอทีอยู่สองเรื่อง
 *  1 ใบเดียวมีหลายแถว (ค่าน้ำมัน / ค่าใช้จ่ายอื่น / รายรับ) อยู่คนละตาราง
 *    อ่านทีเดียวด้วยการฝังตารางลูก (PostgREST embed) ไม่ยิงสี่รอบ
 *  2 ใบร่างไม่ได้อยู่ในฐานข้อมูล แต่อยู่ในเครื่องของผู้กรอก เพราะกรอกทีละตัวอักษร
 *    ที่นี่จึง "ไม่คืนใบร่าง" เลย — ใบร่างในฐานข้อมูลเป็นแค่ที่จองเลขที่ใบไว้
 *    (ดู file_claim / withdraw_claim ในหลังบ้านรอบที่ 8)
 */

const TO_TH: Record<string, ClaimStatus> = {
  draft: "ร่าง",
  pending: "รออนุมัติ",
  approved: "อนุมัติแล้ว",
  rejected: "ไม่อนุมัติ",
};

type FuelDbRow = {
  id: string;
  on_date: string | null;
  place: string;
  work: string;
  km: number | string | null;
  note: string;
  sort: number;
};
type OtherDbRow = {
  id: string;
  on_date: string | null;
  kind: string;
  amount: number | string | null;
  note: string;
  sort: number;
};
type IncomeDbRow = {
  id: string;
  item: string;
  amount: number | string | null;
  deal_no: string;
  sort: number;
};

type Row = {
  id: string;
  no: string | null;
  employee_id: string;
  month: string;
  status: string;
  plate: string;
  decision_note: string;
  decided_at: string | null;
  paid_in: string | null;
  undone_at: string | null;
  undone_why: string;
  submitted_at: string | null;
  expense_fuel_rows: FuelDbRow[] | null;
  expense_other_rows: OtherDbRow[] | null;
  expense_income_rows: IncomeDbRow[] | null;
};

const COLS =
  "id, no, employee_id, month, status, plate, decision_note, decided_at, paid_in," +
  " undone_at, undone_why, submitted_at," +
  " expense_fuel_rows (id, on_date, place, work, km, note, sort)," +
  " expense_other_rows (id, on_date, kind, amount, note, sort)," +
  " expense_income_rows (id, item, amount, deal_no, sort)";

/** ตัวเลขในฐานข้อมูลกลับมาเป็นข้อความ เพราะช่องกรอกบนหน้าจอเก็บเป็นข้อความ */
const txt = (v: number | string | null) => (v === null || v === undefined ? "" : String(Number(v)));
const bySort = <T extends { sort: number }>(rows: T[] | null) =>
  [...(rows ?? [])].sort((a, b) => a.sort - b.sort);

export function toClaim(row: Row): ExpenseClaim {
  const fuel: FuelRow[] = bySort(row.expense_fuel_rows).map((r) => ({
    id: r.id,
    date: r.on_date ?? "",
    place: r.place,
    km: txt(r.km),
    work: r.work,
    note: r.note,
  }));
  const other: OtherRow[] = bySort(row.expense_other_rows).map((r) => ({
    id: r.id,
    kind: r.kind,
    date: r.on_date ?? "",
    amount: txt(r.amount),
    note: r.note,
  }));
  const income: IncomeRow[] = bySort(row.expense_income_rows).map((r) => ({
    id: r.id,
    item: r.item,
    amount: txt(r.amount),
    dealNo: r.deal_no,
  }));

  return {
    month: row.month,
    status: TO_TH[row.status] ?? "ร่าง",
    plate: row.plate,
    /* ชื่อเล่นรถยังไม่มีช่องกรอกบนหน้าจอ จึงไม่มีช่องในฐานข้อมูล */
    nickname: "",
    fuel,
    other,
    income,
    comment: row.decision_note,
    submittedAt: stamp(row.submitted_at) ?? "",
    ...(row.no ? { no: row.no } : {}),
    ...(row.decided_at ? { decidedAt: stamp(row.decided_at) } : {}),
    ...(row.paid_in ? { paidIn: row.paid_in } : {}),
    ...(row.undone_at ? { undoneAt: stamp(row.undone_at) } : {}),
    ...(row.undone_why ? { undoneWhy: row.undone_why } : {}),
    employee: nameById(row.employee_id),
  };
}

const EMPTY_BY_ROLE = Object.fromEntries(
  ROLES.map((r) => [r.key, [] as ExpenseClaim[]]),
) as Record<Role, ExpenseClaim[]>;

/** ทุกใบที่คนนี้มีสิทธิ์เห็น (RLS คัดให้) — ใบร่างไม่นับ เพราะร่างอยู่ในเครื่อง */
export async function fetchClaims(): Promise<{
  mine: ExpenseClaim[];
  byRole: Record<Role, ExpenseClaim[]>;
}> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return { mine: [], byRole: EMPTY_BY_ROLE };
  await loadPeople();

  const { data } = await sb
    .from("expense_claims")
    .select(COLS)
    .neq("status", "draft")
    .order("month", { ascending: false })
    .limit(2000);

  const rows = (data ?? []) as unknown as Row[];
  const me = myId();
  const mine: ExpenseClaim[] = [];
  const byRole = Object.fromEntries(
    ROLES.map((r) => [r.key, [] as ExpenseClaim[]]),
  ) as Record<Role, ExpenseClaim[]>;

  for (const row of rows) {
    const claim = toClaim(row);
    if (row.employee_id === me) mine.push(claim);
    const role = roleById(row.employee_id);
    if (role && byRole[role]) byRole[role].push(claim);
  }
  return { mine, byRole };
}

/* ─── เขียน ────────────────────────────────────────────────────────── */

export type ClaimWrite = { ok: true; no: string } | { ok: false; reason: string };
export type ClaimDone = { ok: true } | { ok: false; reason: string; paidIn?: string };

/** ข้อความอธิบายเหตุที่ฐานข้อมูลไม่รับ */
export const CLAIM_REASON: Record<string, string> = {
  no_backend: "ยังไม่ได้ต่อฐานข้อมูล",
  no_account: "บัญชีนี้ยังไม่ผูกกับพนักงาน — แจ้งฝ่ายบุคคล",
  no_route: "ยังไม่ได้ตั้งสายอนุมัติใบเบิกของบทบาทนี้ — แจ้งฝ่ายบุคคล",
  bad_month: "เดือนของใบเบิกไม่ถูกต้อง",
  locked: "ใบของเดือนนี้ยื่นไปแล้ว แก้ไม่ได้",
  not_pending: "ใบนี้ไม่ได้อยู่ในสถานะรออนุมัติ",
  own_request: "อนุมัติใบของตัวเองไม่ได้",
  not_approver: "ไม่ใช่ผู้อนุมัติของใบนี้",
  need_reason: "ต้องกรอกเหตุผลเมื่อไม่อนุมัติ",
  not_decided: "ใบนี้ยังไม่ถูกตัดสิน",
  already_paid: "ใบนี้จ่ายคืนไปกับรอบเงินเดือนแล้ว ย้อนไม่ได้",
  period_closed: "รอบเวลาที่ครอบคลุมใบนี้ปิดแล้ว ย้อนไม่ได้",
  not_found: "ไม่พบใบนี้ในระบบ",
};

/**
 * ยื่นใบเบิกทั้งใบในครั้งเดียว — เลขที่ใบออกจากฐานข้อมูล
 * ส่งรายการไปทั้งชุด ฐานข้อมูลเขียนทับของเดิม (file_claim รอบที่ 8)
 */
export async function fileClaim(claim: ExpenseClaim): Promise<ClaimWrite> {
  const sb = supabase();
  if (!sb) return { ok: false, reason: "no_backend" };
  await loadPeople();
  if (!myId()) return { ok: false, reason: "no_account" };

  const { data, error } = await sb.rpc("file_claim", {
    p_month: claim.month,
    p_plate: claim.plate,
    p_fuel: claim.fuel.map((r) => ({
      date: r.date,
      place: r.place,
      work: r.work,
      km: r.km,
      note: r.note,
    })),
    p_other: (claim.other ?? []).map((r) => ({
      date: r.date,
      kind: r.kind,
      amount: r.amount,
      note: r.note,
    })),
    p_income: claim.income.map((r) => ({
      item: r.item,
      amount: r.amount,
      dealNo: r.dealNo,
    })),
  });

  if (error) return { ok: false, reason: error.message };
  const res = (data ?? {}) as { ok?: boolean; reason?: string; no?: string };
  return res.ok ? { ok: true, no: res.no ?? "" } : { ok: false, reason: res.reason ?? "unknown" };
}

/** ดึงใบที่ยื่นไว้กลับมาแก้ — ได้เฉพาะใบที่ยังไม่ถูกตัดสิน */
export async function withdrawClaimRemote(month: string): Promise<ClaimDone> {
  const sb = supabase();
  if (!sb) return { ok: false, reason: "no_backend" };
  const { data, error } = await sb.rpc("withdraw_claim", { p_month: month });
  if (error) return { ok: false, reason: error.message };
  const res = (data ?? {}) as { ok?: boolean; reason?: string };
  return res.ok ? { ok: true } : { ok: false, reason: res.reason ?? "unknown" };
}

/*
 * หน้าอนุมัติอ้างถึงใบเบิกด้วย "บทบาท + เดือน" ไม่ใช่เลขที่ใบ (ของเดิมเป็นแบบนั้น)
 * จึงต้องแปลงกลับเป็นรหัสใบ — หนึ่งบทบาทคือหนึ่งคน จึงหาคนของบทบาทนั้นก่อน
 */
async function idOfClaim(role: Role, month: string): Promise<string | null> {
  const sb = supabase();
  if (!sb) return null;
  await loadPeople();
  const { data } = await sb
    .from("expense_claims")
    .select("id, employee_id")
    .eq("month", month)
    .limit(50);
  const rows = (data ?? []) as { id: string; employee_id: string }[];
  return rows.find((r) => roleById(r.employee_id) === role)?.id ?? null;
}

/** ผู้อนุมัติตัดสินใบเบิก */
export async function decideClaim(
  role: Role,
  month: string,
  ok: boolean,
  note: string,
): Promise<ClaimDone> {
  const sb = supabase();
  if (!sb) return { ok: false, reason: "no_backend" };
  const id = await idOfClaim(role, month);
  if (!id) return { ok: false, reason: "not_found" };

  const { data, error } = await sb.rpc("decide_request", {
    p_kind: "expense",
    p_id: id,
    p_ok: ok,
    p_note: note,
    p_hours: null,
  });
  if (error) return { ok: false, reason: error.message };
  const res = (data ?? {}) as { ok?: boolean; reason?: string };
  return res.ok ? { ok: true } : { ok: false, reason: res.reason ?? "unknown" };
}

/** ดึงใบที่ตัดสินแล้วกลับมารออนุมัติ — ใบที่จ่ายคืนไปแล้วย้อนไม่ได้ (already_paid) */
export async function undoClaim(role: Role, month: string, why: string): Promise<ClaimDone> {
  const sb = supabase();
  if (!sb) return { ok: false, reason: "no_backend" };
  const id = await idOfClaim(role, month);
  if (!id) return { ok: false, reason: "not_found" };

  const { data, error } = await sb.rpc("undo_decision", {
    p_kind: "expense",
    p_id: id,
    p_why: why,
  });
  if (error) return { ok: false, reason: error.message };
  const res = (data ?? {}) as { ok?: boolean; reason?: string; paid_in?: string };
  return res.ok ? { ok: true } : { ok: false, reason: res.reason ?? "unknown", paidIn: res.paid_in };
}
