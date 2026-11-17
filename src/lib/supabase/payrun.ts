"use client";

import { signedIn, supabase } from "./client";
import { personById } from "./people";
import { blankPeriods } from "./periods";
import type { CycleSum, PayApproval, PayGroup, Period, Reopen, Slip } from "../hr-data";

/*
 * รอบจ่ายเงินเดือน การอนุมัติของ CEO และสลิป — จากฐานข้อมูล
 *
 * สายงานตามที่เจ้าของกำหนด: ปิดรอบเวลา → CEO อนุมัติยอด → ปิดรอบจ่าย → ออกสลิป
 * ทุกด่านบังคับอยู่ในฐานข้อมูล (close_payrun ตรวจเองว่าปิดรอบเวลาแล้ว CEO อนุมัติแล้ว
 * และยอดที่ส่งมาตรงกับที่นับได้จากข้อมูลดิบ) หน้าจอจึงข้ามขั้นไม่ได้แม้จะแก้โค้ดหน้าเว็บ
 */

export type PayrunDone = { ok: true } | { ok: false; reason: string; mismatch?: unknown };

/** ข้อความอธิบายเหตุที่ฐานข้อมูลไม่รับ */
export const PAYRUN_REASON: Record<string, string> = {
  no_backend: "ยังไม่ได้ต่อฐานข้อมูล",
  not_hr: "ทำได้เฉพาะฝ่ายบุคคล",
  not_ceo: "อนุมัติยอดเงินเดือนได้เฉพาะผู้บริหาร",
  period_open: "รอบเวลาทำงานยังไม่ปิด",
  not_approved: "ผู้บริหารยังไม่อนุมัติยอดของรอบนี้",
  already_closed: "รอบจ่ายนี้ปิดไปแล้ว",
  not_closed: "รอบจ่ายนี้ยังไม่ได้ปิด",
  not_waiting: "ยอดของรอบนี้ไม่ได้รออนุมัติอยู่",
  need_reason: "ต้องกรอกเหตุผล",
  payrun_open: "ยังไม่ได้ปิดรอบจ่าย จึงออกสลิปไม่ได้",
  mismatch: "ยอดที่ส่งไม่ตรงกับที่ฐานข้อมูลนับได้จากข้อมูลดิบ",
  slip_published: "สลิปของรอบนี้เผยแพร่ไปแล้ว",
};

const day = (v: string | null): string => {
  if (!v) return "";
  const th = new Date(new Date(v).toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  const p = (n: number) => `${n}`.padStart(2, "0");
  return `${th.getFullYear()}-${p(th.getMonth() + 1)}-${p(th.getDate())}`;
};
const code = (id: string | null) => (id ? personById(id)?.empNo ?? "" : "");

type RunRow = {
  month: string;
  pay_group: PayGroup;
  closed: boolean;
  closed_at: string | null;
  closed_by: string | null;
  sum: CycleSum | null;
};
type ReopenRow = { month: string; pay_group: PayGroup; why: string; at: string; by: string | null };

/**
 * รอบจ่ายของทุกเดือนที่เลือกได้ — รูปเดียวกับรอบเวลาทำงาน (หนึ่งแถวต่อเดือน สองกลุ่มในแถวเดียว)
 * ยอดที่บันทึกไว้ตอนปิด (sum) ติดมาด้วย หน้าประวัติรอบจะได้กางดูได้โดยไม่ต้องคำนวณใหม่
 */
export async function fetchPayruns(): Promise<Period[]> {
  const base = blankPeriods();
  const sb = supabase();
  if (!sb || !(await signedIn())) return base;

  const [runs, reopens] = await Promise.all([
    sb.from("payruns").select("month, pay_group, closed, closed_at, closed_by, sum"),
    sb.from("pay_reopens").select("month, pay_group, why, at, by").eq("kind", "payrun"),
  ]);
  const rows = ((runs.data ?? []) as RunRow[]).filter((r) => r.closed);
  const back = (reopens.data ?? []) as ReopenRow[];

  const months = [...new Set([...base.map((p) => p.month), ...rows.map((r) => r.month), ...back.map((r) => r.month)])].sort();
  const history = (month: string, group: PayGroup): Reopen[] =>
    back
      .filter((r) => r.month === month && r.pay_group === group)
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((r) => ({ at: day(r.at), by: code(r.by), why: r.why }));

  return months.map((month) => {
    const m = rows.find((r) => r.month === month && r.pay_group === "month");
    const d = rows.find((r) => r.month === month && r.pay_group === "day");
    return {
      month,
      closed: Boolean(m),
      closedAt: day(m?.closed_at ?? null),
      closedBy: code(m?.closed_by ?? null),
      reopened: history(month, "month"),
      dayClosed: Boolean(d),
      dayClosedAt: day(d?.closed_at ?? null),
      dayClosedBy: code(d?.closed_by ?? null),
      dayReopened: history(month, "day"),
      sum: m?.sum ?? null,
      daySum: d?.sum ?? null,
    };
  });
}

type ApproveRow = {
  month: string;
  pay_group: PayGroup;
  status: "draft" | "waiting" | "approved" | "rejected";
  people: number | null;
  net: number | string | null;
  ss: number | string | null;
  sent_by: string | null;
  sent_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  reason: string;
  void_why: string;
};

/** ยอดที่ส่งให้ CEO และผลการตัดสิน — คีย์เป็น "เดือน|กลุ่ม" เหมือนที่หน้าจอใช้ */
export async function fetchPayApprovals(): Promise<Record<string, PayApproval>> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return {};

  const { data } = await sb
    .from("pay_approvals")
    .select("month, pay_group, status, people, net, ss, sent_by, sent_at, decided_by, decided_at, reason, void_why");

  const out: Record<string, PayApproval> = {};
  for (const r of (data ?? []) as ApproveRow[]) {
    out[`${r.month}|${r.pay_group}`] = {
      status: r.status,
      people: r.people ?? 0,
      net: Number(r.net ?? 0),
      ss: Number(r.ss ?? 0),
      sentBy: code(r.sent_by),
      sentAt: day(r.sent_at),
      by: code(r.decided_by),
      at: day(r.decided_at),
      reason: r.reason,
      voidWhy: r.void_why,
    } as PayApproval;
  }
  return out;
}

