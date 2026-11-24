"use client";

import { signedIn, supabase } from "./client";
import { myId, nameById } from "./people";
import type {
  Activity,
  BuyerType,
  ChangeLog,
  Customer,
  CustomerStatus,
  Deal,
  JobOrder,
  PresalesRequest,
  PresalesRound,
  Quotation,
} from "../crm-data";

/*
 * สายผู้สนใจ/ลูกค้าจากฐานข้อมูล (รอบที่ 95 · SRS 1.5 M1)
 *
 * แปลงไปเป็นรูปเดียวกับที่หน้าจอใช้อยู่เดิมทุกช่อง หน้าจอจึงไม่ต้องแก้อะไรเลย
 * สิ่งที่ต้องแปลงมีสองเรื่อง
 *   ตัวอ้างอิง  ฐานข้อมูลผูกกันด้วย id (uuid) หน้าจอผูกกันด้วยรหัส (LEAD-… / CUS-…)
 *   ตัวคน       ฐานข้อมูลเก็บทั้งชื่อและรหัสพนักงาน หน้าจอใช้ชื่อ
 *
 * เลขที่เอกสารไม่ได้ส่งขึ้นไป ฐานข้อมูลเป็นคนออกให้ (ทริกเกอร์ customers_code)
 * สองเครื่องกดเปิดผู้สนใจพร้อมกันจะได้ไม่ได้รหัสซ้ำกัน
 */

type CustomerRow = {
  id: string;
  code: string;
  lead_code: string | null;
  name: string;
  legal_name: string;
  contact: string;
  phone: string;
  email: string;
  address: string;
  legal_address: string;
  branch: string;
  tax_id: string;
  source: string;
  buyer_type: string;
  status: string;
  closed_reason: string;
  owner: string;
};

type ActivityRow = {
  id: string;
  customer_id: string;
  on_date: string;
  channel: string;
  summary: string;
  next_action: string;
  follow_up: string | null;
};

type ChangeRow = {
  id: string;
  customer_id: string;
  kind: string;
  from_value: string;
  to_value: string;
  reason: string;
  by_name: string;
  at: string;
};

const CUSTOMER_COLS =
  "id, code, lead_code, name, legal_name, contact, phone, email, address, legal_address," +
  " branch, tax_id, source, buyer_type, status, closed_reason, owner";

/** yyyy-mm-dd ตามเวลาไทยของเวลาที่ฐานข้อมูลคืนมา */
function thaiDay(at: string) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at.slice(0, 10);
  return new Date(d.getTime() + (420 + d.getTimezoneOffset()) * 60_000).toISOString().slice(0, 10);
}

function toCustomer(r: CustomerRow): Customer {
  return {
    code: r.code,
    name: r.name,
    contact: r.contact,
    phone: r.phone,
    email: r.email,
    address: r.address,
    source: r.source,
    taxId: r.tax_id,
    legalName: r.legal_name || undefined,
    legalAddress: r.legal_address || undefined,
    branch: r.branch || undefined,
    type: (r.buyer_type === "individual" ? "individual" : "juristic") as BuyerType,
    status: r.status as CustomerStatus,
    leadCode: r.lead_code ?? undefined,
    closedReason: r.closed_reason,
    owner: r.owner,
  };
}

/** แปลงกลับเป็นแถวของฐานข้อมูล — ส่งเฉพาะช่องที่หน้าจอแก้ได้ */
function toRow(c: Partial<Customer>) {
  const out: Record<string, unknown> = {};
  if (c.name !== undefined) out.name = c.name;
  if (c.contact !== undefined) out.contact = c.contact;
  if (c.phone !== undefined) out.phone = c.phone;
  if (c.email !== undefined) out.email = c.email;
  if (c.address !== undefined) out.address = c.address;
  if (c.source !== undefined) out.source = c.source;
  if (c.taxId !== undefined) out.tax_id = c.taxId;
  if (c.legalName !== undefined) out.legal_name = c.legalName ?? "";
  if (c.legalAddress !== undefined) out.legal_address = c.legalAddress ?? "";
  if (c.branch !== undefined) out.branch = c.branch ?? "";
  if (c.type !== undefined) out.buyer_type = c.type;
  if (c.status !== undefined) out.status = c.status;
  if (c.closedReason !== undefined) out.closed_reason = c.closedReason;
  if (c.owner !== undefined) out.owner = c.owner;
  if (c.leadCode !== undefined) out.lead_code = c.leadCode ?? null;
  if (c.code !== undefined) out.code = c.code;
  return out;
}

