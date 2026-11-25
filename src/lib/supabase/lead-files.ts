"use client";

import { signedIn, supabase } from "./client";
import { myId } from "./people";
import { uploadAttachment } from "./files";
import type { LeadFile } from "../lead-files";

/*
 * ไฟล์ Proposal และเอกสารของผู้สนใจ (รอบที่ 115)
 *
 * ฐานข้อมูลผูกกับ customers.id แต่หน้าจออ้างรหัสผู้สนใจ (LEAD-… / CUS-…)
 * ชั้นนี้จึงแปลงให้ และจำคู่ไว้จากรอบที่อ่านมา
 * ไฟล์จริงขึ้นถัง docs ที่อยู่ lead/<id>/<เวลา>-<ชื่อไฟล์> · ลิงก์เก็บแค่ที่อยู่
 */

/** "yyyy-mm-dd HH:mm" ตามเวลาไทย */
function stampOf(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at.slice(0, 16).replace("T", " ");
  const th = new Date(d.getTime() + (420 + d.getTimezoneOffset()) * 60_000);
  return th.toISOString().slice(0, 16).replace("T", " ");
}

type Row = {
  id: string;
  customer_id: string;
  name: string;
  size_bytes: string | number;
  url: string | null;
  path: string | null;
  by_name: string;
  created_at: string;
  customers: { code: string; lead_code: string | null } | null;
};

const idByCode = new Map<string, string>();

async function customerIdOf(code: string): Promise<string | null> {
  const known = idByCode.get(code);
  if (known) return known;
  const sb = supabase();
  if (!sb) return null;
  const got = await sb.from("customers").select("id").or(`code.eq.${code},lead_code.eq.${code}`).maybeSingle();
  const id = (got.data as { id?: string } | null)?.id ?? null;
  if (id) idByCode.set(code, id);
  return id;
}

export async function fetchLeadFiles(): Promise<LeadFile[]> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return [];
  const got = await sb
    .from("lead_files")
    .select("id, customer_id, name, size_bytes, url, path, by_name, created_at, customers(code, lead_code)")
    .order("created_at", { ascending: false });
  if (got.error || !got.data) return [];
  return (got.data as unknown as Row[]).map<LeadFile>((r) => {
    const code = r.customers?.code ?? "";
    if (code) idByCode.set(code, r.customer_id);
    return {
      id: r.id,
      lead: code,
      name: r.name,
      size: Number(r.size_bytes),
      url: r.url ?? undefined,
      path: r.path ?? undefined,
      by: r.by_name,
      at: stampOf(r.created_at),
    };
  });
}

/**
 * แนบไฟล์หรือลิงก์ให้ผู้สนใจรายนั้น
 * ไฟล์จริง (มี File มาด้วย) ส่งขึ้นถังก่อน แล้วเก็บที่อยู่ไว้ในแถว
 * อัปโหลดไม่ผ่านก็ยังบันทึกชื่อไว้ให้ทีมเห็น เหมือนไฟล์แนบอื่นในระบบ
 */
export async function sbAddLeadFiles(
  lead: string,
  files: { name: string; size: number; url?: string; file?: File }[],
  by: string,
) {
  const sb = supabase();
  if (!sb || !(await signedIn()) || !files.length) return;
  const id = await customerIdOf(lead);
  if (!id) return;

  const rows: Record<string, unknown>[] = [];
  for (const f of files) {
    let path: string | null = null;
    if (!f.url && f.file) {
      const up = await uploadAttachment("lead", id, f.file);
      if (up.ok) path = up.attachment.path;
    }
    rows.push({
      customer_id: id,
      name: f.name,
      size_bytes: Math.max(0, Math.round(f.size)),
      url: f.url ?? null,
      path,
      by_name: by,
      by_id: myId(),
    });
  }
  await sb.from("lead_files").insert(rows);
}

/** เอาไฟล์ออก — ฐานข้อมูลปล่อยให้เฉพาะคนแนบ (และหัวหน้า) ลบได้ */
export async function sbRemoveLeadFile(id: string, path?: string) {
  const sb = supabase();
  if (!sb || !(await signedIn())) return;
  /* ลบไฟล์ในถังก่อนแล้วค่อยลบแถว — นโยบายของถังตรวจว่ามีแถวชี้มาที่ไฟล์นั้น */
  if (path) {
    const att = await sb.from("attachments").select("id").eq("path", path).maybeSingle();
    const attId = (att.data as { id?: string } | null)?.id;
    if (attId) {
      const { removeAttachment } = await import("./files");
      await removeAttachment(attId, path);
    }
  }
  await sb.from("lead_files").delete().eq("id", id);
}
