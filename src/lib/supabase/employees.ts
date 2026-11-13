"use client";

import { signedIn, supabase } from "./client";
import { rolesOfPosition } from "../hr-data";
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

/* ─── เขียน ────────────────────────────────────────────────────────── */

export type EmpWrite = { ok: true; empNo: string } | { ok: false; reason: string };
export type EmpDone = { ok: true } | { ok: false; reason: string };

/** ข้อความอธิบายเหตุที่ฐานข้อมูลไม่รับ */
export const EMP_REASON: Record<string, string> = {
  no_backend: "ยังไม่ได้ต่อฐานข้อมูล",
  not_found: "ไม่พบพนักงานคนนี้ในทะเบียน",
  not_hr: "แก้ทะเบียนพนักงานได้เฉพาะฝ่ายบุคคล",
  no_name: "ต้องกรอกชื่อพนักงาน",
};

/** รหัสพนักงาน → id จริงในฐานข้อมูล */
async function idOf(empNo: string): Promise<string | null> {
  const sb = supabase();
  if (!sb) return null;
  const { data } = await sb.from("employees").select("id").eq("emp_no", empNo).maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

/** แยกชื่อ-นามสกุลจากช่องที่หน้าจอกรอกมา — กรอกแยกช่องมาก่อน ไม่มีค่อยตัดจากชื่อเต็ม */
function nameParts(e: { name?: string; first?: string; last?: string }) {
  if (e.first || e.last) return { first: (e.first ?? "").trim(), last: (e.last ?? "").trim() };
  const [first, ...rest] = (e.name ?? "").trim().split(/\s+/);
  return { first: first ?? "", last: rest.join(" ") };
}

/** ช่องของทะเบียนที่แปลงเป็นคอลัมน์ได้ตรง ๆ */
function toRow(e: Partial<Employee>, bossId: string | null | undefined) {
  const { first, last } = nameParts(e);
  const row: Record<string, unknown> = {};
  if (first || last) {
    row.first_name = first;
    row.last_name = last;
  }
  if (e.firstEn !== undefined) row.first_en = e.firstEn ?? "";
  if (e.lastEn !== undefined) row.last_en = e.lastEn ?? "";
  if (e.nick !== undefined) row.nick = e.nick;
  if (e.sex !== undefined) row.sex = e.sex;
  if (e.birth !== undefined) row.birth = e.birth || null;
  if (e.pos !== undefined) {
    row.pos_key = e.pos;
    /* บทบาทในระบบคิดจากตำแหน่งงาน — สายอนุมัติและ RLS อ่านช่องนี้ */
    row.position = rolesOfPosition(e.pos)[0] ?? "staff";
  }
  if (e.posMore !== undefined) row.pos_more = e.posMore ?? [];
  if (e.type !== undefined) row.emp_type = e.type;
  if (e.status !== undefined) row.status = e.status;
  if (e.startedAt !== undefined) row.started_at = e.startedAt;
  if (e.leftAt !== undefined) row.left_at = e.leftAt || null;
  if (e.leftWhy !== undefined) row.left_why = e.leftWhy ?? "";
  if (e.phone !== undefined) row.phone = e.phone;
  if (e.email !== undefined) row.email = e.email;
  if (e.edu !== undefined) row.edu = e.edu;
  if (e.exp !== undefined) row.exp = e.exp ?? [];
  if (e.address !== undefined) row.address = e.address;
  if (e.sos !== undefined) row.sos = e.sos ?? {};
  if (e.docs !== undefined) row.docs = e.docs ?? [];
  if (e.leaveDays !== undefined) row.leave_days = e.leaveDays ?? {};
  if (bossId !== undefined) row.boss_id = bossId;
  return row;
}

/** รหัสพนักงานถัดไป — ต่อจากเลขที่มากที่สุดในทะเบียน ไม่ใช่จำนวนแถว (คนพ้นสภาพยังอยู่) */
async function nextEmpNo(): Promise<string> {
  const sb = supabase();
  if (!sb) return "E01";
  const { data } = await sb.from("employees").select("emp_no").limit(2000);
  const max = ((data ?? []) as { emp_no: string | null }[]).reduce((n, r) => {
    const num = Number((r.emp_no ?? "").replace(/\D/g, ""));
    return Number.isFinite(num) ? Math.max(n, num) : n;
  }, 0);
  return `E${String(max + 1).padStart(2, "0")}`;
}

/**
 * เพิ่มพนักงานใหม่ — ใส่แถวทะเบียนแล้วต่อด้วยประวัติเงินเดือนแถวแรก
 *
 * ถ้าใส่ทะเบียนผ่านแต่ประวัติเงินเดือนพลาด จะได้คนที่ไม่มีฐานเงินเดือน
 * ซึ่งคำนวณเงินเดือนไม่ได้ จึงถอนแถวทะเบียนออกให้ ไม่ทิ้งคนครึ่ง ๆ ไว้
 */
export async function createEmployee(
  input: Omit<Employee, "id" | "status" | "history"> & { salary: number },
): Promise<EmpWrite> {
  const sb = supabase();
  if (!sb) return { ok: false, reason: "no_backend" };
  const { first, last } = nameParts(input);
  if (!first && !last) return { ok: false, reason: "no_name" };

  const boss = input.boss ? await idOf(input.boss) : null;
  const empNo = await nextEmpNo();
  const { data, error } = await sb
    .from("employees")
    .insert({ ...toRow(input, boss), emp_no: empNo, status: "active" })
    .select("id")
    .single();
  if (error || !data) return { ok: false, reason: error?.message ?? "insert_failed" };

  const id = (data as { id: string }).id;
  const { error: eStep } = await sb.from("salary_steps").insert({
    employee_id: id,
    effective: input.startedAt,
    position: input.pos,
    salary: input.salary,
    /* ต้นแบบบันทึก "เริ่มงาน" อย่างเดียวทุกประเภท */
    note: "เริ่มงาน",
  });
  if (eStep) {
    await sb.from("employees").delete().eq("id", id);
    return { ok: false, reason: eStep.message };
  }
  return { ok: true, empNo };
}

/** แก้ข้อมูลพนักงาน — ส่งเฉพาะช่องที่เปลี่ยน */
export async function saveEmployee(
  empNo: string,
  patch: Partial<Employee>,
  editedBy?: string,
): Promise<EmpDone> {
  const sb = supabase();
  if (!sb) return { ok: false, reason: "no_backend" };
  const id = await idOf(empNo);
  if (!id) return { ok: false, reason: "not_found" };

  const boss = patch.boss === undefined ? undefined : patch.boss ? await idOf(patch.boss) : null;
  const row = toRow(patch, boss);
  if (editedBy !== undefined) row.updated_at = new Date().toISOString();
  if (!Object.keys(row).length) return { ok: true };

  const { error } = await sb.from("employees").update(row).eq("id", id);
  return error ? { ok: false, reason: error.message } : { ok: true };
}

/**
 * ต่อประวัติตำแหน่ง/เงินเดือนอีกแถว — ไม่แก้แถวเดิม
 * ตัวเลขของรอบที่ผ่านไปแล้วต้องไม่เปลี่ยนตามการปรับเงินเดือนวันนี้
 */
export async function addSalaryStep(
  empNo: string,
  step: { at: string; pos: string; salary: number; note: string },
  /* ตำแหน่งปัจจุบันเปลี่ยนตามไปด้วยไหม — ปรับตำแหน่งใช่ · ผ่านทดลองงานไม่ใช่ */
  movePos = true,
): Promise<EmpDone> {
  const sb = supabase();
  if (!sb) return { ok: false, reason: "no_backend" };
  const id = await idOf(empNo);
  if (!id) return { ok: false, reason: "not_found" };

  const { error } = await sb.from("salary_steps").insert({
    employee_id: id,
    effective: step.at,
    position: step.pos,
    salary: step.salary,
    note: step.note,
  });
  if (error) return { ok: false, reason: error.message };

  if (movePos) {
    const { error: eUp } = await sb
      .from("employees")
      .update({ pos_key: step.pos, position: rolesOfPosition(step.pos)[0] ?? "staff" })
      .eq("id", id);
    if (eUp) return { ok: false, reason: eUp.message };
  }
  return { ok: true };
}