/* ─── อ่าน ──────────────────────────────────────────────────────── */

export type SalesParties = {
  customers: Customer[];
  activities: Activity[];
  changeLogs: ChangeLog[];
  /** รหัส → id ของฐานข้อมูล เก็บไว้ให้ตัวเขียนใช้ต่อโดยไม่ต้องถามซ้ำ */
  idByCode: Record<string, string>;
};

export const EMPTY_PARTIES: SalesParties = {
  customers: [],
  activities: [],
  changeLogs: [],
  idByCode: {},
};

export async function fetchSalesParties(): Promise<SalesParties> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return EMPTY_PARTIES;

  const got = await sb.from("customers").select(CUSTOMER_COLS).order("code", { ascending: false });
  if (got.error || !got.data) return EMPTY_PARTIES;
  const rows = got.data as unknown as CustomerRow[];
  const codeById: Record<string, string> = {};
  const idByCode: Record<string, string> = {};
  for (const r of rows) {
    codeById[r.id] = r.code;
    idByCode[r.code] = r.id;
  }

  const [act, log] = await Promise.all([
    sb
      .from("customer_activities")
      .select("id, customer_id, on_date, channel, summary, next_action, follow_up")
      .order("on_date", { ascending: false }),
    sb
      .from("customer_changes")
      .select("id, customer_id, kind, from_value, to_value, reason, by_name, at")
      .order("at", { ascending: false }),
  ]);

  const activities = ((act.data ?? []) as unknown as ActivityRow[]).map<Activity>((r) => ({
    id: r.id,
    customerCode: codeById[r.customer_id] ?? "",
    date: r.on_date,
    channel: r.channel,
    summary: r.summary,
    nextAction: r.next_action,
    followUp: r.follow_up ?? "",
  }));

  const changeLogs = ((log.data ?? []) as unknown as ChangeRow[]).map((r) => {
    const base = {
      id: r.id,
      at: thaiDay(r.at),
      customerCode: codeById[r.customer_id] ?? "",
      reason: r.reason,
      by: r.by_name,
    };
    return (
      r.kind === "owner"
        ? { ...base, kind: "owner", from: r.from_value, to: r.to_value }
        : { ...base, kind: "status", from: r.from_value as CustomerStatus, to: r.to_value as CustomerStatus }
    ) as ChangeLog;
  });

  return { customers: rows.map(toCustomer), activities, changeLogs, idByCode };
}

/* ─── เขียน ─────────────────────────────────────────────────────── */

export type CrmWrite = { ok: true; code?: string } | { ok: false; reason: string };

const NO_BACKEND: CrmWrite = { ok: false, reason: "no_backend" };

/** ข้อความอธิบายเหตุที่ฐานข้อมูลไม่รับ — ใช้ชุดเดียวกับหน้าจออื่น */
export const CRM_REASON: Record<string, string> = {
  no_backend: "ยังไม่ได้ต่อฐานข้อมูล",
  denied: "ไม่มีสิทธิ์แก้ข้อมูลลูกค้า",
  not_found: "ไม่พบรายการนี้แล้ว",
  duplicate: "รหัสนี้มีอยู่แล้ว",
};

function sayWhy(message: string): string {
  if (/row-level security/i.test(message)) return "denied";
  if (/duplicate key/i.test(message)) return "duplicate";
  return message.split("\n")[0].slice(0, 80);
}

async function idOf(code: string): Promise<string | null> {
  const sb = supabase();
  if (!sb) return null;
  const got = await sb
    .from("customers")
    .select("id")
    .or(`code.eq.${code},lead_code.eq.${code}`)
    .maybeSingle();
  return (got.data as { id?: string } | null)?.id ?? null;
}

/** เปิดผู้สนใจรายใหม่ — รหัสออกจากฐานข้อมูล ไม่ใช่จากเบราว์เซอร์ */
export async function sbAddLead(input: Partial<Customer>): Promise<CrmWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const me = myId();
  const row: Record<string, unknown> = { ...toRow(input), created_by: me, owner_id: me };
  /* รหัสมาจากฐานข้อมูลเสมอ ส่งขึ้นไปเองไม่ได้ */
  delete row.code;
  const got = await sb.from("customers").insert(row).select("code").single();
  if (got.error) return { ok: false, reason: sayWhy(got.error.message) };
  return { ok: true, code: (got.data as { code: string }).code };
}

