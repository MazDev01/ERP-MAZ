"use client";

import { signedIn, supabase } from "./client";

/*
 * คำขอถึงบัญชีจากฝั่งโปรเจค — ต่อบริการเดิม (รอบที่ 139 · Requirement รอบ 7)
 *
 * ลูกค้าเก่าติดต่อ PM เองว่าจะต่อบริการ PM จึงแจ้งบัญชีได้เลยจากหน้าโปรเจค
 * เขียนผ่านฟังก์ชันของฐานข้อมูลเท่านั้น — ลูกค้า บริการ และชื่อคนแจ้งมาจากโปรเจคกับบัญชีที่ล็อกอิน
 * กรอกแทนกันหรือแจ้งให้ลูกค้ารายอื่นไม่ได้
 */

export type BillKind = "quotation" | "invoice";

export type BillingRequest = {
  no: string;
  /** รหัสลูกค้า (CUS-…) */
  customerCode: string;
  customerName: string;
  /** เลขที่โปรเจคที่ลูกค้าติดต่อมาต่อบริการ — ว่างได้ถ้าโปรเจคถูกลบ */
  pj: string;
  kind: BillKind;
  service: string;
  note: string;
  status: "open" | "done" | "cancelled";
  /** เลขเอกสารที่บัญชีออกให้ — ว่างคือยังไม่ได้ออก */
  docNo: string;
  by: string;
  at: string;
  closedBy: string;
  why: string;
};

type Row = {
  no: string;
  kind: string;
  service: string;
  note: string;
  status: string;
  doc_no: string;
  by_name: string;
  created_at: string;
  closed_by: string;
  why: string;
  customers: { code: string; name: string } | null;
  projects: { pj: string } | null;
};

const SELECT = "no, kind, service, note, status, doc_no, by_name, created_at, closed_by, why," + " customers(code, name), projects(pj)";

/** คำขอที่เห็นได้ — PM/GM/บัญชี/ผู้บริหาร (ชั้น RLS คัดให้) */
export async function fetchBillingRequests(): Promise<BillingRequest[]> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return [];
  const got = await sb.from("billing_requests").select(SELECT).order("created_at", { ascending: false });
  if (got.error) return [];
  return ((got.data ?? []) as unknown as Row[]).map((r) => ({
    no: r.no,
    customerCode: r.customers?.code ?? "",
    customerName: r.customers?.name ?? "",
    pj: r.projects?.pj ?? "",
    kind: r.kind === "invoice" ? "invoice" : "quotation",
    service: r.service,
    note: r.note,
    status: r.status === "done" ? "done" : r.status === "cancelled" ? "cancelled" : "open",
    docNo: r.doc_no,
    by: r.by_name,
    at: r.created_at,
    closedBy: r.closed_by,
    why: r.why,
  }));
}

export type BillReqWrite = { ok: true; no?: string } | { ok: false; reason: string };

const call = async (fn: string, args: Record<string, unknown>): Promise<BillReqWrite> => {
  const sb = supabase();
  if (!sb || !(await signedIn())) return { ok: false, reason: "no_backend" };
  const got = await sb.rpc(fn, args);
  if (got.error) return { ok: false, reason: got.error.message };
  const out = got.data as { ok?: boolean; reason?: string; no?: string } | null;
  return out?.ok ? { ok: true, no: out.no } : { ok: false, reason: out?.reason ?? "unknown" };
};

/** PM แจ้งบัญชีจากโปรเจค — ลูกค้าและบริการมาจากโปรเจคนั้น */
export const sbBillingRequestAdd = (pj: string, kind: BillKind, note: string, service = "") =>
  call("billing_request_add", { p_pj: pj, p_kind: kind, p_note: note, p_service: service });

/** บัญชีทำเสร็จ — ผูกเลขเอกสารที่ออกให้ แล้วคำขอปิดตัวเอง */
export const sbBillingRequestDone = (no: string, docNo: string) =>
  call("billing_request_done", { p_no: no, p_doc: docNo });

/** ยกเลิกคำขอ — คนแจ้งเองหรือบัญชี ต้องบอกเหตุผล */
export const sbBillingRequestCancel = (no: string, why: string) =>
  call("billing_request_cancel", { p_no: no, p_why: why });
