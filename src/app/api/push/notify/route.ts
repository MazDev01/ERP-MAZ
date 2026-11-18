import { notifyDoc } from "@/lib/supabase/push";

/*
 * หน้าจอบอกว่า "ใบนี้เพิ่งเปลี่ยนสถานะ" แล้วเซิร์ฟเวอร์เป็นคนตัดสินเองว่าจะส่งอะไรให้ใคร
 * ไม่รับหัวข้อหรือรายชื่อผู้รับจากหน้าจอ เพราะจะกลายเป็นช่องส่งข้อความหาใครก็ได้
 */
import { serverSupabase } from "@/lib/supabase/server";

/*
 * ทางนี้ต้องมี session เสมอ — ยังไม่ล็อกอินก็ไม่มีเครื่องของตัวเองให้ส่งถึง
 * ถ้าไม่กั้นตั้งแต่ต้น คนนอกยิงเข้ามารัว ๆ ได้ แล้วเซิร์ฟเวอร์เสียเวลาไปค้นฐานข้อมูลทุกครั้ง
 */
async function signedIn() {
  const sb = await serverSupabase();
  if (!sb) return false;
  const { data } = await sb.auth.getUser();
  return Boolean(data.user);
}

export async function POST(request: Request) {
  if (!(await signedIn())) {
    return Response.json({ ok: false, reason: "no_session" }, { status: 401 });
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

  const result = await notifyDoc(kind, String(body.id ?? ""));
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