export async function sbUpdateCustomer(code: string, patch: Partial<Customer>): Promise<CrmWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const id = await idOf(code);
  if (!id) return { ok: false, reason: "not_found" };
  const got = await sb.from("customers").update(toRow(patch)).eq("id", id);
  if (got.error) return { ok: false, reason: sayWhy(got.error.message) };
  return { ok: true };
}

/**
 * เปลี่ยนสถานะหรือเปลี่ยนตัวผู้ดูแล พร้อมลงประวัติในคำสั่งเดียวกัน
 * ทุกทางที่เปลี่ยนสองเรื่องนี้ต้องผ่านตัวนี้ จะได้มีร่องรอยเสมอ (เหมือน moveCustomer ฝั่งหน้าจอ)
 */
export async function sbMoveCustomer(input: {
  code: string;
  kind: "status" | "owner";
  from: string;
  to: string;
  reason: string;
  /** ปิดการขายแล้วเปลี่ยนรหัสจาก LEAD- เป็น CUS- — ส่งรหัสใหม่มาด้วย */
  newCode?: string;
}): Promise<CrmWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const id = await idOf(input.code);
  if (!id) return { ok: false, reason: "not_found" };

  const patch: Record<string, unknown> =
    input.kind === "status"
      ? { status: input.to, closed_reason: input.to === "รอนัดหมาย" ? "" : input.reason }
      : { owner: input.to };
  if (input.newCode && input.newCode !== input.code) {
    patch.code = input.newCode;
    patch.lead_code = input.code;
  }

  const up = await sb.from("customers").update(patch).eq("id", id);
  if (up.error) return { ok: false, reason: sayWhy(up.error.message) };

  const me = myId();
  const log = await sb.from("customer_changes").insert({
    customer_id: id,
    kind: input.kind,
    from_value: input.from,
    to_value: input.to,
    reason: input.reason,
    by_name: me ? nameById(me) : "",
    by_id: me,
  });
  if (log.error) return { ok: false, reason: sayWhy(log.error.message) };
  return { ok: true, code: input.newCode ?? input.code };
}

export async function sbLogActivity(input: {
  code: string;
  date: string;
  channel: string;
  summary: string;
  nextAction: string;
  followUp: string;
}): Promise<CrmWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const id = await idOf(input.code);
  if (!id) return { ok: false, reason: "not_found" };
  const got = await sb.from("customer_activities").insert({
    customer_id: id,
    on_date: input.date,
    channel: input.channel,
    summary: input.summary,
    next_action: input.nextAction,
    follow_up: input.followUp || null,
    by_id: myId(),
  });
  if (got.error) return { ok: false, reason: sayWhy(got.error.message) };
  return { ok: true };
}

/**
 * ลบผู้สนใจ — ฐานข้อมูลกันไว้แล้วว่าลบได้เฉพาะรายที่ยังไม่มีคำขอ ใบเสนอราคา หรือดีล (รอบที่ 97)
 * ลบไม่ผ่านด่านจะไม่ error แต่จะไม่มีแถวถูกลบ จึงต้องนับแถวที่ลบจริงกลับมาด้วย
 */
export async function sbRemoveLead(code: string): Promise<CrmWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const id = await idOf(code);
  if (!id) return { ok: false, reason: "not_found" };
  const got = await sb.from("customers").delete().eq("id", id).select("code");
  if (got.error) return { ok: false, reason: sayWhy(got.error.message) };
  if (!got.data?.length) return { ok: false, reason: "denied" };
  return { ok: true, code };
}

/* ─── คำขอก่อนการขาย ─────────────────────────────────────────────── */

type PresalesRow = {
  id: string;
  no: string;
  customer_id: string;
  kind: "BD" | "SA";
  problem: string;
  assignee: string;
  due: string | null;
  urgency: string;
  urgent_reason: string;
  budget: number | string;
  status: string;
  ask: string;
  reply: string;
  hours: number | string;
  plan: unknown;
  created_at: string;
};

