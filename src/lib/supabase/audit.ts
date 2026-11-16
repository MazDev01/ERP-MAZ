"use client";

import { signedIn, supabase } from "./client";
import { personById } from "./people";

/*
 * ประวัติการกระทำ — ใครเปลี่ยนอะไรเมื่อไร
 *
 * ของเดิมเก็บในเครื่องที่เปิดหน้าอยู่ และเก็บได้ไม่เกิน 300 รายการเพราะกลัว localStorage เต็ม
 * ประวัติที่อยู่เฉพาะเครื่องคนที่แก้ ไม่ใช่ประวัติ — คนอื่นตรวจย้อนไม่ได้เลย
 *
 * ตอนนี้ลงที่ตาราง setting_log ซึ่งเขียนได้อย่างเดียว ห้ามแก้ห้ามลบ
 * และอ่านได้เฉพาะฝ่ายบุคคลกับผู้บริหาร (RLS log_read)
 */

export type ChangeRow = {
  id: string;
  at: string;
  by: string;
  area: string;
  detail: string;
};

/** "yyyy-mm-dd hh:mm" เวลาไทย — รูปเดียวกับที่หน้าจอใช้อยู่ */
function stamp(v: string | null): string {
  if (!v) return "";
  const th = new Date(new Date(v).toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  const p = (n: number) => `${n}`.padStart(2, "0");
  return `${th.getFullYear()}-${p(th.getMonth() + 1)}-${p(th.getDate())} ${p(th.getHours())}:${p(th.getMinutes())}`;
}

type Row = {
  id: number;
  at: string;
  by: string | null;
  by_name: string;
  area: string;
  detail: string;
};

/** ประวัติล่าสุด — ใหม่สุดขึ้นก่อน */
export async function fetchChangeLog(limit = 300): Promise<ChangeRow[]> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return [];

  const { data, error } = await sb
    .from("setting_log")
    .select("id, at, by, by_name, area, detail")
    .order("at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];

  return (data as Row[]).map((r) => ({
    id: String(r.id),
    at: stamp(r.at),
    /* ชื่อที่บันทึกไว้ตอนนั้นมาก่อน — คนเปลี่ยนชื่อเล่นทีหลังประวัติต้องไม่เปลี่ยนตาม */
    by: r.by_name || (r.by ? personById(r.by)?.name ?? "" : ""),
    area: r.area,
    detail: r.detail,
  }));
}

/** ลงประวัติหนึ่งรายการ — ชื่อผู้ทำส่งไปจากหน้าจอ เพราะบัญชีที่ไม่ใช่พนักงานไม่มีชื่อในทะเบียน */
export async function writeChangeLog(area: string, detail: string, byName: string): Promise<boolean> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return false;
  const { error } = await sb.rpc("log_setting", {
    p_area: area,
    p_detail: detail,
    p_by_name: byName,
  });
  return !error;
}
