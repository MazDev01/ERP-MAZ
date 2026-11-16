import { dropDevice, saveDevice } from "@/lib/supabase/push";

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** เครื่องนี้ขอรับแจ้งเตือน — บันทึกในชื่อเจ้าของ session (RLS กันแอบลงในชื่อคนอื่น) */
export async function POST(request: Request) {
  const body = await readBody(request);
  if (!body) return Response.json({ ok: false, reason: "bad_json" }, { status: 400 });
  const result = await saveDevice(
    (body.subscription ?? {}) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } },
    String(body.label ?? body.platform ?? ""),
  );
  return Response.json(result, { status: result.ok ? 200 : 400 });
}

/** เลิกรับแจ้งเตือนบนเครื่องนี้ */
export async function DELETE(request: Request) {
  const body = await readBody(request);
  if (!body) return Response.json({ ok: false, reason: "bad_json" }, { status: 400 });
  const result = await dropDevice(String(body.endpoint ?? ""));
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
