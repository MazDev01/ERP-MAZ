"use client";

import { signedIn, supabase } from "./client";
import type { DocKey, EmpAccount, Employee, EmpStatus, EmpType, SalaryStep } from "../hr-data";
import type { Role } from "../role";

/*
 * ทะเบียนพนักงานจากฐานข้อมูล — แปลงไปเป็นรูปเดียวกับที่หน้าจอใช้อยู่เดิม (Employee)
 *
 * กติกาที่เจ้าของสั่งไว้ (2 พ.ย. 2569)
 *   บัญชีเข้าระบบ ≠ พนักงาน — ผู้บริหารมีบัญชีแต่ไม่มีแถวในทะเบียน
 *   ทะเบียนนี้จึงมีแต่ "คน" ที่ลงเวลา ลา และรับเงินเดือน ไม่มีบัญชีลอย ๆ
 *
 * ตำแหน่งงานกับบทบาทเป็นคนละชั้น — pos_key คือตำแหน่งงาน (website / dev)
 * ส่วน position คือบทบาทในระบบ (staff / pm) ที่สายอนุมัติและ RLS ใช้
 *
 * รหัสที่หน้าจอใช้เป็นกุญแจยังเป็นรหัสพนักงาน (emp_no) เหมือนเดิม
 * ของจริงในฐานข้อมูลเป็น uuid — การเปลี่ยนหน้าจอไปใช้ uuid เป็นงานขั้นถัดไป
 */

type AccountRow = {
  username: string;
  roles: string[] | null;
  status: string;
  must_change_password: boolean;
  created_at: string | null;
};

type StepRow = {
  effective: string;
  position: string;
  salary: number | string;
  note: string;
};

type Row = {
  id: string;
  emp_no: string | null;
  first_name: string;
  last_name: string;
  first_en: string;
  last_en: string;
  nick: string;
  sex: string;
  birth: string | null;
  position: string;
  pos_key: string;
  pos_more: string[] | null;
  emp_type: EmpType;
  status: EmpStatus;
  started_at: string;
  left_at: string | null;
  left_why: string;
  boss_id: string | null;
  phone: string;
  email: string;
  edu: string;
  exp: string[] | null;
  address: string;
  sos: { name?: string; rel?: string; phone?: string } | null;
  docs: string[] | null;
  leave_days: Record<string, number> | null;
  updated_at: string | null;
  is_demo: boolean;
  salary_steps: StepRow[] | null;
  user_accounts: AccountRow[] | AccountRow | null;
};

const COLS =
  "id, emp_no, first_name, last_name, first_en, last_en, nick, sex, birth, position, pos_key," +
  " pos_more, emp_type, status, started_at, left_at, left_why, boss_id, phone, email, edu, exp," +
  " address, sos, docs, leave_days, updated_at, is_demo," +
  " salary_steps (effective, position, salary, note)," +
  " user_accounts (username, roles, status, must_change_password, created_at)";

const one = (v: AccountRow[] | AccountRow | null): AccountRow | null =>
  Array.isArray(v) ? v[0] ?? null : v;

/** วันที่แบบ yyyy-mm-dd จาก timestamptz (เวลาไทย) */
function dayOf(v: string | null): string {
  if (!v) return "";
  const th = new Date(new Date(v).toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  const p = (n: number) => `${n}`.padStart(2, "0");
  return `${th.getFullYear()}-${p(th.getMonth() + 1)}-${p(th.getDate())}`;
}

function toEmployee(row: Row, codeOf: Map<string, string>): Employee {
  const history: SalaryStep[] = [...(row.salary_steps ?? [])]
    .sort((a, b) => a.effective.localeCompare(b.effective))
    .map((s) => ({
      at: s.effective,
      pos: s.position,
      salary: Number(s.salary),
      note: s.note,
    }));

  const acc = one(row.user_accounts);
  const account: EmpAccount | undefined = acc
    ? {
        user: acc.username,
        roles: (acc.roles ?? []) as Role[],
        status: acc.status === "suspended" ? "suspended" : "active",
        mustChange: acc.must_change_password,
        createdAt: dayOf(acc.created_at),
      }
    : undefined;

  /* ตำแหน่งงานเป็นของฝ่ายบุคคล ถ้ายังไม่ได้กรอกก็ใช้บทบาทไปก่อน ไม่ปล่อยว่าง
     เพราะหน้าจอเอาไปหาเวลาทำงานและกลุ่มการจ่ายต่อ */
  const pos = row.pos_key || row.position;

  return {
    id: row.emp_no ?? row.id,
    name: [row.first_name, row.last_name].filter(Boolean).join(" ").trim(),
    first: row.first_name,
    last: row.last_name,
    ...(row.first_en ? { firstEn: row.first_en } : {}),
    ...(row.last_en ? { lastEn: row.last_en } : {}),
    nick: row.nick,
    sex: row.sex,
    birth: row.birth ?? "",
    pos,
    ...((row.pos_more ?? []).length ? { posMore: row.pos_more as string[] } : {}),
    type: row.emp_type,
    status: row.status,
    startedAt: row.started_at,
    ...(row.left_at ? { leftAt: row.left_at } : {}),
    ...(row.left_why ? { leftWhy: row.left_why } : {}),
    boss: row.boss_id ? codeOf.get(row.boss_id) ?? "" : "",
    edu: row.edu,
    exp: row.exp ?? [],
    phone: row.phone,
    email: row.email,
    address: row.address,
    sos: {
      name: row.sos?.name ?? "",
      rel: row.sos?.rel ?? "",
      phone: row.sos?.phone ?? "",
    },
    docs: (row.docs ?? []) as DocKey[],
    history,
    ...(account ? { account } : {}),
    ...(row.leave_days && Object.keys(row.leave_days).length
      ? { leaveDays: row.leave_days }
      : {}),
  };
}

/**
 * ทะเบียนพนักงานทั้งหมดที่คนนี้มีสิทธิ์เห็น (RLS employees_read คัดให้)
 * ฝ่ายบุคคลเห็นทุกคน คนอื่นเห็นตัวเองกับลูกน้องและคนที่ตัวเองเป็นผู้อนุมัติ
 */
export async function fetchEmployees(): Promise<Employee[]> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return [];

  const { data, error } = await sb.from("employees").select(COLS).order("emp_no").limit(2000);
  if (error || !data) return [];

  const rows = data as unknown as Row[];
  /* หัวหน้าเก็บเป็น uuid ในฐานข้อมูล แต่หน้าจออ้างด้วยรหัสพนักงาน */
  const codeOf = new Map(rows.map((r) => [r.id, r.emp_no ?? r.id]));
  return rows.map((r) => toEmployee(r, codeOf));
}
