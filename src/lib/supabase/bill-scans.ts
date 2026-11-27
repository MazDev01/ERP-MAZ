"use client";

import { signedIn, supabase } from "./client";
import type { BillDraft } from "../bill-ocr";

/*
 * บิลผู้ขายที่อ่านเข้ามา รอบัญชีตรวจก่อนนำเข้า (รอบที่ 142 · Requirement รอบ 12)
 *
 * ไฟล์บิลเก็บในถัง docs ใต้โฟลเดอร์ bill — เปิดได้เฉพาะบัญชีกับผู้บริหาร
 * ระบบไม่สร้างเอกสารการเงินให้เอง บัญชีเป็นคนออกเอกสารแล้วผูกเลขกลับมาปิดใบ
 */

const BUCKET = "docs";
const FOLDER = "bill";
/** บิลเป็นรูปถ่ายหรือ PDF — เพดานเดียวกับไฟล์แนบอื่นของระบบ */
export const BILL_MAX_BYTES = 10 * 1024 * 1024;

export type BillScan = {
  no: string;
  path: string;
  text: string;
  draft: Partial<BillDraft>;
  status: "new" | "imported" | "dropped";
  docNo: string;
  why: string;
  by: string;
  at: string;
  closedBy: string;
};

type Row = {
  no: string;
  path: string;
  text: string;
  draft: Partial<BillDraft> | null;
  status: string;
  doc_no: string;
  why: string;
  by_name: string;
  created_at: string;
  closed_by: string;
};

export async function fetchBillScans(): Promise<BillScan[]> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return [];
  const got = await sb
    .from("bill_scans")
    .select("no, path, text, draft, status, doc_no, why, by_name, created_at, closed_by")
    .order("created_at", { ascending: false })
    .limit(50);
  if (got.error) return [];
  return ((got.data ?? []) as unknown as Row[]).map((r) => ({
    no: r.no,
    path: r.path,
    text: r.text,
    draft: r.draft ?? {},
    status: r.status === "imported" ? "imported" : r.status === "dropped" ? "dropped" : "new",
    docNo: r.doc_no,
    why: r.why,
    by: r.by_name,
    at: r.created_at,
    closedBy: r.closed_by,
  }));
}

export type BillWrite = { ok: true; no?: string } | { ok: false; reason: string };

/** เก็บไฟล์บิลลงถัง แล้วคืนที่อยู่ไฟล์ — ไม่มีไฟล์ (วางแต่ข้อความ) ก็ข้ามได้ */
export async function sbUploadBill(file: File): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return { ok: false, reason: "no_backend" };
  if (file.size > BILL_MAX_BYTES) return { ok: false, reason: "too_big" };
  const safe = file.name.replace(/[^\w.\-ก-๙ ]+/g, "_").slice(-80);
  const path = `${FOLDER}/${Date.now()}-${safe}`;
  const up = await sb.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (up.error) return { ok: false, reason: up.error.message };
  return { ok: true, path };
}

/** ลิงก์เปิดไฟล์บิลแบบมีอายุสั้น — ถังเป็นถังปิด เปิดตรง ๆ ไม่ได้ */
export async function sbBillFileUrl(path: string): Promise<string> {
  const sb = supabase();
  if (!sb || !path || !(await signedIn())) return "";
  const { data } = await sb.storage.from(BUCKET).createSignedUrl(path, 300);
  return data?.signedUrl ?? "";
}

export async function sbAddBillScan(input: { path: string; text: string; draft: BillDraft }): Promise<BillWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return { ok: false, reason: "no_backend" };
  const got = await sb
    .from("bill_scans")
    .insert({ path: input.path, text: input.text, draft: input.draft })
    .select("no")
    .single();
  if (got.error) {
    return { ok: false, reason: /row-level security/i.test(got.error.message) ? "not_allowed" : got.error.message };
  }
  return { ok: true, no: (got.data as { no: string }).no };
}

const call = async (fn: string, args: Record<string, unknown>): Promise<BillWrite> => {
  const sb = supabase();
  if (!sb || !(await signedIn())) return { ok: false, reason: "no_backend" };
  const got = await sb.rpc(fn, args);
  if (got.error) return { ok: false, reason: got.error.message };
  const out = got.data as { ok?: boolean; reason?: string } | null;
  return out?.ok ? { ok: true } : { ok: false, reason: out?.reason ?? "unknown" };
};

/** บัญชีตรวจแล้วนำเข้า — ผูกเลขเอกสารที่ออกจากบิลใบนี้ พร้อมค่าที่แก้แล้ว */
export const sbBillImport = (no: string, docNo: string, draft: Partial<BillDraft>) =>
  call("bill_scan_import", { p_no: no, p_doc: docNo, p_draft: draft });

/** ทิ้งบิลใบนี้ — ต้องบอกเหตุผล */
export const sbBillDrop = (no: string, why: string) => call("bill_scan_drop", { p_no: no, p_why: why });

/**
 * อ่านข้อความจากไฟล์บิลด้วยบริการ OCR (ฝั่งเซิร์ฟเวอร์ถือกุญแจ)
 * ยังไม่ได้กุญแจ = ตอบ no_key แล้วหน้าจอให้บัญชีวางข้อความเองแทน
 */
export async function sbReadBillFile(file: File): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/ocr/bill", { method: "POST", body: form });
  const out = (await res.json().catch(() => null)) as { ok?: boolean; text?: string; reason?: string } | null;
  if (!out?.ok) return { ok: false, reason: out?.reason ?? "ocr_failed" };
  return { ok: true, text: out.text ?? "" };
}