type SlipRow = {
  month: string;
  pay_group: PayGroup;
  made_at: string | null;
  published: boolean;
  published_at: string | null;
  published_by: string | null;
};

/**
 * สลิปของแต่ละรอบ — ฐานข้อมูลเก็บแยกแถวต่อกลุ่ม ส่วนหน้าจอใช้แถวเดียวต่อเดือน
 * จึงยุบสองกลุ่มเข้าด้วยกันตรงนี้ (รูปเดียวกับรอบเวลาทำงานและรอบจ่าย)
 */
export async function fetchSlips(): Promise<Slip[]> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return [];

  const [slips, backs] = await Promise.all([
    sb.from("payslips").select("month, pay_group, made_at, published, published_at, published_by"),
    sb.from("pay_reopens").select("month, pay_group, why, at, by").eq("kind", "slip"),
  ]);
  const rows = (slips.data ?? []) as SlipRow[];
  const back = (backs.data ?? []) as ReopenRow[];
  const history = (month: string, group: PayGroup): Reopen[] =>
    back
      .filter((r) => r.month === month && r.pay_group === group)
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((r) => ({ at: day(r.at), by: code(r.by), why: r.why }));

  const months = [...new Set(rows.map((r) => r.month))].sort();
  return months.map((month) => {
    const m = rows.find((r) => r.month === month && r.pay_group === "month");
    const d = rows.find((r) => r.month === month && r.pay_group === "day");
    return {
      month,
      published: Boolean(m?.published),
      madeAt: day(m?.made_at ?? null),
      publishedAt: day(m?.published_at ?? null),
      by: code(m?.published_by ?? null),
      dayMadeAt: day(d?.made_at ?? null),
      dayPublished: Boolean(d?.published),
      dayPublishedAt: day(d?.published_at ?? null),
      dayBy: code(d?.published_by ?? null),
      dayUnpublished: history(month, "day"),
      unpublished: history(month, "month"),
      /* จำนวนครั้งที่เปิดดู/ดาวน์โหลดเก็บคนละตาราง (payslip_reads) ยังไม่ได้ย้ายมา */
      views: {},
      downloads: {},
    };
  });
}

/* ─── เขียน ────────────────────────────────────────────────────────── */

async function call(fn: string, args: Record<string, unknown>): Promise<PayrunDone> {
  const sb = supabase();
  if (!sb) return { ok: false, reason: "no_backend" };
  const { data, error } = await sb.rpc(fn, args);
  if (error) return { ok: false, reason: error.message };
  const res = (data ?? {}) as { ok?: boolean; reason?: string; mismatch?: unknown };
  return res.ok ? { ok: true } : { ok: false, reason: res.reason ?? "unknown", mismatch: res.mismatch };
}

/** ฝ่ายบุคคลส่งยอดให้ CEO ดู — ต้องปิดรอบเวลาทำงานก่อน (ฐานข้อมูลกันเอง) */
export function sendPayroll(
  month: string,
  group: PayGroup,
  snap: { people: number; net: number; ss: number },
  /* ค่าคอมและวันขาดงานชุดเดียวกับที่หน้าจอใช้แสดง — ฐานข้อมูลคิดซ้ำด้วยชุดนี้แล้วเทียบ */
  basis?: { commission: Record<string, number>; absent: Record<string, number> },
) {
  return call("send_payroll", {
    p_month: month,
    p_group: group,
    p_people: snap.people,
    p_net: snap.net,
    p_ss: snap.ss,
    p_commission: basis?.commission ?? {},
    p_absent: basis?.absent ?? {},
  });
}

/** CEO อนุมัติหรือตีกลับ — ตีกลับต้องมีเหตุผล */
export function decidePayrollRemote(month: string, group: PayGroup, ok: boolean, why: string) {
  return call("decide_payroll", { p_month: month, p_group: group, p_ok: ok, p_why: why });
}

/**
 * ปิดรอบจ่าย — ส่งยอดรวมและบรรทัดรายคนขึ้นไปเก็บไว้
 * ฐานข้อมูลตรวจเองว่าตัวเลขชั่วโมงทำงาน นาทีสาย และชั่วโมงโอทีตรงกับข้อมูลดิบ
 */
export function closePayrunRemote(
  month: string,
  group: PayGroup,
  sum: CycleSum,
  lines: { employee_id: string; line: unknown; net: number }[],
  basis?: { commission: Record<string, number>; absent: Record<string, number> },
) {
  return call("close_payrun", {
    p_month: month,
    p_group: group,
    p_sum: sum,
    p_lines: lines,
    p_commission: basis?.commission ?? {},
    p_absent: basis?.absent ?? {},
  });
}

export function reopenPayrunRemote(month: string, group: PayGroup, why: string) {
  return call("reopen_payrun", { p_month: month, p_group: group, p_why: why });
}

export function publishSlipsRemote(month: string, group: PayGroup) {
  return call("publish_slips", { p_month: month, p_group: group });
}

export function unpublishSlipsRemote(month: string, group: PayGroup, why: string) {
  return call("unpublish_slips", { p_month: month, p_group: group, p_why: why });
}
