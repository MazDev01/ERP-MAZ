import { createAccount } from "@/lib/supabase/accounts";

/*
 * ฝ่ายบุคคลสร้างบัญชีเข้าระบบให้พนักงานใหม่
 * ตรวจว่าคนเรียกเป็นฝ่ายบุคคลจริงในชั้น accounts.ts ที่ถามฐานข้อมูลด้วยสิทธิ์ของเขาเอง
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, reason: "bad_json" }, { status: 400 });
  }

  const result = await createAccount({
    employeeId: String(body.employeeId ?? ""),
    username: String(body.username ?? ""),
    roles: Array.isArray(body.roles) ? body.roles.map(String) : [],
    tempPassword: String(body.tempPassword ?? ""),
  });

  return Response.json(result, { status: result.ok ? 200 : 400 });
}
