import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, hasBackend } from "@/lib/supabase/env";
import { serverSupabase } from "@/lib/supabase/server";

/*
 * ล็อกอินด้วยชื่อผู้ใช้ — ต้องผ่านฝั่งเซิร์ฟเวอร์ ทำบนเบราว์เซอร์ตรง ๆ ไม่ได้
 *
 * เหตุผลสามข้อ
 *   ชื่อผู้ใช้มีอักษรไทยได้ (suggestUser ใน hr-data.ts) จึงใช้เป็นอีเมลไม่ได้
 *   อีเมลที่ระบบ auth ใช้เป็นอีเมลแฝงจากรหัสพนักงาน ซึ่งคนยังไม่ล็อกอินอ่านไม่ได้ตาม RLS
 *   การนับรหัสผิดและระงับบัญชีต้องใช้กุญแจ service role
 */

const admin = () => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!hasBackend || !key) return null;
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
};

export async function POST(request: Request) {
  const sv = admin();
  if (!sv) return Response.json({ ok: false, reason: "no_backend" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, reason: "bad_json" }, { status: 400 });
  }
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  if (!username || !password) {
    return Response.json({ ok: false, reason: "missing" }, { status: 400 });
  }

  /* หาเจ้าของชื่อผู้ใช้ — เทียบแบบไม่สนตัวพิมพ์เล็กใหญ่เหมือน index ในฐานข้อมูล */
  const { data: acc } = await sv
    .from("user_accounts")
    .select("user_id, employee_id, roles, status, must_change_password, failed_attempts")
    .ilike("username", username)
    .maybeSingle();

  /* ไม่มีชื่อนี้ — ตอบเหมือนรหัสผิด ไม่บอกว่าชื่อผู้ใช้ไม่มีในระบบ */
  if (!acc) return Response.json({ ok: false, reason: "bad_credentials" }, { status: 401 });
  if (acc.status === "suspended") {
    return Response.json({ ok: false, reason: "suspended" }, { status: 403 });
  }

  const { data: emp } = await sv
    .from("employees")
    .select("emp_no")
    .eq("id", acc.employee_id)
    .maybeSingle();
  if (!emp?.emp_no) return Response.json({ ok: false, reason: "no_employee" }, { status: 400 });

  /* เข้าระบบผ่านตัวต่อฝั่งเซิร์ฟเวอร์ เพื่อให้ cookie ของ session ถูกตั้งให้เบราว์เซอร์ */
  const sb = await serverSupabase();
  if (!sb) return Response.json({ ok: false, reason: "no_backend" }, { status: 400 });

  const { error } = await sb.auth.signInWithPassword({
    email: `${emp.emp_no.toLowerCase()}@maz.local`,
    password,
  });

  if (error) {
    const { data: fail } = await sv.rpc("register_login_failure", { p_username: username });
    const tries = (fail as { attempts?: number } | null)?.attempts ?? 0;
    const locked = (fail as { status?: string } | null)?.status === "suspended";
    return Response.json(
      { ok: false, reason: locked ? "suspended" : "bad_credentials", attempts: tries },
      { status: locked ? 403 : 401 },
    );
  }

  await sv.rpc("register_login_success", { p_user: acc.user_id });

  return Response.json({
    ok: true,
    roles: acc.roles,
    mustChange: acc.must_change_password,
  });
}
