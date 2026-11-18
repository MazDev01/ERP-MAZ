import type { PushPayload } from "@/lib/push-scenarios";
import { pushToMe } from "@/lib/supabase/push";

/*
 * ส่งแจ้งเตือนเข้าเครื่องของตัวเอง
 *
 * ตอนนี้รับเฉพาะ "ส่งถึงตัวเอง" เพราะยังไม่มีกติกาว่าใครมีสิทธิ์ยิงเข้าเครื่องคนอื่น
 * เรื่องที่ระบบส่งให้คนอื่น (มีใบรออนุมัติ · ใบถูกอนุมัติ) จะเรียก pushToEmployees
 * จากฝั่งเซิร์ฟเวอร์ตรง ๆ ไม่ผ่านทางนี้
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

  const p = (body.payload ?? {}) as Partial<PushPayload>;
  if (!p.title) return Response.json({ ok: false, reason: "no_title" }, { status: 400 });

  const result = await pushToMe({
    id: p.id ?? crypto.randomUUID(),
    title: p.title,
    body: p.body ?? "",
    url: p.url ?? "/",
    tag: p.tag ?? "maz-test",
    level: p.level ?? "info",
    event: p.event,
    vibrate: p.vibrate,
    requireInteraction: p.requireInteraction,
    renotify: p.renotify,
    silent: p.silent,
    badgeCount: p.badgeCount,
  });
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
