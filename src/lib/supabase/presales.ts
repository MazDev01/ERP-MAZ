"use client";

import { signedIn, supabase } from "./client";
import { myId } from "./people";
import type { PsNote } from "../presales-work";
import type { PresalesTemplate, TemplateInput, TemplateKind } from "../presales-templates";

/*
 * ฝั่งทีมก่อนการขาย (รอบที่ 109) — สายสนทนาของคำขอ และคลังเทมเพลตข้อเสนอ
 *
 * ฐานข้อมูลผูกสายสนทนากับ presales_requests.id แต่หน้าจออ้างเลขที่คำขอ (PS-…)
 * ชั้นนี้จึงแปลงเลขที่ ↔ id ให้ และจำคู่ไว้จากรอบที่อ่านมา
 */

/** "yyyy-mm-dd HH:mm" ตามเวลาไทย — รูปแบบเดียวกับที่สโตร์ใช้อยู่ */
function stampOf(at: string | null): string {
  if (!at) return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at.slice(0, 16).replace("T", " ");
  const th = new Date(d.getTime() + (420 + d.getTimezoneOffset()) * 60_000);
  return th.toISOString().slice(0, 16).replace("T", " ");
}

/** yyyy-mm-dd ตามเวลาไทย */
function dayOf(at: string): string {
  return stampOf(at).slice(0, 10);
}

/* ─── สายสนทนาของคำขอ ─────────────────────────────────────────── */

type NoteRow = {
  request_id: string;
  side: string;
  by_name: string;
  tx: string;
  at: string;
  presales_requests: { no: string } | null;
};

const reqIdByNo = new Map<string, string>();

async function requestIdOf(no: string): Promise<string | null> {
  const known = reqIdByNo.get(no);
  if (known) return known;
  const sb = supabase();
  if (!sb) return null;
  const got = await sb.from("presales_requests").select("id").eq("no", no).maybeSingle();
  const id = (got.data as { id?: string } | null)?.id ?? null;
  if (id) reqIdByNo.set(no, id);
  return id;
}

/** ทุกสายสนทนา จัดกลุ่มตามเลขที่คำขอ เรียงเก่าไปใหม่ */
export async function fetchPsNotes(): Promise<Record<string, PsNote[]>> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return {};
  const got = await sb
    .from("presales_notes")
    .select("request_id, side, by_name, tx, at, presales_requests(no)")
    .order("at");
  if (got.error || !got.data) return {};
  const out: Record<string, PsNote[]> = {};
  for (const r of got.data as unknown as NoteRow[]) {
    const no = r.presales_requests?.no;
    if (!no) continue;
    reqIdByNo.set(no, r.request_id);
    const note: PsNote = {
      side: r.side === "sales" ? "sales" : "ps",
      by: r.by_name,
      at: stampOf(r.at),
      tx: r.tx,
    };
    out[no] = [...(out[no] ?? []), note];
  }
  return out;
}

export async function sbAddPsNote(no: string, note: { side: PsNote["side"]; by: string; tx: string }) {
  const sb = supabase();
  if (!sb || !(await signedIn())) return;
  const id = await requestIdOf(no);
  if (!id) return;
  await sb.from("presales_notes").insert({
    request_id: id,
    side: note.side,
    by_name: note.by,
    by_id: myId(),
    tx: note.tx,
  });
}

/* ─── คลังเทมเพลต ─────────────────────────────────────────────── */

type TplRow = {
  id: string;
  name: string;
  service: string;
  kind: string;
  file: string;
  url: string | null;
  size: number | null;
  file_id: string | null;
  note: string;
  by_name: string;
  uses: number;
  retired: boolean;
  updated_at: string;
};

const KINDS: TemplateKind[] = ["ppt", "pdf", "canva", "link"];

const TPL_COLS = "id, name, service, kind, file, url, size, file_id, note, by_name, uses, retired, updated_at";

export async function fetchTemplates(): Promise<PresalesTemplate[]> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return [];
  const got = await sb.from("presales_templates").select(TPL_COLS).order("created_at", { ascending: false });
  if (got.error || !got.data) return [];
  return (got.data as unknown as TplRow[]).map<PresalesTemplate>((r) => ({
    id: r.id,
    name: r.name,
    service: r.service,
    kind: (KINDS.includes(r.kind as TemplateKind) ? r.kind : "link") as TemplateKind,
    file: r.file,
    url: r.url ?? undefined,
    size: r.size ?? undefined,
    fileId: r.file_id ?? undefined,
    note: r.note,
    uploadedBy: r.by_name,
    updatedAt: dayOf(r.updated_at),
    uses: r.uses,
    off: r.retired || undefined,
  }));
}

function toRow(input: TemplateInput) {
  return {
    name: input.name,
    service: input.service,
    kind: input.kind,
    file: input.file,
    url: input.url ?? null,
    size: input.size ?? null,
    note: input.note,
  };
}

export async function sbAddTemplate(input: TemplateInput, by: string) {
  const sb = supabase();
  if (!sb || !(await signedIn())) return;
  await sb.from("presales_templates").insert({ ...toRow(input), by_name: by, by_id: myId() });
}

export async function sbUpdateTemplate(id: string, input: TemplateInput) {
  const sb = supabase();
  if (!sb || !(await signedIn())) return;
  await sb.from("presales_templates").update(toRow(input)).eq("id", id);
}

export async function sbRetireTemplate(id: string, off: boolean) {
  const sb = supabase();
  if (!sb || !(await signedIn())) return;
  await sb.from("presales_templates").update({ retired: off }).eq("id", id);
}

/** นับว่าเทมเพลตถูกแนบไปกับข้อเสนอ — ให้ฐานข้อมูลบวกเอง สองคนส่งพร้อมกันจะได้ไม่ทับกัน */
export async function sbCountTemplateUse(ids: string[]) {
  const sb = supabase();
  if (!sb || !(await signedIn()) || !ids.length) return;
  await sb.rpc("presales_template_use", { p_ids: ids });
}
