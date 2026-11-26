import "server-only";

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, hasBackend } from "@/lib/supabase/env";

/*
 * เปิดรอบตรวจงานของลูกค้า (รอบที่ 119)
 *
 * ถังไฟล์ "review" เป็นถังปิดแล้ว ลูกค้าไม่มีบัญชีจึงอ่านเองไม่ได้
 * เส้นทางนี้ถามฐานข้อมูลด้วยโทเคนในลิงก์ แล้วออกลิงก์ชั่วคราวให้เฉพาะ
 * รอบที่ยังไม่หมดอายุ — หมดอายุแล้วฐานข้อมูลไม่ส่งที่อยู่ไฟล์กลับมาเลย
 * ลิงก์ที่ออกให้มีอายุไม่เกินวันหมดอายุของรอบ และไม่เกินหนึ่งชั่วโมง
 */

const BUCKET = "review";
const HOUR = 3600;

type FileOut = { path?: string | null; url?: string | null; poster?: string | null };

function admin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!hasBackend || !key) return null;
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** เหลืออีกกี่วินาทีถึงสิ้นวันหมดอายุ (เวลาไทย) — อย่างมากหนึ่งชั่วโมง */
function ttlOf(expiresAt: string): number {
  const end = Date.parse(`${expiresAt}T23:59:59+07:00`);
  if (Number.isNaN(end)) return HOUR;
  return Math.max(0, Math.min(HOUR, Math.floor((end - Date.now()) / 1000)));
}

export async function GET(request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  /* ลิงก์ที่ตั้งรหัสไว้ (รอบที่ 128) — ลูกค้าส่งรหัสมากับคำขอ ไม่เก็บไว้ที่ไหน */
  const pass = new URL(request.url).searchParams.get("pass") ?? "";
  const sb = admin();
  if (!sb) return Response.json({ ok: false, reason: "no_backend" }, { status: 503 });

  const got = await sb.rpc("review_open", { p_token: decodeURIComponent(token), p_pass: pass });
  if (got.error || !got.data) return Response.json({ ok: false, reason: "not_found" }, { status: 404 });

  const out = got.data as {
    ok?: boolean;
    reason?: string;
    round?: { expired?: boolean; expiresAt?: string };
    files?: FileOut[];
  };
  /* ต้องใส่รหัส — ตอบ 401 พร้อมเหตุผล ไม่ส่งข้อมูลงานออกไปเลย */
  if (out.reason === "need_pass") return Response.json(out, { status: 401, headers: { "cache-control": "no-store" } });
  if (!out.ok) return Response.json(out, { status: 404 });

  const expired = Boolean(out.round?.expired);
  const ttl = expired ? 0 : ttlOf(String(out.round?.expiresAt ?? ""));
  if (!expired && ttl > 0) {
    for (const f of out.files ?? []) {
      if (!f.path) continue;
      const signed = await sb.storage.from(BUCKET).createSignedUrl(f.path, ttl);
      f.url = signed.data?.signedUrl ?? null;
      if (f.poster) {
        const pos = await sb.storage.from(BUCKET).createSignedUrl(f.poster, ttl);
        if (pos.data?.signedUrl) f.poster = pos.data.signedUrl;
      }
    }
  }
  /* ที่อยู่จริงในถังไม่ต้องส่งออกไปให้ลูกค้า มีแต่ลิงก์ชั่วคราวก็พอ */
  for (const f of out.files ?? []) delete f.path;

  return Response.json(out, { headers: { "cache-control": "no-store" } });
}
