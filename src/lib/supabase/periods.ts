"use client";

import { supabase } from "./client";
import { loadPeople, personById } from "./people";
import { bkkNow, pad2 } from "../format";
import { fillPeriod, type PayGroup, type Period, type Reopen } from "../hr-data";

/*
 * รอบเวลาทำงานจากฐานข้อมูล — แปลงไปเป็นรูปเดียวกับที่หน้าจอใช้อยู่เดิม (Period)
 *
 * รูปในฐานข้อมูลกับรูปบนหน้าจอไม่เหมือนกันอยู่อย่างหนึ่ง
 *   ฐานข้อมูล: หนึ่งแถวต่อ (เดือน, กลุ่มการจ่าย) และมีแถวเฉพาะรอบที่ "ปิดแล้ว"
 *   หน้าจอ:    หนึ่งแถวต่อเดือน มีธงของทั้งสองกลุ่มอยู่ในแถวเดียว และต้องมีทุกเดือนให้เลือก
 * ที่นี่จึงสร้างรายการเดือนขึ้นเอง แล้วเอาสถานะที่ปิดไว้จากฐานข้อมูลไปแปะ
 *
 * ของเดิมรายการเดือนเป็นข้อมูลจำลองตรึงไว้ที่ ก.ค.–ก.ย. 2569 เดือนปัจจุบันจึงเลือกไม่ได้
 */

/** กี่เดือนย้อนหลังที่ให้เลือกได้ — พอสำหรับดูรอบที่ปิดไปแล้ว ไม่ยาวจนดรอปดาวน์อ่านไม่ไหว */
const BACK_MONTHS = 6;

const monthOf = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;