type RoundRow = {
  id: string;
  request_id: string;
  round: number;
  at: string;
  by_name: string;
  hours: number | string;
  note: string;
  kind: string;
  name: string;
  url: string;
  files: unknown;
};

const PRESALES_COLS =
  "id, no, customer_id, kind, problem, assignee, due, urgency, urgent_reason," +
  " budget, status, ask, reply, hours, plan, created_at";

export type SalesPresales = {
  presales: PresalesRequest[];
  presalesRounds: PresalesRound[];
  /** เลขที่คำขอ → id ของฐานข้อมูล */
  idByNo: Record<string, string>;
};

export const EMPTY_PRESALES: SalesPresales = { presales: [], presalesRounds: [], idByNo: {} };

export async function fetchPresales(codeById: Record<string, string>): Promise<SalesPresales> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return EMPTY_PRESALES;
  const got = await sb.from("presales_requests").select(PRESALES_COLS).order("no", { ascending: false });
  if (got.error || !got.data) return EMPTY_PRESALES;
  const rows = got.data as unknown as PresalesRow[];
  const noById: Record<string, string> = {};
  const idByNo: Record<string, string> = {};
  for (const r of rows) {
    noById[r.id] = r.no;
    idByNo[r.no] = r.id;
  }

  const rd = await sb
    .from("presales_rounds")
    .select("id, request_id, round, at, by_name, hours, note, kind, name, url, files")
    .order("round", { ascending: false });

  const presales = rows.map<PresalesRequest>((r) => ({
    id: r.id,
    no: r.no,
    customerCode: codeById[r.customer_id] ?? "",
    kind: r.kind,
    problem: r.problem,
    assignee: r.assignee,
    due: r.due ?? "",
    urgency: r.urgency as PresalesRequest["urgency"],
    urgentReason: r.urgent_reason,
    budget: Number(r.budget),
    attachments: [],
    status: r.status as PresalesRequest["status"],
    createdAt: thaiDay(r.created_at),
    ask: r.ask || undefined,
    reply: r.reply || undefined,
    hours: Number(r.hours),
    plan: (r.plan as PresalesRequest["plan"]) ?? undefined,
  }));

  const presalesRounds = ((rd.data ?? []) as unknown as RoundRow[]).map<PresalesRound>((r) => ({
    id: r.id,
    requestNo: noById[r.request_id] ?? "",
    round: r.round,
    at: r.at,
    by: r.by_name,
    hours: Number(r.hours),
    note: r.note,
    file: r.name,
    kind: r.kind === "canva" ? "canva" : "pdf",
    url: r.url || undefined,
    files: (r.files as PresalesRound["files"]) ?? undefined,
  }));

  return { presales, presalesRounds, idByNo };
}

async function presalesIdOf(no: string): Promise<string | null> {
  const sb = supabase();
  if (!sb) return null;
  const got = await sb.from("presales_requests").select("id").eq("no", no).maybeSingle();
  return (got.data as { id?: string } | null)?.id ?? null;
}

/** เปิดคำขอก่อนการขาย — เลขที่ออกจากฐานข้อมูล */
export async function sbAddPresales(input: {
  customerCode: string;
  kind: "BD" | "SA";
  problem: string;
  assignee: string;
  due: string;
  urgency: string;
  urgentReason: string;
  budget: number;
}): Promise<CrmWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const customer = await idOf(input.customerCode);
  if (!customer) return { ok: false, reason: "not_found" };
  const got = await sb
    .from("presales_requests")
    .insert({
      customer_id: customer,
      kind: input.kind,
      problem: input.problem,
      assignee: input.assignee,
      due: input.due || null,
      urgency: input.urgency,
      urgent_reason: input.urgentReason,
      budget: input.budget,
      created_by: myId(),
    })
    .select("no")
    .single();
  if (got.error) return { ok: false, reason: sayWhy(got.error.message) };
  return { ok: true, code: (got.data as { no: string }).no };
}

export async function sbEditPresales(no: string, patch: Record<string, unknown>): Promise<CrmWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const id = await presalesIdOf(no);
  if (!id) return { ok: false, reason: "not_found" };
  const got = await sb.from("presales_requests").update(patch).eq("id", id);
  if (got.error) return { ok: false, reason: sayWhy(got.error.message) };
  return { ok: true };
}

