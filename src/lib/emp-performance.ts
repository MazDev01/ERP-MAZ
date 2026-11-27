"use client";

/*
 * ประสิทธิภาพพนักงาน — ตัวเลขของหน้า /gm/performance (ยกหน้ามาจาก ERP_Test · รอบที่ 136)
 *
 * วัดแยกกัน ไม่มีคะแนนรวม และไม่เทียบข้ามตำแหน่ง (เจ้าของตัดสินไว้ก่อนแล้ว)
 *   ก. งาน — ใบงานที่ครบกำหนดในช่วง ส่งรอบแรกทันกำหนดไหม
 *      ใบที่รอลูกค้าตรวจอยู่ ไม่นับเป็นความช้าของคนทำ และไม่อยู่ในตัวหาร
 *   ข. การเข้างาน — ตอกบัตรเข้าทันเวลาของตำแหน่งนั้นกี่วัน จากวันที่มาทำงาน
 *   ค. KPI — ระบบยังไม่มีข้อมูล KPI จริง จึงขึ้นว่า "ยังไม่มีข้อมูล" (ไม่ใส่ข้อมูลตัวอย่าง)
 *
 * ตัวเลขทั้งสองเรื่องมาจากฟังก์ชันของฐานข้อมูล (perf_attendance / perf_tasks)
 * ไม่ได้คิดจากตารางตอกบัตรหรือใบงานในเครื่อง เพราะ GM ไม่มีสิทธิ์อ่านรายใบของคนอื่น
 */

import { useEffect, useMemo, useState } from "react";
import { toIsoDate } from "./format";
import { fetchPerfAttendance, fetchPerfTasks, type PerfAtt, type PerfTask } from "./supabase/performance";
import { rangeOf, type RangeKey } from "./sales-report";

export type { RangeKey };

export const RANGE_KEYS: RangeKey[] = ["m", "q", "y"];
export const PERIOD_TEXT: Record<RangeKey, string> = { m: "ในเดือนนี้", q: "ในไตรมาสนี้", y: "ในปีนี้" };

export function rangeKeyOf(v?: string | null): RangeKey {
  return v === "q" || v === "y" ? v : "m";
}

/** ช่วงวันของตัวเลือก — ตัดท้ายไม่ให้เกินวันนี้ ตัวเลขจะไม่ถูกหารด้วยวันที่ยังไม่มาถึง */
export function spanOf(key: RangeKey, today: string) {
  const r = rangeOf(key, new Date(today));
  const end = toIsoDate(new Date(today));
  return { from: r.from, to: r.to > end ? end : r.to, note: r.note };
}

/** แถบวัดหนึ่งเรื่อง — pct เป็น null เมื่อยังไม่มีอะไรให้วัด (ไม่ใช่ 0%) */
export type Measure = { pct: number | null; denom: number };

export type Band = "good" | "warn" | "bad" | "none";

export const BAND_LABEL: Record<Band, string> = {
  good: "ดี",
  warn: "ต้องดูแล",
  bad: "ต้องแก้",
  none: "ไม่มีข้อมูล",
};

export const BAND_CLS: Record<Band, { chip: string; fill: string }> = {
  good: { chip: "bg-emerald-50 text-emerald-700 ring-emerald-200", fill: "bg-emerald-500" },
  warn: { chip: "bg-amber-50 text-amber-700 ring-amber-200", fill: "bg-amber-500" },
  bad: { chip: "bg-rose-50 text-rose-700 ring-rose-200", fill: "bg-rose-500" },
  none: { chip: "bg-muted text-muted-foreground ring-border", fill: "bg-muted-foreground/40" },
};

/** เกณฑ์สีเดียวกันทุกแถบ — 90% ขึ้นไปดี · 75% ขึ้นไปต้องดูแล · ต่ำกว่านั้นต้องแก้ */
export function bandOf(pct: number | null): Band {
  if (pct == null) return "none";
  if (pct >= 90) return "good";
  if (pct >= 75) return "warn";
  return "bad";
}

const pctOf = (hit: number, denom: number) => (denom > 0 ? Math.round((hit / denom) * 100) : null);

export type PerfOf = {
  task: { denom: number; onTime: number; late: number; waiting: number; overdue: number; pct: number | null };
  att: { days: number; onTime: number; late: number; avgIn: number | null; pct: number | null };
};

/** รวมสองเรื่องของคนหนึ่งคน — ไม่มีแถวแปลว่าไม่มีอะไรให้วัดในช่วงนั้น */
export function perfOf(empNo: string, tasks: PerfTask[], att: PerfAtt[]): PerfOf {
  const t = tasks.find((r) => r.empNo === empNo);
  const a = att.find((r) => r.empNo === empNo);
  /* ตัวหารของงาน = ใบที่ส่งแล้ว + ใบที่เลยกำหนดยังไม่ส่ง — ใบที่รอลูกค้าตรวจไม่นับ */
  const denom = t ? t.doneOn + t.doneLate + t.overdue : 0;
  return {
    task: {
      denom,
      onTime: t?.doneOn ?? 0,
      late: t?.doneLate ?? 0,
      waiting: t?.waiting ?? 0,
      overdue: t?.overdue ?? 0,
      pct: pctOf(t?.doneOn ?? 0, denom),
    },
    att: {
      days: a?.days ?? 0,
      onTime: a?.onTime ?? 0,
      late: a?.late ?? 0,
      avgIn: a?.avgIn ?? null,
      pct: pctOf(a?.onTime ?? 0, a?.days ?? 0),
    },
  };
}

/** "510" → "08:30" (เวลาเข้าเฉลี่ยเป็นนาทีของวัน) */
export function hhmm(min: number | null) {
  if (min == null) return "—";
  const m = Math.max(0, Math.round(min));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** โหลดตัวเลขของช่วงที่เลือก — เปลี่ยนช่วงแล้วโหลดใหม่ */
export function usePerfSources(range: RangeKey, today: string) {
  const span = useMemo(() => spanOf(range, today), [range, today]);
  /* เก็บช่วงที่โหลดมาคู่กับตัวเลข — "กำลังอ่าน" คือช่วงที่เลือกยังไม่ตรงกับช่วงที่โหลดไว้
     (ไม่ตั้งสถานะในตัว effect ตรง ๆ เพราะทำให้เรนเดอร์ซ้อนกัน) */
  const [got, setGot] = useState<{ key: string; tasks: PerfTask[]; att: PerfAtt[] } | null>(null);
  const key = `${span.from}~${span.to}`;

  useEffect(() => {
    let alive = true;
    void Promise.all([fetchPerfTasks(span.from, span.to), fetchPerfAttendance(span.from, span.to)]).then(([tk, at]) => {
      if (!alive) return;
      setGot({ key: `${span.from}~${span.to}`, tasks: tk, att: at });
    });
    return () => {
      alive = false;
    };
  }, [span.from, span.to]);

  const fresh = got?.key === key ? got : null;
  return { span, tasks: fresh?.tasks ?? [], att: fresh?.att ?? [], loading: !fresh };
}
