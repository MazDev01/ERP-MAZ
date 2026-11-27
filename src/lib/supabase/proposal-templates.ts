"use client";

import { signedIn, supabase } from "./client";

/*
 * แม่แบบ Proposal ของผู้บริหาร (รอบที่ 134)
 *
 * ไฟล์เก็บในถัง docs ใต้โฟลเดอร์ proposal — ผู้บริหารกับฝ่ายบุคคลอัปได้
 * ฝ่ายขายและทีมก่อนการขายอ่านได้ (ดูนโยบายของถังในไฟล์ย้ายฐานข้อมูลรอบที่ 134)
 */

const BUCKET = "docs";
const FOLDER = "proposal";
/** ไฟล์แม่แบบมักเป็น PDF หรือสไลด์ — เพดานเดียวกับไฟล์แนบอื่นของระบบ */
const MAX_BYTES = 10 * 1024 * 1024;

export type ProposalTemplate = {
  id: string;
  name: string;
  note: string;
  /** ชื่อไฟล์ หรือที่อยู่ลิงก์ */
  file: string;
  size: number;
  url: string;
  /** ที่อยู่ไฟล์ในถัง — ว่าง = เป็นลิงก์หรือเก็บแค่ชื่อ */
  path?: string;
  by: string;
  /** "yyyy-mm-dd HH:mm" เวลาไทย */
  at: string;
};

type Row = {
  id: string;
  name: string;
  note: string;
  file: string;
  size_bytes: number | string;
  url: string;
  path: string | null;
  by_name: string;
  at: string;
  off: boolean;
};

/** "yyyy-mm-dd HH:mm" ตามเวลาไทย */
function stampOf(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at.slice(0, 16).replace("T", " ");
  const th = new Date(d.getTime() + (420 + d.getTimezoneOffset()) * 60_000);
  return th.toISOString().slice(0, 16).replace("T", " ");
}

export async function fetchProposalTemplates(): Promise<ProposalTemplate[]> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return [];
  const got = await sb
    .from("proposal_templates")
    .select("id, name, note, file, size_bytes, url, path, by_name, at, off")
    .eq("off", false)
    .order("at", { ascending: false });
  if (got.error) return [];
  return ((got.data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    name: r.name,
    note: r.note,
    file: r.file,
    size: Number(r.size_bytes ?? 0),
    url: r.url,
    path: r.path ?? undefined,
    by: r.by_name,
    at: stampOf(r.at),
  }));
}

export type Write = { ok: true } | { ok: false; message: string };

/** ชื่อไฟล์ที่ปลอดภัยพอจะเป็นที่อยู่ในถัง */
function safeName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_").slice(-80) || "file";
}

export async function sbUploadProposalFile(
  file: File,
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return { ok: false, message: "ยังไม่ได้เข้าสู่ระบบ" };
  if (file.size > MAX_BYTES) return { ok: false, message: "ไฟล์ใหญ่เกิน 10 MB" };
  const path = `${FOLDER}/${Date.now()}-${safeName(file.name)}`;
  const up = await sb.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (up.error) return { ok: false, message: "อัปโหลดไฟล์ไม่สำเร็จ" };
  return { ok: true, path };
}

export async function sbAddProposalTemplate(input: {
  name: string;
  note: string;
  file: string;
  size: number;
  url: string;
  path?: string;
  by: string;
}): Promise<Write> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return { ok: false, message: "ยังไม่ได้เข้าสู่ระบบ" };
  const got = await sb.from("proposal_templates").insert({
    name: input.name,
    note: input.note,
    file: input.file,
    size_bytes: Math.max(0, Math.round(input.size)),
    url: input.url,
    path: input.path ?? null,
    by_name: input.by,
  });
  if (got.error) {
    return {
      ok: false,
      message: /row-level security/i.test(got.error.message)
        ? "เฉพาะผู้บริหารหรือผู้ดูแลระบบที่เพิ่มแม่แบบได้"
        : "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง",
    };
  }
  return { ok: true };
}

export async function sbRemoveProposalTemplate(id: string): Promise<Write> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return { ok: false, message: "ยังไม่ได้เข้าสู่ระบบ" };
  /* ลบไฟล์ในถังก่อน แล้วค่อยลบแถว — นโยบายลบของถังอ่านจากแถวของแม่แบบ */
  const row = await sb.from("proposal_templates").select("path").eq("id", id).maybeSingle();
  const path = (row.data as { path?: string | null } | null)?.path;
  if (path) await sb.storage.from(BUCKET).remove([path]);
  const got = await sb.from("proposal_templates").delete().eq("id", id);
  if (got.error) {
    return {
      ok: false,
      message: /row-level security/i.test(got.error.message)
        ? "เฉพาะผู้บริหารหรือผู้ดูแลระบบที่ลบแม่แบบได้"
        : "ลบไม่สำเร็จ ลองใหม่อีกครั้ง",
    };
  }
  return { ok: true };
}

/** ลิงก์เปิดไฟล์แม่แบบ — ไฟล์ในถังได้ลิงก์ชั่วคราว ลิงก์ภายนอกคืนค่าเดิม */
export async function proposalFileUrl(t: ProposalTemplate): Promise<string> {
  if (t.url) return t.url;
  const sb = supabase();
  if (!sb || !t.path) return "";
  const { data } = await sb.storage.from(BUCKET).createSignedUrl(t.path, 300);
  return data?.signedUrl ?? "";
}
