"use client";

import { signedIn, supabase } from "./client";
import { loadPeople, myId } from "./people";

/*
 * ไฟล์แนบของเอกสาร — ใบรับรองแพทย์ ใบเสร็จ ฯลฯ
 *
 * ตัวไฟล์อยู่ใน bucket "docs" ซึ่งเป็นถังส่วนตัว เปิดดูได้ด้วยลิงก์ชั่วคราวเท่านั้น
 * ส่วนตาราง attachments เก็บว่าไฟล์ไหนเป็นของเอกสารใบไหน และใครอัปโหลด
 *
 * ที่อยู่ไฟล์: <ประเภทเอกสาร>/<รหัสเอกสาร>/<เวลา>-<ชื่อไฟล์>
 * ใส่เวลาไว้ข้างหน้าเพราะชื่อไฟล์ซ้ำกันได้ (ทุกคนตั้งชื่อ "ใบรับรองแพทย์.pdf")
 * แต่ที่อยู่ต้องไม่ซ้ำทั้งถัง
 *
 * ของเดิมหน้าจอเก็บแค่ "ชื่อไฟล์" ไว้โชว์ ตัวไฟล์ไม่เคยถูกส่งไปไหนเลย
 * ผู้อนุมัติจึงเห็นชื่อไฟล์แต่เปิดดูไม่ได้
 */

export type OwnerKind = "leave" | "ot" | "expense" | "employee" | "payroll";

export type Attachment = {
  id: string;
  name: string;
  path: string;
  size: number;
  mime: string;
  at: string;
};

const BUCKET = "docs";
/* ถังรับได้ 10 MB ต่อไฟล์ — บอกผู้ใช้ตั้งแต่ก่อนอัปโหลด ไม่ปล่อยให้ไปเด้งที่เซิร์ฟเวอร์ */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

/*
 * ชื่อไฟล์ที่ใช้เป็น "ที่อยู่" ในถังได้ — ต้องเป็นอักษรอังกฤษ ตัวเลข จุด ขีด เท่านั้น
 * ถังปฏิเสธที่อยู่ที่มีอักษรไทย (Invalid key) ซึ่งเจอทันทีเพราะคนไทยตั้งชื่อไฟล์เป็นไทย
 * ชื่อจริงที่ผู้ใช้เห็นเก็บไว้ในตาราง attachments.name ต่างหาก จึงไม่สูญหาย
 */
function safeName(name: string) {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).replace(/[^a-zA-Z0-9]/g, "").toLowerCase() : "";
  const base = (dot > 0 ? name.slice(0, dot) : name).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const head = base.slice(0, 60) || "file";
  return ext ? `${head}.${ext}` : head;
}

export type UploadResult =
  | { ok: true; attachment: Attachment }
  | { ok: false; reason: string };

/** ข้อความอธิบายเหตุที่แนบไม่สำเร็จ */
export const FILE_REASON: Record<string, string> = {
  no_backend: "ยังไม่ได้ต่อฐานข้อมูล",
  no_account: "บัญชีนี้ยังไม่ผูกกับพนักงาน — แจ้งฝ่ายบุคคล",
  too_big: `ไฟล์ใหญ่เกิน ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB`,
  bad_type: "รับเฉพาะรูป (JPG · PNG · WebP) และ PDF",
};

/** แนบไฟล์เข้ากับเอกสารหนึ่งใบ */
export async function uploadAttachment(
  kind: OwnerKind,
  ownerId: string,
  file: File,
): Promise<UploadResult> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return { ok: false, reason: "no_backend" };
  if (file.size > MAX_FILE_BYTES) return { ok: false, reason: "too_big" };
  if (file.type && !ALLOWED_MIME.includes(file.type)) return { ok: false, reason: "bad_type" };

  await loadPeople();
  const me = myId();
  if (!me) return { ok: false, reason: "no_account" };

  const path = `${kind}/${ownerId}/${Date.now()}-${safeName(file.name)}`;
  const up = await sb.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (up.error) return { ok: false, reason: up.error.message };

  const { data, error } = await sb
    .from("attachments")
    .insert({
      owner_kind: kind,
      owner_id: ownerId,
      path,
      name: file.name,
      size_bytes: file.size,
      mime: file.type || "",
      uploaded_by: me,
    })
    .select("id, name, path, size_bytes, mime, uploaded_at")
    .single();

  if (error || !data) {
    /* ลงทะเบียนไม่ได้ก็อย่าทิ้งไฟล์ค้างไว้ในถัง ไม่งั้นไม่มีใครรู้ว่าไฟล์นี้ของใคร */
    await sb.storage.from(BUCKET).remove([path]);
    return { ok: false, reason: error?.message ?? "insert_failed" };
  }

  const row = data as { id: string; name: string; path: string; size_bytes: number; mime: string; uploaded_at: string };
  return {
    ok: true,
    attachment: { id: row.id, name: row.name, path: row.path, size: row.size_bytes, mime: row.mime, at: row.uploaded_at },
  };
}

/** ไฟล์แนบของเอกสารใบนั้น (RLS คัดให้ว่าใครเห็นได้) */
export async function listAttachments(kind: OwnerKind, ownerId: string): Promise<Attachment[]> {
  const sb = supabase();
  if (!sb || !ownerId || !(await signedIn())) return [];

  const { data, error } = await sb
    .from("attachments")
    .select("id, name, path, size_bytes, mime, uploaded_at")
    .eq("owner_kind", kind)
    .eq("owner_id", ownerId)
    .order("uploaded_at");
  if (error || !data) return [];

  return (data as { id: string; name: string; path: string; size_bytes: number; mime: string; uploaded_at: string }[]).map(
    (r) => ({ id: r.id, name: r.name, path: r.path, size: r.size_bytes, mime: r.mime, at: r.uploaded_at }),
  );
}

/**
 * ลิงก์เปิดไฟล์ — หมดอายุใน 5 นาที
 * ถังเป็นแบบส่วนตัว ลิงก์ถาวรจึงไม่มี ใครได้ลิงก์ไปก็เปิดได้แค่ช่วงสั้น ๆ
 */
export async function fileUrl(path: string): Promise<string> {
  const sb = supabase();
  if (!sb) return "";
  const { data } = await sb.storage.from(BUCKET).createSignedUrl(path, 300);
  return data?.signedUrl ?? "";
}

/** เอาไฟล์ออก — เจ้าของไฟล์หรือฝ่ายบุคคลเท่านั้น (RLS) */
export async function removeAttachment(id: string, path: string): Promise<boolean> {
  const sb = supabase();
  if (!sb) return false;
  const { error } = await sb.from("attachments").delete().eq("id", id);
  if (error) return false;
  await sb.storage.from(BUCKET).remove([path]);
  return true;
}
