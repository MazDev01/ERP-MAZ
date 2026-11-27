"use client";

import { signedIn, supabase } from "./client";
import { loadPeople, myId } from "./people";

/*
 * รูปโปรไฟล์ของพนักงาน (รอบที่ 153)
 *
 * ไฟล์อยู่ในถัง avatars ซึ่งเป็นถังปิด — เปิดด้วยลิงก์ชั่วคราวเท่านั้น
 * โฟลเดอร์แรกของไฟล์คือรหัสแถวพนักงาน (uuid) ตามกติกาของถังตั้งแต่รอบที่ 1
 * ที่อยู่ไฟล์เก็บใน employees.photo_path เขียนผ่านฟังก์ชันของฐานข้อมูลเท่านั้น
 */

const BUCKET = "avatars";
/** ถังรับไม่เกิน 2 MB และรับเฉพาะรูป */
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
/** ลิงก์ชั่วคราวมีอายุเท่านี้ (วินาที) — ยาวพอให้เปิดหน้าใช้งานทั้งชั่วโมง */
const URL_TTL = 3600;

export type PhotoWrite = { ok: true; path?: string } | { ok: false; reason: string };

/** อัปรูปของตัวเองแล้วผูกกับทะเบียน — คืนที่อยู่ไฟล์ที่บันทึกไว้ */
export async function uploadMyPhoto(file: File | Blob, ext = "jpg"): Promise<PhotoWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return { ok: false, reason: "no_backend" };
  /* รหัสแถวพนักงานมาจากฐานข้อมูล — ยังไม่โหลดก็โหลดก่อน (หน้าโปรไฟล์ไม่ได้ใช้รายชื่อคน) */
  if (!myId()) await loadPeople();
  const me = myId();
  if (!me) return { ok: false, reason: "no_account" };
  if (file.size > PHOTO_MAX_BYTES) return { ok: false, reason: "too_big" };

  const path = `${me}/${Date.now()}.${ext}`;
  const up = await sb.storage.from(BUCKET).upload(path, file, {
    upsert: false,
    contentType: file instanceof File ? file.type || "image/jpeg" : "image/jpeg",
  });
  if (up.error) return { ok: false, reason: up.error.message };

  const got = await sb.rpc("photo_set", { p_path: path });
  if (got.error) return { ok: false, reason: got.error.message };
  const out = got.data as { ok?: boolean; reason?: string } | null;
  if (!out?.ok) return { ok: false, reason: out?.reason ?? "unknown" };
  return { ok: true, path };
}

/** เอารูปของตัวเองออก — ลบไฟล์เก่าด้วย ไม่ปล่อยไฟล์ลอยไว้ในถัง */
export async function removeMyPhoto(): Promise<PhotoWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return { ok: false, reason: "no_backend" };
  if (!myId()) await loadPeople();
  const me = myId();
  if (!me) return { ok: false, reason: "no_account" };

  const old = await sb.rpc("photo_list");
  const mine = ((old.data ?? []) as { emp_no: string; path: string }[]).map((r) => r.path);
  const got = await sb.rpc("photo_set", { p_path: "" });
  if (got.error) return { ok: false, reason: got.error.message };
  /* ลบเฉพาะไฟล์ในโฟลเดอร์ของตัวเอง */
  const drop = mine.filter((p) => p.startsWith(`${me}/`));
  if (drop.length) await sb.storage.from(BUCKET).remove(drop);
  return { ok: true };
}

/**
 * รูปของทุกคนที่มีรูป — คืนเป็น {รหัสพนักงาน: ลิงก์ชั่วคราว}
 * ขอลิงก์ทีเดียวทั้งชุด ไม่ยิงทีละรูป (หน้ารายชื่อมีรูปหลายสิบใบ)
 */
export async function fetchPhotoUrls(): Promise<Record<string, string>> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return {};
  const got = await sb.rpc("photo_list");
  if (got.error) return {};
  const rows = (got.data ?? []) as { emp_no: string; path: string }[];
  if (!rows.length) return {};

  const signed = await sb.storage.from(BUCKET).createSignedUrls(rows.map((r) => r.path), URL_TTL);
  if (signed.error) return {};
  const list = (signed.data ?? []) as { path?: string | null; signedUrl?: string | null }[];
  const byPath = new Map<string, string>(list.map((x) => [x.path ?? "", x.signedUrl ?? ""]));
  const out: Record<string, string> = {};
  for (const r of rows) {
    const url = byPath.get(r.path);
    if (url) out[r.emp_no] = url;
  }
  return out;
}