/**
 * ส่งข้อเสนอกลับหนึ่งรอบ — เลขรอบนับต่อจากรอบล่าสุดของคำขอนั้น
 * ชั่วโมงของรอบนี้บวกเข้าชั่วโมงรวมของคำขอ แล้วสถานะกลายเป็น "ส่งกลับแล้ว"
 */
export async function sbAddPresalesRound(
  no: string,
  input: {
    by: string;
    hours: number;
    note: string;
    file: string;
    kind: "pdf" | "canva";
    url?: string;
    files?: { name: string; url?: string }[];
  },
): Promise<CrmWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const id = await presalesIdOf(no);
  if (!id) return { ok: false, reason: "not_found" };

  const last = await sb
    .from("presales_rounds")
    .select("round, hours")
    .eq("request_id", id)
    .order("round", { ascending: false });
  const rows = (last.data ?? []) as { round: number; hours: number | string }[];
  const round = rows.reduce((m, r) => Math.max(m, r.round), 0) + 1;

  const add = await sb.from("presales_rounds").insert({
    request_id: id,
    round,
    at: new Date().toISOString().slice(0, 10),
    by_name: input.by,
    by_id: myId(),
    hours: input.hours,
    note: input.note,
    kind: input.kind,
    name: input.file,
    url: input.url ?? "",
    files: input.files ?? null,
  });
  if (add.error) return { ok: false, reason: sayWhy(add.error.message) };

  const sum = rows.reduce((a, r) => a + Number(r.hours), 0) + input.hours;
  const up = await sb
    .from("presales_requests")
    .update({ status: "ส่งกลับแล้ว", hours: sum })
    .eq("id", id);
  if (up.error) return { ok: false, reason: sayWhy(up.error.message) };
  return { ok: true };
}

/* ─── ใบเสนอราคา · ดีล · ใบงาน ──────────────────────────────────── */

type QuotationRow = {
  id: string;
  no: string;
  customer_id: string;
  issuer: string;
  buyer_type: string;
  service: string;
  issued: string;
  valid_days: number;
  valid_until: string;
  amount: number | string;
  discount: number | string;
  wht: boolean;
  wht_pct: number | string | null;
  body: string;
  terms: string;
  status: string;
  revision: number;
  sent_at: string | null;
  presales_id: string | null;
  replaces: string | null;
  replaced_by: string | null;
  rejected_at: string | null;
  reject_reason: string;
  created_at: string;
};

type DealRow = {
  id: string;
  no: string;
  customer_id: string;
  quotation_id: string | null;
  total: number | string;
  status: string;
  po_ref: string;
  start_on: string | null;
  delivery: string | null;
  scope: string;
  closed_at: string | null;
  lost_reason: string;
  cancel_at: string | null;
  cancel_by: string;
  cancel_why: string;
  seller: string;
};

type ContractRow = {
  id: string;
  deal_id: string;
  no: string;
  signed: string | null;
  kind: string;
  name: string;
  url: string;
  by_name: string;
  at: string;
};

type JobRow = {
  id: string;
  no: string;
  deal_id: string;
  owner: string;
  item: string;
  due: string | null;
  status: string;
};

const QUOTATION_COLS =
  "id, no, customer_id, issuer, buyer_type, service, issued, valid_days, valid_until," +
  " amount, discount, wht, wht_pct, body, terms, status, revision, sent_at, presales_id," +
  " replaces, replaced_by, rejected_at, reject_reason, created_at";

const DEAL_COLS =
  "id, no, customer_id, quotation_id, total, status, po_ref, start_on, delivery, scope," +
  " closed_at, lost_reason, cancel_at, cancel_by, cancel_why, seller";

export type SalesDocs = {
  quotations: Quotation[];
  deals: Deal[];
  jobOrders: JobOrder[];
};

export const EMPTY_DOCS: SalesDocs = { quotations: [], deals: [], jobOrders: [] };

