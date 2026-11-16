import { notifyDoc } from "@/lib/supabase/push";

/*
 * หน้าจอบอกว่า "ใบนี้เพิ่งเปลี่ยนสถานะ" แล้วเซิร์ฟเวอร์เป็นคนตัดสินเองว่าจะส่งอะไรให้ใคร
 * ไม่รับหัวข้อหรือรายชื่อผู้รับจากหน้าจอ เพราะจะกลายเป็นช่องส่งข้อความหาใครก็ได้
 */
export async function POST(request: Request) {
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
