"use client";

import { signedIn, supabase } from "./client";
import type { PayGroup } from "../hr-data";

/*
 * เงินเดือนที่ฐานข้อมูลคำนวณให้ (ฟังก์ชัน payroll_lines · หลังบ้านรอบที่ 12)
 *
 * ของเดิมเบราว์เซอร์คิดเองทั้งหมดแล้วส่งยอดขึ้นไปปิดรอบ ใครแก้หน้าเว็บได้ก็เปลี่ยน
 * เงินที่ตัวเองจะได้ และเครื่องที่ตั้งค่าคนละชุดจะคำนวณออกมาคนละตัวเลข
 *
 * สองอย่างที่ฐานข้อมูลยังไม่รู้จึงส่งขึ้นไปด้วย — ฐานค่าคอม (งานขายยังไม่มีหลังบ้าน)
 * และวันขาดงานที่ฝ่ายบุคคลตรวจแล้ว (รายการต้องตรวจยังอยู่ในหน้าจอ)
 */

export type DbPayLine = {
  employee_id: string;
  emp_no: string | null;
  name: string;
  pos_key: string;
  pay_group: PayGroup;
  base: number;
  ot: number;
  com: number;
  inc: number;
  allow: number;
  adj: number;
  ss: number;
  late_min: number;
  late: number;
  absent_days: number;
  absent: number;
  unpaid_days: number;
  unpaid: number;
  gross: number;
  reimb: number;
  net: number;
  days: number;
  rate: number;
};

/** ตัวเลขที่ได้กลับมาเป็นข้อความเมื่อเป็น numeric ของ Postgres — แปลงให้ครบทุกช่อง */
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

function toLine(row: Record<string, unknown>): DbPayLine {
  return {
    employee_id: String(row.employee_id ?? ""),
    emp_no: (row.emp_no as string | null) ?? null,
    name: String(row.name ?? ""),
    pos_key: String(row.pos_key ?? ""),
    pay_group: row.pay_group === "day" ? "day" : "month",
    base: num(row.base),
    ot: num(row.ot),
    com: num(row.com),
    inc: num(row.inc),
    allow: num(row.allow),
    adj: num(row.adj),
    ss: num(row.ss),
    late_min: num(row.late_min),
    late: num(row.late),
    absent_days: num(row.absent_days),
    absent: num(row.absent),
    unpaid_days: num(row.unpaid_days),
    unpaid: num(row.unpaid),
    gross: num(row.gross),
    reimb: num(row.reimb),
    net: num(row.net),
    days: num(row.days),
    rate: num(row.rate),
  };
}

/**
 * บรรทัดเงินเดือนของทุกคนในรอบนั้น ตามที่ฐานข้อมูลคิด
 * คืนลิสต์ว่างเมื่อยังไม่ล็อกอินหรืออ่านไม่ได้ — ผู้เรียกตัดสินเองว่าจะใช้ของเดิมไปก่อนไหม
 */
export async function fetchPayrollLines(
  month: string,
  commission: Record<string, number> = {},
  absent: Record<string, number> = {},
): Promise<DbPayLine[]> {
  const sb = supabase();
  if (!sb || !month || !(await signedIn())) return [];

  const { data, error } = await sb.rpc("payroll_lines", {
    p_month: month,
    p_commission: commission,
    p_absent: absent,
  });
  if (error || !Array.isArray(data)) return [];
  return (data as Record<string, unknown>[]).map(toLine);
}
