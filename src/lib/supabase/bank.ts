"use client";

import { signedIn, supabase } from "./client";

/*
 * บัญชีรับเงินเดือนของพนักงาน (รอบที่ 144)
 *
 * ช่องนี้ถูกถอดออกจากสิทธิ์อ่านของตาราง employees — อ่านได้ทางฟังก์ชันเท่านั้น
 *   bank_of(emp)  ฝ่ายบุคคล ผู้บริหาร และเจ้าของบัญชีเอง
 *   bank_list()   ฝ่ายบุคคลกับผู้บริหาร (ใช้กับใบสรุปเงินเดือนตอนโอน)
 *   bank_set(...) ฝ่ายบุคคลเท่านั้น
 */

export type BankAccount = { name: string; no: string };

/** บัญชีของคนเดียว — ไม่มีสิทธิ์หรือยังไม่กรอก คืนค่าว่าง */
export async function fetchBank(empId: string): Promise<BankAccount> {
  const sb = supabase();
  if (!sb || !empId || !(await signedIn())) return { name: "", no: "" };
  const got = await sb.rpc("bank_of", { p_emp: empId });
  if (got.error) return { name: "", no: "" };
  const row = (got.data as { bank_name?: string; bank_no?: string }[] | null)?.[0];
  return { name: row?.bank_name ?? "", no: row?.bank_no ?? "" };
}

/** บัญชีทั้งทีม สำหรับใบสรุปเงินเดือน — คีย์เป็นรหัสพนักงาน (เหมือน Employee.id ของหน้าเว็บ) */
export async function fetchBankList(): Promise<Record<string, BankAccount>> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return {};
  const got = await sb.rpc("bank_list");
  if (got.error) return {};
  const out: Record<string, BankAccount> = {};
  for (const r of (got.data ?? []) as { emp_no: string; bank_name: string; bank_no: string }[]) {
    out[r.emp_no] = { name: r.bank_name ?? "", no: r.bank_no ?? "" };
  }
  return out;
}

export type BankWrite = { ok: true } | { ok: false; message: string };

const SAY: Record<string, string> = {
  not_allowed: "เฉพาะฝ่ายบุคคลที่แก้บัญชีรับเงินเดือนได้",
  not_found: "ไม่พบพนักงานรายนี้",
  no_backend: "ยังไม่ได้ต่อฐานข้อมูล",
};

/** ฝ่ายบุคคลบันทึกบัญชีให้พนักงาน — เลขบัญชีต้องเป็นตัวเลข (ฐานข้อมูลกันอีกชั้น) */
export async function saveBank(empId: string, bank: BankAccount): Promise<BankWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return { ok: false, message: SAY.no_backend };
  const got = await sb.rpc("bank_set", { p_emp: empId, p_name: bank.name.trim(), p_no: bank.no.trim() });
  if (got.error) {
    return {
      ok: false,
      message: /เลขบัญชี/.test(got.error.message)
        ? "เลขบัญชีต้องเป็นตัวเลข (คั่นด้วยขีดหรือเว้นวรรคได้)"
        : "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง",
    };
  }
  const out = got.data as { ok?: boolean; reason?: string } | null;
  return out?.ok ? { ok: true } : { ok: false, message: SAY[out?.reason ?? ""] ?? "บันทึกไม่สำเร็จ" };
}

/** ข้อความบัญชีบรรทัดเดียว — "ธนาคารกสิกรไทย 123-4-56789-0" */
export const bankText = (b: BankAccount | undefined) =>
  [b?.name?.trim(), b?.no?.trim()].filter(Boolean).join(" ");
