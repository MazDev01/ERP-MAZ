import "server-only";

/*
 * เริ่มรอบอัปโหลดไฟล์ผลงานขึ้น Google Drive (รอบที่ 131 · Requirement รอบ 9, 11)
 *
 * ไฟล์ผลงานเป็น ZIP 1–10 GB — ห้ามวิ่งผ่านเซิร์ฟเวอร์ของเรา (หน่วยความจำไม่พอ
 * และเสียเวลาสองเท่า) เส้นทางนี้จึงทำแค่ขอ "รอบอัปโหลดต่อเนื่อง" (resumable session)
 * จาก Google แล้วส่งที่อยู่กลับไปให้เบราว์เซอร์ยิงไฟล์ขึ้น Drive เองโดยตรง
 *
 * กุญแจอยู่ฝั่งเซิร์ฟเวอร์เท่านั้น (.env.local ซึ่งไม่ขึ้น git):
 *   GOOGLE_DRIVE_CLIENT_ID · GOOGLE_DRIVE_CLIENT_SECRET
 *   GOOGLE_DRIVE_REFRESH_TOKEN · GOOGLE_DRIVE_FOLDER_ID (โฟลเดอร์ปลายทาง)
 *
 * ยังไม่ได้กุญแจ = ตอบ no_keys ให้หน้าจอรู้ว่ายังใช้ไม่ได้ แล้วไปใช้ที่เก็บไฟล์
 * ของระบบตามเดิม (เจ้าของสั่ง 27 พ.ย. 2569 ว่า "เตรียมโครงไว้รอกุญแจ")
 */

import { serverSupabase } from "@/lib/supabase/server";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true";

type Keys = { id: string; secret: string; refresh: string; folder: string };

function keys(): Keys | null {
  const id = process.env.GOOGLE_DRIVE_CLIENT_ID ?? "";
  const secret = process.env.GOOGLE_DRIVE_CLIENT_SECRET ?? "";
  const refresh = process.env.GOOGLE_DRIVE_REFRESH_TOKEN ?? "";
  const folder = process.env.GOOGLE_DRIVE_FOLDER_ID ?? "";
  if (!id || !secret || !refresh) return null;
  return { id, secret, refresh, folder };
}

/** กุญแจของเรายังใช้ได้ไหม — ขอโทเคนระยะสั้นจาก refresh token */
async function accessToken(k: Keys): Promise<string | null> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: k.id,
      client_secret: k.secret,
      refresh_token: k.refresh,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  const out = (await res.json()) as { access_token?: string };
  return out.access_token ?? null;
}

export async function POST(request: Request) {
  /* ต้องล็อกอินก่อน — ไฟล์ผลงานเป็นของลูกค้า ไม่ใช่ของสาธารณะ */
  const sb = await serverSupabase();
  const me = sb ? (await sb.auth.getUser()).data.user : null;
  if (!me) return Response.json({ ok: false, reason: "no_account" }, { status: 401 });

  let body: { name?: string; size?: number; type?: string; folder?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, reason: "bad_json" }, { status: 400 });
  }
  const name = String(body.name ?? "").trim();
  if (!name) return Response.json({ ok: false, reason: "need_name" }, { status: 400 });

  const k = keys();
  if (!k) {
    /* ยังไม่ได้กุญแจจาก Google — บอกให้ชัด หน้าจอจะไปใช้ที่เก็บไฟล์ของระบบ */
    return Response.json({ ok: false, reason: "no_keys" }, { status: 503 });
  }

  const token = await accessToken(k);
  if (!token) return Response.json({ ok: false, reason: "bad_keys" }, { status: 502 });

  const folder = String(body.folder ?? "").trim() || k.folder;
  const start = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=UTF-8",
      ...(body.size ? { "x-upload-content-length": String(body.size) } : {}),
      ...(body.type ? { "x-upload-content-type": String(body.type) } : {}),
    },
    body: JSON.stringify({ name, ...(folder ? { parents: [folder] } : {}) }),
  });
  const uploadUrl = start.headers.get("location");
  if (!start.ok || !uploadUrl) {
    return Response.json({ ok: false, reason: "drive_refused", status: start.status }, { status: 502 });
  }

  /* เบราว์เซอร์ยิงไฟล์ขึ้นที่อยู่นี้เอง (PUT เป็นช่วง ๆ ได้ ถ้าหลุดก็ต่อจากเดิมได้) */
  return Response.json({ ok: true, uploadUrl }, { headers: { "cache-control": "no-store" } });
}
