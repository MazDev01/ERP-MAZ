"use client";

import { signedIn, supabase } from "./client";

/*
 * งานที่ทีมเสนอเอง (รอบที่ 146 · เจ้าของอนุมัติ 20 ต.ค. 2569)
 *
 * ลูกค้าหรือคนในบริษัทเดินมาสั่งงานกับคนทำโดยตรง — ใบเสนอทำให้งานพวกนี้เข้าระบบ
 * เสนอได้เฉพาะงานของตัวเอง (ฐานข้อมูลเติมชื่อผู้เสนอให้) และต้องให้ฝ่ายโครงการอนุมัติก่อน
 */

export type AskFrom = "client" | "staff";

export const ASK_FROM_LABEL: Record<AskFrom, string> = {
  client: "ลูกค้า",
  staff: "คนในบริษัท",
};

export type TaskAsk = {
  no: string;
  /** รหัสพนักงานผู้เสนอ = ผู้รับงาน */
  byNo: string;
  by: string;
  /** โปรเจคที่ผู้เสนอคิดว่างานนี้ควรอยู่ — ว่างได้ */
  pj: string;
  name: string;
  from: AskFrom;
  fromName: string;
  brief: string;
  due: string;
  status: "waiting" | "ok" | "no";
  /** อนุมัติแล้วงานไปอยู่โปรเจคไหน ใบที่เท่าไร */
  okPj: string;
  okIdx: number | null;
  why: string;
  at: string;
  closedBy: string;
};

type Row = {
  no: string;
  by_no: string;
  by_name: string;
  pj: string;
  name: string;
  from_kind: string;
  from_name: string;
  brief: string;
  due: string | null;
  status: string;
  ok_pj: string;
  ok_idx: number | null;
  why: string;
  created_at: string;
  closed_by: string;
};

const SELECT =
  "no, by_no, by_name, pj, name, from_kind, from_name, brief, due, status, ok_pj, ok_idx, why, created_at, closed_by";

/** ใบที่คนนี้เห็น — ผู้เสนอได้ของตัวเอง ฝ่ายโครงการได้ทั้งหมด (ชั้น RLS คัดให้) */
export async function fetchTaskAsks(): Promise<TaskAsk[]> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return [];
  const got = await sb.from("task_asks").select(SELECT).order("created_at", { ascending: false }).limit(80);
  if (got.error) return [];
  return ((got.data ?? []) as unknown as Row[]).map((r) => ({
    no: r.no,
    byNo: r.by_no,
    by: r.by_name,
    pj: r.pj,
    name: r.name,
    from: r.from_kind === "client" ? "client" : "staff",
    fromName: r.from_name,
    brief: r.brief,
    due: r.due ?? "",
    status: r.status === "ok" ? "ok" : r.status === "no" ? "no" : "waiting",
    okPj: r.ok_pj,
    okIdx: r.ok_idx,
    why: r.why,
    at: r.created_at,
    closedBy: r.closed_by,
  }));
}

export type AskWrite = { ok: true; no?: string; pj?: string } | { ok: false; reason: string };

/** พนักงานเสนองานของตัวเอง — ชื่อผู้เสนอฐานข้อมูลเติมให้ เสนอแทนกันไม่ได้ */
export async function sbAskAdd(input: {
  pj: string;
  name: string;
  from: AskFrom;
  fromName: string;
  brief: string;
  due: string;
}): Promise<AskWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return { ok: false, reason: "no_backend" };
  const got = await sb
    .from("task_asks")
    .insert({
      pj: input.pj,
      name: input.name.trim(),
      from_kind: input.from,
      from_name: input.fromName.trim(),
      brief: input.brief.trim(),
      due: input.due || null,
    })
    .select("no")
    .single();
  if (got.error) {
    return { ok: false, reason: /row-level security/i.test(got.error.message) ? "no_account" : got.error.message };
  }
  return { ok: true, no: (got.data as { no: string }).no };
}

const call = async (fn: string, args: Record<string, unknown>): Promise<AskWrite> => {
  const sb = supabase();
  if (!sb || !(await signedIn())) return { ok: false, reason: "no_backend" };
  const got = await sb.rpc(fn, args);
  if (got.error) return { ok: false, reason: got.error.message };
  const out = got.data as { ok?: boolean; reason?: string; pj?: string } | null;
  return out?.ok ? { ok: true, pj: out.pj } : { ok: false, reason: out?.reason ?? "unknown" };
};

/** ฝ่ายโครงการอนุมัติ — เกิดใบงานจริงในโปรเจคที่เลือก มอบให้ผู้เสนอ */
export const sbAskOk = (no: string, pj: string, due?: string) =>
  call("task_ask_ok", { p_no: no, p_pj: pj, p_due: due || null });

/** ฝ่ายโครงการไม่อนุมัติ — ต้องบอกเหตุผล */
export const sbAskNo = (no: string, why: string) => call("task_ask_no", { p_no: no, p_why: why });