export async function fetchSalesDocs(
  codeById: Record<string, string>,
  psNoById: Record<string, string>,
): Promise<SalesDocs> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return EMPTY_DOCS;

  const [qs, ds] = await Promise.all([
    sb.from("quotations").select(QUOTATION_COLS).order("no", { ascending: false }),
    sb.from("deals").select(DEAL_COLS).order("no", { ascending: false }),
  ]);
  const qRows = (qs.data ?? []) as unknown as QuotationRow[];
  const dRows = (ds.data ?? []) as unknown as DealRow[];
  const qNoById: Record<string, string> = {};
  for (const r of qRows) qNoById[r.id] = r.no;
  const dNoById: Record<string, string> = {};
  for (const r of dRows) dNoById[r.id] = r.no;

  const [ct, jb] = await Promise.all([
    sb.from("deal_contracts").select("id, deal_id, no, signed, kind, name, url, by_name, at").order("at"),
    sb.from("job_orders").select("id, no, deal_id, owner, item, due, status").order("no"),
  ]);

  const byDeal: Record<string, NonNullable<Deal["contracts"]>> = {};
  for (const r of (ct.data ?? []) as unknown as ContractRow[]) {
    (byDeal[r.deal_id] ??= []).push({
      no: r.no,
      signed: r.signed ?? "",
      kind: r.kind === "link" ? "link" : "pdf",
      name: r.name,
      url: r.url,
      by: r.by_name,
      at: r.at,
    });
  }

  const quotations = qRows.map<Quotation>((r) => ({
    id: r.id,
    no: r.no,
    customerCode: codeById[r.customer_id] ?? "",
    issuer: r.issuer,
    buyer: (r.buyer_type === "individual" ? "individual" : "juristic") as BuyerType,
    service: (r.service || undefined) as Quotation["service"],
    issued: r.issued,
    validDays: r.valid_days,
    validUntil: r.valid_until,
    amount: Number(r.amount),
    discount: Number(r.discount),
    wht: r.wht,
    whtPct: r.wht_pct === null ? undefined : Number(r.wht_pct),
    body: r.body,
    terms: r.terms,
    status: r.status as Quotation["status"],
    revision: r.revision,
    createdAt: thaiDay(r.created_at),
    sentAt: r.sent_at ?? undefined,
    ps: r.presales_id ? psNoById[r.presales_id] : undefined,
    replaces: r.replaces ?? undefined,
    replacedBy: r.replaced_by ?? undefined,
    rejectedAt: r.rejected_at ?? undefined,
    rejectReason: r.reject_reason || undefined,
  }));

  const deals = dRows.map<Deal>((r) => ({
    id: r.id,
    no: r.no,
    customerCode: codeById[r.customer_id] ?? "",
    quotationNo: r.quotation_id ? (qNoById[r.quotation_id] ?? "") : "",
    total: Number(r.total),
    status: r.status as Deal["status"],
    poRef: r.po_ref,
    start: r.start_on ?? "",
    delivery: r.delivery ?? "",
    scope: r.scope,
    closedAt: r.closed_at ?? "",
    lostReason: r.lost_reason,
    cancelled: r.cancel_at ? { at: r.cancel_at, by: r.cancel_by, why: r.cancel_why } : undefined,
    seller: r.seller || undefined,
    contracts: byDeal[r.id],
  }));

  const jobOrders = ((jb.data ?? []) as unknown as JobRow[]).map<JobOrder>((r) => ({
    id: r.id,
    dealNo: dNoById[r.deal_id] ?? "",
    no: r.no,
    owner: r.owner,
    item: r.item,
    due: r.due ?? "",
    status: r.status as JobOrder["status"],
  }));

  return { quotations, deals, jobOrders };
}

