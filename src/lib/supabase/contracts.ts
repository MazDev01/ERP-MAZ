"use client";

import { signedIn, supabase } from "./client";
import { myId } from "./people";
import type { ContractDoc } from "../contract-data";

/*
 * ใบสัญญาที่ระบบออกให้ดีล (รอบที่ 107)
 *
 * เลขที่สัญญาออกจากฐานข้อมูล ฉบับแรกของดีลได้เลขใหม่ ฉบับถัดไปใช้เลขเดิม
 * ทุกฉบับเก็บไว้หมด ไม่มีการแก้ทับ — หน้าจอเปิดดูย้อนหลังได้ทุกฉบับ
 */

type Row = {
  id: string;
  deal_id: string;
  no: string;
  version: number;
  issuer: string;
  body: string;
  on_date: string | null;
  by_name: string;
  from_kind: string;
  created_at: string;
  deals: { no: string } | null;
};

/** "YYYY-MM-DD HH:mm" ตามเวลาไทย */
function stampOf(at: string) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at.slice(0, 16).replace("T", " ");
  const th = new Date(d.getTime() + (420 + d.getTimezoneOffset()) * 60_000);
  return th.toISOString().slice(0, 16).replace("T", " ");
}

export async function fetchContracts(): Promise<ContractDoc[]> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return [];
  const got = await sb
    .from("deal_contract_docs")
    .select("id, deal_id, no, version, issuer, body, on_date, by_name, from_kind, created_at, deals(no)")
    .order("version");
  if (got.error || !got.data) return [];
  return (got.data as unknown as Row[]).map<ContractDoc>((r) => ({
    id: r.id,
    dealNo: r.deals?.no ?? "",
    no: r.no,
    version: r.version,
    issuer: r.issuer,
    body: r.body,
    date: r.on_date ?? "",
    at: stampOf(r.created_at),
    by: r.by_name,
    from: r.from_kind === "edit" ? "edit" : "draft",
  }));
}

export type ContractWrite = { ok: true; doc?: ContractDoc } | { ok: false; reason: string };

export async function sbSaveContract(input: {
  dealNo: string;
  /** เลขที่เดิมของดีลนี้ — ว่าง = ยังไม่มีสัญญา ให้ฐานข้อมูลออกเลขใหม่ */
  no: string;
  prefix: string;
  version: number;
  issuer: string;
  body: string;
  date: string;
  by: string;
  from: ContractDoc["from"];
}): Promise<ContractWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return { ok: false, reason: "no_backend" };

  const deal = await sb.from("deals").select("id").eq("no", input.dealNo).maybeSingle();
  const dealId = (deal.data as { id?: string } | null)?.id;
  if (!dealId) return { ok: false, reason: "not_found" };

  let no = input.no;
  if (!no) {
    const made = await sb.rpc("next_contract_no", { p_prefix: input.prefix });
    if (made.error || !made.data) return { ok: false, reason: made.error?.message ?? "no_number" };
    no = made.data as string;
  }

  const got = await sb
    .from("deal_contract_docs")
    .insert({
      deal_id: dealId,
      no,
      version: input.version,
      issuer: input.issuer,
      body: input.body,
      on_date: input.date || null,
      by_name: input.by,
      by_id: myId(),
      from_kind: input.from,
    })
    .select("id, no, version, issuer, body, on_date, by_name, from_kind, created_at")
    .single();
  if (got.error) {
    return { ok: false, reason: /row-level security/i.test(got.error.message) ? "denied" : got.error.message };
  }
  const r = got.data as unknown as Omit<Row, "deal_id" | "deals">;
  return {
    ok: true,
    doc: {
      id: r.id,
      dealNo: input.dealNo,
      no: r.no,
      version: r.version,
      issuer: r.issuer,
      body: r.body,
      date: r.on_date ?? "",
      at: stampOf(r.created_at),
      by: r.by_name,
      from: r.from_kind === "edit" ? "edit" : "draft",
    },
  };
}
