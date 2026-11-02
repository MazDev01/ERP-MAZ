import { setOwnPassword } from "@/lib/supabase/accounts";

/* เจ้าตัวตั้งรหัสใหม่ — ครั้งแรกที่เข้าระบบ หรือเปลี่ยนเองภายหลัง */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, reason: "bad_json" }, { status: 400 });
  }

  const result = await setOwnPassword(String(body.password ?? ""));
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