/** เดือนนี้ย้อนหลังไป BACK_MONTHS เดือน (เวลาไทย) เรียงจากเก่าไปใหม่ */
export function recentMonths(): string[] {
  const now = bkkNow();
  const out: string[] = [];
  for (let i = BACK_MONTHS - 1; i >= 0; i -= 1) {
    out.push(monthOf(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  }
  return out;
}

/** รายการเดือนตอนยังอ่านฐานข้อมูลไม่เสร็จ — ว่างจริง ไม่มีรอบไหนปิด */
export function blankPeriods(): Period[] {
  return recentMonths().map((month) =>
    fillPeriod({
      month,
      closed: false,
      closedAt: "",
      closedBy: "",
      reopened: [],
      dayClosed: false,
      dayClosedAt: "",
      dayClosedBy: "",
      dayReopened: [],
      sum: null,
      daySum: null,
    }),
  );
}

type Row = {
  month: string;
  pay_group: PayGroup;
  closed: boolean;
  closed_at: string | null;
  closed_by: string | null;
};

type ReopenRow = {
  month: string;
  pay_group: PayGroup;
  why: string;
  at: string;
  by: string | null;
};

/** uuid ของพนักงาน → รหัสในทะเบียน (E12) ที่หน้าจอใช้แสดงว่าใครปิดรอบ */
const codeOf = (id: string | null) => (id ? personById(id)?.empNo ?? "" : "");

/** วันที่แบบ "yyyy-mm-dd" ของเวลาไทย — หน้าจอโชว์แค่วัน ไม่ถึงนาที */
function dayOf(v: string | null): string {
  if (!v) return "";
  const th = new Date(new Date(v).toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  return `${th.getFullYear()}-${pad2(th.getMonth() + 1)}-${pad2(th.getDate())}`;
}

/**
 * รอบเวลาทำงานทั้งหมดที่ให้เลือกได้ พร้อมสถานะปิดจากฐานข้อมูล
 * (ตาราง pay_periods อ่านได้เฉพาะฝ่ายบุคคล — คนอื่นได้รายการเดือนเปล่า ๆ ซึ่งถูกแล้ว)
 */
export async function fetchPeriods(): Promise<Period[]> {
  const sb = supabase();
  if (!sb) return blankPeriods();
  await loadPeople();

  const [rows, reopens] = await Promise.all([
    sb.from("pay_periods").select("month, pay_group, closed, closed_at, closed_by"),
    sb.from("pay_reopens").select("month, pay_group, why, at, by").eq("kind", "period"),
  ]);

  const closedRows = ((rows.data ?? []) as Row[]).filter((r) => r.closed);
  const reopenRows = (reopens.data ?? []) as ReopenRow[];

  /* เดือนที่ให้เลือก = เดือนล่าสุดย้อนหลัง + เดือนที่มีร่องรอยอยู่ในฐานข้อมูลแล้ว
     รอบเก่ากว่านั้นที่ปิดไว้ต้องไม่หายจากรายการ ไม่งั้นดูประวัติไม่ได้ */
  const months = [
    ...new Set([
      ...recentMonths(),
      ...closedRows.map((r) => r.month),
      ...reopenRows.map((r) => r.month),
    ]),
  ].sort();

  const history = (month: string, group: PayGroup): Reopen[] =>
    reopenRows
      .filter((r) => r.month === month && r.pay_group === group)
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((r) => ({ at: dayOf(r.at), by: codeOf(r.by), why: r.why }));

  return months.map((month) => {
    const m = closedRows.find((r) => r.month === month && r.pay_group === "month");
    const d = closedRows.find((r) => r.month === month && r.pay_group === "day");
    return fillPeriod({
      month,
      closed: Boolean(m),
      closedAt: dayOf(m?.closed_at ?? null),
      closedBy: codeOf(m?.closed_by ?? null),
      reopened: history(month, "month"),
      dayClosed: Boolean(d),
      dayClosedAt: dayOf(d?.closed_at ?? null),
      dayClosedBy: codeOf(d?.closed_by ?? null),
      dayReopened: history(month, "day"),
      /* ยอดที่ปิดไว้เป็นของรอบเงินเดือน (payruns) ไม่ใช่ของรอบเวลาทำงาน */
      sum: null,
      daySum: null,
    });
  });
}

/* ─── เขียน ────────────────────────────────────────────────────────── */

export type PeriodDone = { ok: true } | { ok: false; reason: string };

/** ข้อความอธิบายเหตุที่ฐานข้อมูลไม่รับ */
export const PERIOD_REASON: Record<string, string> = {
  no_backend: "ยังไม่ได้ต่อฐานข้อมูล",
  not_hr: "ปิดหรือเปิดรอบได้เฉพาะฝ่ายบุคคล",
  already_closed: "รอบนี้ปิดไปแล้ว",
  not_closed: "รอบนี้ยังไม่ได้ปิด",
  need_reason: "ต้องกรอกเหตุผลเมื่อเปิดรอบใหม่",
  payrun_closed: "รอบเงินเดือนของเดือนนี้ปิดแล้ว ต้องเปิดรอบเงินเดือนก่อน",
};

export async function closePeriodRemote(month: string, group: PayGroup): Promise<PeriodDone> {
  const sb = supabase();
  if (!sb) return { ok: false, reason: "no_backend" };
  const { data, error } = await sb.rpc("close_period", {
    p_month: month,
    p_group: group,
    p_sum: null,
  });
  if (error) return { ok: false, reason: error.message };
  const res = (data ?? {}) as { ok?: boolean; reason?: string };
  return res.ok ? { ok: true } : { ok: false, reason: res.reason ?? "unknown" };
}

export async function reopenPeriodRemote(
  month: string,
  group: PayGroup,
  why: string,
): Promise<PeriodDone> {
  const sb = supabase();
  if (!sb) return { ok: false, reason: "no_backend" };
  const { data, error } = await sb.rpc("reopen_period", {
    p_month: month,
    p_group: group,
    p_why: why,
  });
  if (error) return { ok: false, reason: error.message };
  const res = (data ?? {}) as { ok?: boolean; reason?: string };
  return res.ok ? { ok: true } : { ok: false, reason: res.reason ?? "unknown" };
}
