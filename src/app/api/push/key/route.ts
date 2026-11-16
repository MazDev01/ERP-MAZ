import { hasPush, pushPublicKey } from "@/lib/supabase/push";

/*
 * กุญแจสาธารณะของระบบ — เบราว์เซอร์ต้องใช้ตอนขอ subscription
 * เปิดเผยได้ ไม่ใช่ความลับ (คู่ของมันคือกุญแจลับที่อยู่แต่บนเซิร์ฟเวอร์)
 */
export async function GET() {
  if (!hasPush) return Response.json({ ok: false, reason: "no_push" }, { status: 503 });
  return Response.json({ ok: true, publicKey: pushPublicKey() });
}
