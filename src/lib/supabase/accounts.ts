import "server-only";

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, hasBackend } from "./env";
import { serverSupabase } from "./server";

/*
 * งานบัญชีผู้ใช้ที่ทำเป็นฟังก์ชันใน SQL ไม่ได้
 *
 * ผู้ใช้อยู่ในระบบ auth ของ Supabase ซึ่งเขียนตรงจาก SQL ไม่ปลอดภัย
 * ต้องเรียกผ่าน Admin API ด้วยกุญแจ service role ซึ่งข้าม RLS ได้ทั้งหมด
 * กุญแจนี้จึงอยู่ฝั่งเซิร์ฟเวอร์เท่านั้น และทุกเส้นทางต้องตรวจเองว่าคนเรียกเป็นใคร
 */

/** ตัวต่อที่ข้าม RLS — ใช้เฉพาะในไฟล์นี้ */
function adminAuth() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!hasBackend || !key) return null;
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/*
 * อีเมลแฝงของบัญชี — ชื่อผู้ใช้จริงมีอักษรไทยได้ จึงใช้เป็นอีเมลตรง ๆ ไม่ได้
 *
 * ไม่คิดจากรหัสพนักงานอีกแล้ว เพราะบัญชีไม่จำเป็นต้องผูกกับพนักงาน
 * (ผู้บริหารมีบัญชีแต่ไม่มีแถวในทะเบียน · เจ้าของสั่ง 2 พ.ย. 2569)
 * ไม่มีใครต้องพิมพ์อีเมลนี้ ขอแค่ไม่ซ้ำกับใคร — ตอนล็อกอินอ่านคืนจากระบบ auth
 */
const aliasEmail = () => `acc-${crypto.randomUUID()}@maz.local`;

export type AccountResult = { ok: true; data?: unknown } | { ok: false; reason: string };

/** คนที่กำลังเรียกเป็นฝ่ายบุคคลหรือไม่ — ถามฐานข้อมูลด้วยสิทธิ์ของเขาเอง ไม่เชื่อค่าใน token */
async function callerIsHr() {
  const sb = await serverSupabase();
  if (!sb) return false;
  const { data } = await sb.rpc("has_role", { r: "hr" });
  return data === true;
}

/** พนักงานคนนี้เป็นใคร และมีบัญชีอยู่แล้วหรือยัง */
async function employeeOf(admin: NonNullable<ReturnType<typeof adminAuth>>, employeeId: string) {
  const { data: emp } = await admin
    .from("employees")
    .select("id, emp_no, first_name, nick")
    .eq("id", employeeId)
    .maybeSingle();
  if (!emp) return null;
  const { data: acc } = await admin
    .from("user_accounts")
    .select("user_id")
    .eq("employee_id", employeeId)
    .maybeSingle();
  return { emp, acc };
}

/**
 * ฝ่ายบุคคลสร้างบัญชีให้พนักงานใหม่
 * บัญชีใหม่ต้องตั้งรหัสเองครั้งแรก รหัสที่ให้ไปจึงเป็นรหัสชั่วคราว
 */
export async function createAccount(input: {
  employeeId: string;
  username: string;
  roles: string[];
  tempPassword: string;
}): Promise<AccountResult> {
  const admin = adminAuth();
  if (!admin) return { ok: false, reason: "no_backend" };
  if (!(await callerIsHr())) return { ok: false, reason: "not_hr" };

  const username = input.username.trim();
  if (!/^[^\s@]{2,40}$/.test(username)) return { ok: false, reason: "bad_username" };
  if (input.roles.length < 1 || input.roles.length > 2) return { ok: false, reason: "bad_roles" };
  if (input.tempPassword.length < 8) return { ok: false, reason: "weak_password" };

  const found = await employeeOf(admin, input.employeeId);
  if (!found) return { ok: false, reason: "no_employee" };
  if (found.acc) return { ok: false, reason: "has_account" };

  const { data: created, error } = await admin.auth.admin.createUser({
    email: aliasEmail(),
    password: input.tempPassword,
    email_confirm: true,
  });
  if (error || !created.user) return { ok: false, reason: error?.message ?? "create_failed" };

  const { error: linkErr } = await admin.from("user_accounts").insert({
    user_id: created.user.id,
    employee_id: input.employeeId,
    username,
    roles: input.roles,
    must_change_password: true,
  });
  if (linkErr) {
    /* ผูกไม่สำเร็จแล้วปล่อยผู้ใช้ค้างไว้จะกลายเป็นบัญชีผี ลบทิ้งให้สะอาด */
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, reason: linkErr.message };
  }

  await admin.from("audit_log").insert({
    action: "create_account",
    target: input.employeeId,
    detail: { username, roles: input.roles },
  });
  return { ok: true, data: { username } };
}

/** ฝ่ายบุคคลรีเซ็ตรหัสผ่าน — บัญชีนั้นต้องตั้งรหัสใหม่ก่อนใช้งานต่อ */
export async function resetPassword(input: {
  employeeId: string;
  tempPassword: string;
}): Promise<AccountResult> {
  const admin = adminAuth();
  if (!admin) return { ok: false, reason: "no_backend" };
  if (!(await callerIsHr())) return { ok: false, reason: "not_hr" };
  if (input.tempPassword.length < 8) return { ok: false, reason: "weak_password" };

  const found = await employeeOf(admin, input.employeeId);
  if (!found?.acc) return { ok: false, reason: "no_account" };

  const { error } = await admin.auth.admin.updateUserById(found.acc.user_id, {
    password: input.tempPassword,
  });
  if (error) return { ok: false, reason: error.message };

  await admin
    .from("user_accounts")
    .update({ must_change_password: true, failed_attempts: 0, status: "active" })
    .eq("user_id", found.acc.user_id);

  await admin.from("audit_log").insert({ action: "reset_password", target: input.employeeId, detail: {} });
  return { ok: true };
}

/**
 * เจ้าตัวตั้งรหัสใหม่ — ใช้ทั้งตอนเข้าระบบครั้งแรกและตอนอยากเปลี่ยนเอง
 * ต้องล็อกอินอยู่แล้ว จึงเปลี่ยนผ่าน session ของตัวเอง ไม่ใช่กุญแจ service role
 */
export async function setOwnPassword(newPassword: string): Promise<AccountResult> {
  const sb = await serverSupabase();
  const admin = adminAuth();
  if (!sb || !admin) return { ok: false, reason: "no_backend" };
  if (newPassword.length < 8) return { ok: false, reason: "weak_password" };

  const { data: me } = await sb.auth.getUser();
  if (!me.user) return { ok: false, reason: "not_signed_in" };

  const { error } = await sb.auth.updateUser({ password: newPassword });
  if (error) return { ok: false, reason: error.message };

  /* ปลดธง "ต้องตั้งรหัสใหม่" — คอลัมน์นี้เจ้าตัวแก้เองไม่ได้ จึงต้องผ่านฝั่งเซิร์ฟเวอร์ */
  await admin.from("user_accounts").update({ must_change_password: false }).eq("user_id", me.user.id);
  return { ok: true };
}
