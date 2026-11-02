import { resetPassword } from "@/lib/supabase/accounts";

/* ฝ่ายบุคคลรีเซ็ตรหัสผ่านให้พนักงาน — บัญชีนั้นต้องตั้งรหัสใหม่ก่อนใช้งานต่อ */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, reason: "bad_json" }, { status: 400 });
  }

  const result = await resetPassword({
    employeeId: String(body.employeeId ?? ""),
    tempPassword: String(body.tempPassword ?? ""),
  });

  return Response.json(result, { status: result.ok ? 200 : 400 });
}
