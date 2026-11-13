import {
  createAccount,
  removeAccount,
  setAccountRoles,
  setAccountStatus,
} from "@/lib/supabase/accounts";

/** อ่าน body แบบไม่ให้ JSON เสียทำให้ 500 */
async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

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

/**
 * แก้บัญชีที่มีอยู่ — เปลี่ยนบทบาท หรือระงับ/คืนสิทธิ์
 * ตรวจว่าคนเรียกเป็นฝ่ายบุคคลในชั้น accounts.ts เหมือนกับการสร้างบัญชี
 */
export async function PATCH(request: Request) {
  const body = await readBody(request);
  if (!body) return Response.json({ ok: false, reason: "bad_json" }, { status: 400 });

  const employeeId = String(body.employeeId ?? "");
  const result = Array.isArray(body.roles)
    ? await setAccountRoles({ employeeId, roles: body.roles.map(String) })
    : await setAccountStatus({
        employeeId,
        status: body.status === "suspended" ? "suspended" : "active",
      });

  return Response.json(result, { status: result.ok ? 200 : 400 });
}

/** ลบบัญชีเข้าระบบ — พนักงานยังอยู่ในทะเบียน */
export async function DELETE(request: Request) {
  const body = await readBody(request);
  if (!body) return Response.json({ ok: false, reason: "bad_json" }, { status: 400 });

  const result = await removeAccount({ employeeId: String(body.employeeId ?? "") });
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
