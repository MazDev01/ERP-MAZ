import { notifyDoc } from "@/lib/supabase/push";

/*
 * ฐานข้อมูลเรียกเข้ามาเองเมื่อสถานะใบเปลี่ยน (ทริกเกอร์ notify_push_hook)
 *
 * คำขอทางนี้ไม่มี session ของใคร จึงต้องพิสูจน์ตัวด้วยกุญแจลับที่ตั้งไว้สองฝั่ง
 * กุญแจไม่ตรง = ตอบ 401 เฉย ๆ ไม่บอกว่าผิดตรงไหน
 */
export async function POST(request: Request) {
  const secret = process.env.PUSH_HOOK_SECRET ?? "";
  if (!secret || request.headers.get("x-maz-hook") !== secret) {
    return Response.json({ ok: false, reason: "no_right" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, reason: "bad_json" }, { status: 400 });
  }

  const kind = String(body.kind ?? "");
  if (kind !== "leave" && kind !== "ot" && kind !== "expense") {
    return Response.json({ ok: false, reason: "bad_kind" }, { status: 400 });
  }

  const result = await notifyDoc(kind, String(body.id ?? ""), true);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
