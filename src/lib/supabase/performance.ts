"use client";

import { signedIn, supabase } from "./client";

/*
 * ตัวเลขประสิทธิภาพพนักงาน (รอบที่ 136)
 *
 * อ่านเป็น "ยอดรวมรายคน" ผ่านฟังก์ชันของฐานข้อมูลเท่านั้น
 * เพราะผู้จัดการทั่วไปไม่มีสิทธิ์อ่านตารางตอกบัตรหรือใบงานรายใบของคนอื่น
 * ฟังก์ชันทั้งสองกันสิทธิ์ด้วย can_see_perf() — บทบาทอื่นเรียกได้แต่ได้ศูนย์แถว
 */

/** การเข้างานรายคนในช่วง — days = วันที่มาทำงานจริง */
export type PerfAtt = { empNo: string; days: number; onTime: number; late: number; avgIn: number | null };

/** งานรายคนในช่วง — นับจากใบงานที่ครบกำหนดในช่วงนั้น */
export type PerfTask = { empNo: string; total: number; doneOn: number; doneLate: number; waiting: number; overdue: number };

type AttRow = { emp_no: string; days: number; on_time: number; late: number; avg_in: string | number | null };
type TaskRow = { emp_no: string; total: number; done_on: number; done_late: number; waiting: number; overdue: number };

export async function fetchPerfAttendance(from: string, to: string): Promise<PerfAtt[]> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return [];
  const got = await sb.rpc("perf_attendance", { p_from: from, p_to: to });
  if (got.error) return [];
  return ((got.data ?? []) as unknown as AttRow[]).map((r) => ({
    empNo: r.emp_no,
    days: Number(r.days),
    onTime: Number(r.on_time),
    late: Number(r.late),
    avgIn: r.avg_in == null ? null : Number(r.avg_in),
  }));
}

export async function fetchPerfTasks(from: string, to: string): Promise<PerfTask[]> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return [];
  const got = await sb.rpc("perf_tasks", { p_from: from, p_to: to });
  if (got.error) return [];
  return ((got.data ?? []) as unknown as TaskRow[]).map((r) => ({
    empNo: r.emp_no,
    total: Number(r.total),
    doneOn: Number(r.done_on),
    doneLate: Number(r.done_late),
    waiting: Number(r.waiting),
    overdue: Number(r.overdue),
  }));
}