/** ออกใบเสนอราคา — เลขที่ออกจากฐานข้อมูลตามคำนำหน้าของผู้ออกเอกสาร */
export async function sbAddQuotation(input: {
  customerCode: string;
  issuer: string;
  prefixKey: string;
  prefix: string;
  buyer: string;
  service: string;
  issued: string;
  validDays: number;
  validUntil: string;
  amount: number;
  discount: number;
  wht: boolean;
  whtPct?: number;
  body: string;
  terms: string;
  psNo?: string;
  replaces?: string;
}): Promise<CrmWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const customer = await idOf(input.customerCode);
  if (!customer) return { ok: false, reason: "not_found" };
  const ps = input.psNo ? await presalesIdOf(input.psNo) : null;

  const no = await sb.rpc("next_sales_no", { p_key: input.prefixKey, p_fallback: input.prefix });
  if (no.error || !no.data) return { ok: false, reason: sayWhy(no.error?.message ?? "no_number") };

  const got = await sb
    .from("quotations")
    .insert({
      no: no.data as string,
      customer_id: customer,
      issuer: input.issuer,
      buyer_type: input.buyer,
      service: input.service,
      issued: input.issued,
      valid_days: input.validDays,
      valid_until: input.validUntil,
      amount: input.amount,
      discount: input.discount,
      wht: input.wht,
      wht_pct: input.whtPct ?? null,
      body: input.body,
      terms: input.terms,
      presales_id: ps,
      sent_at: input.issued,
      replaces: input.replaces ?? null,
      created_by: myId(),
    })
    .select("no")
    .single();
  if (got.error) return { ok: false, reason: sayWhy(got.error.message) };

  /* ใบเดิมกลายเป็น "แทนที่แล้ว" และจำว่าถูกแทนด้วยใบไหน */
  if (input.replaces) {
    await sb
      .from("quotations")
      .update({ status: "แทนที่แล้ว", replaced_by: no.data as string })
      .eq("no", input.replaces);
  }
  return { ok: true, code: (got.data as { no: string }).no };
}

/** ลูกค้าปฏิเสธใบเสนอราคา — ไม่เกิดดีล */
export async function sbRejectQuotation(no: string, reason: string): Promise<CrmWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const got = await sb
    .from("quotations")
    .update({
      status: "ปฏิเสธ",
      rejected_at: new Date().toISOString().slice(0, 10),
      reject_reason: reason,
    })
    .eq("no", no)
    .eq("status", "ส่งแล้ว")
    .select("no");
  if (got.error) return { ok: false, reason: sayWhy(got.error.message) };
  if (!got.data?.length) return { ok: false, reason: "not_found" };
  return { ok: true };
}

/** ลูกค้าตอบรับ — ฐานข้อมูลทำทั้งชุดในคำสั่งเดียว (รอบที่ 98) */
export async function sbAcceptQuotation(input: {
  no: string;
  scope: string;
  delivery: string;
  jobOwner: string;
}): Promise<{ ok: boolean; deal?: string; reason?: string }> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return { ok: false, reason: "no_backend" };
  const got = await sb.rpc("accept_quotation", {
    p_no: input.no,
    p_scope: input.scope,
    p_delivery: input.delivery,
    p_job_owner: input.jobOwner,
  });
  if (got.error) return { ok: false, reason: sayWhy(got.error.message) };
  return got.data as { ok: boolean; deal?: string; reason?: string };
}

export async function sbCancelDeal(no: string, why: string, by: string): Promise<CrmWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const got = await sb.rpc("cancel_deal", { p_no: no, p_why: why, p_by: by });
  if (got.error) return { ok: false, reason: sayWhy(got.error.message) };
  const r = got.data as { ok: boolean; reason?: string };
  return r.ok ? { ok: true } : { ok: false, reason: r.reason ?? "denied" };
}

export async function sbAttachContract(
  dealNo: string,
  c: { no: string; signed: string; kind: "pdf" | "link"; name: string; url: string; by: string; at: string },
): Promise<CrmWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const deal = await sb.from("deals").select("id").eq("no", dealNo).maybeSingle();
  const id = (deal.data as { id?: string } | null)?.id;
  if (!id) return { ok: false, reason: "not_found" };
  const got = await sb.from("deal_contracts").insert({
    deal_id: id,
    no: c.no,
    signed: c.signed || null,
    kind: c.kind,
    name: c.name,
    url: c.url,
    by_name: c.by,
    by_id: myId(),
    at: c.at,
  });
  if (got.error) return { ok: false, reason: sayWhy(got.error.message) };
  return { ok: true };
}

/** งานฝั่งโปรเจคส่งมอบครบ — ปิดใบงานของดีลนั้นทั้งหมด */
export async function sbMarkJobsDelivered(dealNo: string): Promise<CrmWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const deal = await sb.from("deals").select("id").eq("no", dealNo).maybeSingle();
  const id = (deal.data as { id?: string } | null)?.id;
  if (!id) return { ok: false, reason: "not_found" };
  const got = await sb.from("job_orders").update({ status: "ส่งมอบ" }).eq("deal_id", id);
  if (got.error) return { ok: false, reason: sayWhy(got.error.message) };
  return { ok: true };
}
