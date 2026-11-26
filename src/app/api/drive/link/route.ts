import "server-only";

/*
 * ขอลิงก์เปิดไฟล์บน Google Drive หลังอัปโหลดเสร็จ (รอบที่ 131)
 *
 * ไฟล์ที่เพิ่งอัปขึ้นเปิดได้เฉพาะเจ้าของกุญแจ ต้องเปิดสิทธิ์ให้ "ใครมีลิงก์ก็อ่านได้"
 * ก่อน แล้วค่อยเก็บลิงก์ไว้ในคลังไฟล์ของโปรเจค
 *
 * ยังไม่ได้กุญแจ = ตอบ no_keys เหมือนเส้นทางเริ่มรอบอัปโหลด
 */

import { serverSupabase } from "@/lib/supabase/server";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";

function keys() {
  const id = process.env.GOOGLE_DRIVE_CLIENT_ID ?? "";
  const secret = process.env.GOOGLE_DRIVE_CLIENT_SECRET ?? "";
  const refresh = process.env.GOOGLE_DRIVE_REFRESH_TOKEN ?? "";
  if (!id || !secret || !refresh) return null;
  return { id, secret, refresh };
}

async function accessToken(k: { id: string; secret: string; refresh: string }) {
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
  const sb = await serverSupabase();
  const me = sb ? (await sb.auth.getUser()).data.user : null;
  if (!me) return Response.json({ ok: false, reason: "no_account" }, { status: 401 });

  let body: { fileId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, reason: "bad_json" }, { status: 400 });
  }
  const fileId = String(body.fileId ?? "").trim();
  if (!fileId) return Response.json({ ok: false, reason: "need_file" }, { status: 400 });

  const k = keys();
  if (!k) return Response.json({ ok: false, reason: "no_keys" }, { status: 503 });
  const token = await accessToken(k);
  if (!token) return Response.json({ ok: false, reason: "bad_keys" }, { status: 502 });

  /* ใครมีลิงก์ก็อ่านได้ — ลิงก์ของไฟล์ผลงานส่งให้ลูกค้าทางอื่นอยู่แล้ว */
  const perm = await fetch(`${FILES_URL}/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
  if (!perm.ok) return Response.json({ ok: false, reason: "perm_failed" }, { status: 502 });

  const got = await fetch(
    `${FILES_URL}/${encodeURIComponent(fileId)}?fields=id,name,size,webViewLink&supportsAllDrives=true`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!got.ok) return Response.json({ ok: false, reason: "read_failed" }, { status: 502 });
  const file = (await got.json()) as { id: string; name: string; size?: string; webViewLink?: string };

  return Response.json(
    { ok: true, id: file.id, name: file.name, size: file.size ?? "", url: file.webViewLink ?? "" },
    { headers: { "cache-control": "no-store" } },
  );
}
