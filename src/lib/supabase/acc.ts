"use client";

import { signedIn, supabase } from "./client";
import { myId } from "./people";
import { issuerOf, quotationTotals, type Quotation } from "../crm-data";
import type { AccDeal, Collection, Installment, Invoice, Payment, Receipt, WhtRow } from "../acc-data";

/*
 * สายวางบิลจากฐานข้อมูล (รอบที่ 99 · SRS 1.5 M2)
 *
 * ต่างจากของเดิมตรงที่ฝั่งบัญชีไม่เก็บสำเนาดีลไว้เองแล้ว
 * ดีลที่รอวางบิลประกอบขึ้นจากดีลของฝ่ายขาย + ใบเสนอราคาที่ลูกค้าตอบรับ + แผนงวด
 * ยอดก่อนภาษี ภาษีมูลค่าเพิ่ม และภาษีหัก ณ ที่จ่าย อ่านจากใบเสนอราคาใบนั้นเสมอ
 * ฝั่งบัญชีไม่คิดใหม่ (กติกาเดิมใน flow.ts)
 *
 * การรับชำระฝั่งฐานข้อมูลเก็บเป็นรายครั้ง (หนึ่งใบเสร็จหนึ่งแถว)
 * แต่หน้าจอเดิมมองการรับชำระของใบแจ้งหนี้ใบหนึ่งเป็นก้อนเดียว จึงรวมให้ตอนอ่าน
 */

type DealRow = {
  id: string;
  no: string;
  scope: string;
  acc_seen: boolean;
  customers: { name: string } | null;
  quotations:
    | {
        no: string;
        issued: string;
        issuer: string;
        amount: number | string;
        discount: number | string;
        wht: boolean;
        wht_pct: number | string | null;
      }
    | null;
};

type InstallmentRow = {
  deal_id: string;
  seq: number;
  pct: number | string;
  amount: number | string;
  due: string | null;
};

type InvoiceRow = {
  id: string;
  no: string;
  deal_id: string;
  seq: number;
  issue: string;
  due: string | null;
  base: number | string;
  vat: number | string;
  wht: number | string;
  total: number | string;
  outstanding: number | string;
  status: string;
  cancel_at: string | null;
  cancel_by: string;
  cancel_why: string;
  cancel_note: string;
};

type CollectionRow = {
  invoice_id: string;
  on_date: string;
  channel: string;
  result: string;
  next_step: string;
};

type PaymentRow = {
  invoice_id: string;
  on_date: string;
  received: number | string;
  wht: number | string;
  cert_received: boolean;
};

type ReceiptRow = {
  id: string;
  no: string;
  invoice_id: string;
  on_date: string;
  base: number | string;
  vat_amount: number | string;
  wht: number | string;
  total: number | string;
  cert_received: boolean;
  vat_doc: boolean;
};

type WhtDbRow = {
  id: string;
  on_date: string;
  name: string;
  tax_id: string;
  kind: string;
  payee_type: string;
  pay_type: string;
  base: number | string;
  rate: number | string;
  no: string;
  addr: string;
  cond: number | null;
  cond_note: string;
  issued: string | null;
  gpf: number | string;
  sso: number | string;
  pvd: number | string;
};

const n = (v: number | string | null | undefined) => Number(v ?? 0);

export type AccBilling = {
  deals: AccDeal[];
  invoices: Invoice[];
  payments: Payment[];
  receipts: Receipt[];
  wht: WhtRow[];
  /** เลขที่ใบแจ้งหนี้ → id ของฐานข้อมูล · เลขที่ดีล → id */
  invIdByNo: Record<string, string>;
  dealIdByNo: Record<string, string>;
};

export const EMPTY_BILLING: AccBilling = {
  deals: [],
  invoices: [],
  payments: [],
  receipts: [],
  wht: [],
  invIdByNo: {},
  dealIdByNo: {},
};

export async function fetchAccBilling(): Promise<AccBilling> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return EMPTY_BILLING;

  const got = await sb
    .from("deals")
    .select(
      "id, no, scope, acc_seen, customers(name)," +
        " quotations(no, issued, issuer, amount, discount, wht, wht_pct)",
    )
    .eq("status", "ปิดการขาย")
    .order("no", { ascending: false });
  if (got.error) return EMPTY_BILLING;
  const dealRows = (got.data ?? []) as unknown as DealRow[];

  const dealIdByNo: Record<string, string> = {};
  const dealNoById: Record<string, string> = {};
  for (const d of dealRows) {
    dealIdByNo[d.no] = d.id;
    dealNoById[d.id] = d.no;
  }

  const [pl, iv, wt] = await Promise.all([
    sb.from("deal_installments").select("deal_id, seq, pct, amount, due").order("seq"),
    sb
      .from("invoices")
      .select(
        "id, no, deal_id, seq, issue, due, base, vat, wht, total, outstanding, status," +
          " cancel_at, cancel_by, cancel_why, cancel_note",
      )
      .order("no"),
    sb
      .from("wht_rows")
      .select(
        "id, on_date, name, tax_id, kind, payee_type, pay_type, base, rate," +
          " no, addr, cond, cond_note, issued, gpf, sso, pvd",
      ).order("on_date", { ascending: false }),
  ]);

  const planByDeal: Record<string, Installment[]> = {};
  for (const r of (pl.data ?? []) as unknown as InstallmentRow[]) {
    (planByDeal[r.deal_id] ??= []).push({
      seq: r.seq,
      pct: n(r.pct),
      amount: n(r.amount),
      due: r.due ?? "",
    });
  }

  const invRows = (iv.data ?? []) as unknown as InvoiceRow[];
  const invIdByNo: Record<string, string> = {};
  const invNoById: Record<string, string> = {};
  for (const r of invRows) {
    invIdByNo[r.no] = r.id;
    invNoById[r.id] = r.no;
  }

  const [cl, pm, rc] = await Promise.all([
    sb.from("invoice_collections").select("invoice_id, on_date, channel, result, next_step").order("on_date"),
    sb.from("payments").select("invoice_id, on_date, received, wht, cert_received").order("on_date"),
    sb
      .from("receipts")
      .select("id, no, invoice_id, on_date, base, vat_amount, wht, total, cert_received, vat_doc")
      .order("no"),
  ]);

  const colByInv: Record<string, Collection[]> = {};
  for (const r of (cl.data ?? []) as unknown as CollectionRow[]) {
    (colByInv[r.invoice_id] ??= []).push({
      date: r.on_date,
      channel: r.channel,
      result: r.result,
      next: r.next_step,
    });
  }

  const deals = dealRows.map<AccDeal>((d) => {
    const q = d.quotations;
    /* ยอดจากใบเสนอราคาใบที่ลูกค้าตอบรับ — ใช้สูตรกลางตัวเดียวกับฝั่งขาย */
    const money = q
      ? quotationTotals({
          amount: n(q.amount),
          discount: n(q.discount),
          wht: q.wht,
          whtPct: q.wht_pct === null ? undefined : n(q.wht_pct),
          issuer: q.issuer,
        } as Quotation)
      : { base: 0, whtAmount: 0, whtPct: 0, grand: 0 };
    return {
      no: d.no,
      cus: d.customers?.name ?? "",
      quo: q?.no ?? "",
      quoDate: q?.issued ?? "",
      base: money.base,
      vat: q ? issuerOf(q.issuer).vat : false,
      wht: money.whtAmount,
      whtPct: money.whtPct,
      net: money.grand,
      scope: d.scope,
      plan: planByDeal[d.id] ?? [],
      accSeen: d.acc_seen,
    };
  });

  const invoices = invRows.map<Invoice>((r) => ({
    no: r.no,
    deal: dealNoById[r.deal_id] ?? "",
    cus: deals.find((d) => d.no === dealNoById[r.deal_id])?.cus ?? "",
    seq: r.seq,
    issue: r.issue,
    due: r.due ?? "",
    base: n(r.base),
    vat: n(r.vat),
    wht: n(r.wht),
    total: n(r.total),
    outstanding: n(r.outstanding),
    status: r.status as Invoice["status"],
    cancelled: r.cancel_at
      ? { at: r.cancel_at.slice(0, 10), by: r.cancel_by, why: r.cancel_why, note: r.cancel_note || undefined }
      : undefined,
    col: colByInv[r.id] ?? [],
  }));

  /* หน้าจอเดิมมองการรับชำระของใบหนึ่งเป็นก้อนเดียว — รวมรายครั้งให้ตรงรูปเดิม */
  const sum: Record<string, Payment> = {};
  for (const r of (pm.data ?? []) as unknown as PaymentRow[]) {
    const no = invNoById[r.invoice_id];
    if (!no) continue;
    const cur = sum[no];
    sum[no] = {
      inv: no,
      date: cur ? (r.on_date > cur.date ? r.on_date : cur.date) : r.on_date,
      received: (cur?.received ?? 0) + n(r.received),
      wht: (cur?.wht ?? 0) + n(r.wht),
      certReceived: cur ? cur.certReceived && r.cert_received : r.cert_received,
    };
  }

  const receipts = ((rc.data ?? []) as unknown as ReceiptRow[]).map<Receipt>((r) => {
    const inv = invoices.find((x) => x.no === invNoById[r.invoice_id]);
    return {
      no: r.no,
      inv: inv?.no ?? "",
      deal: inv?.deal ?? "",
      seq: inv?.seq ?? 0,
      cus: inv?.cus ?? "",
      date: r.on_date,
      base: n(r.base),
      vatAmount: n(r.vat_amount),
      wht: n(r.wht),
      total: n(r.total),
      certReceived: r.cert_received,
      vat: r.vat_doc,
    };
  });

  const wht = ((wt.data ?? []) as unknown as WhtDbRow[]).map<WhtRow>((r) => ({
    id: r.id,
    date: r.on_date,
    name: r.name,
    tax: r.tax_id,
    kind: r.kind as WhtRow["kind"],
    type: r.pay_type,
    base: n(r.base),
    rate: n(r.rate),
    payeeType: (r.payee_type === "individual" ? "individual" : "juristic") as WhtRow["payeeType"],
    no: r.no || undefined,
    addr: r.addr || undefined,
    cond: (r.cond ?? undefined) as WhtRow["cond"],
    condNote: r.cond_note || undefined,
    issued: r.issued ?? undefined,
    gpf: n(r.gpf) || undefined,
    sso: n(r.sso) || undefined,
    pvd: n(r.pvd) || undefined,
  }));

  return { deals, invoices, payments: Object.values(sum), receipts, wht, invIdByNo, dealIdByNo };
}

/* ─── เขียน ─────────────────────────────────────────────────────── */

export type AccWrite = { ok: true; no?: string } | { ok: false; reason: string };

const NO_BACKEND: AccWrite = { ok: false, reason: "no_backend" };

export const ACC_REASON: Record<string, string> = {
  no_backend: "ยังไม่ได้ต่อฐานข้อมูล",
  denied: "ไม่มีสิทธิ์แก้เอกสารการเงิน",
  not_found: "ไม่พบรายการนี้แล้ว",
  invoice_locked: "ใบแจ้งหนี้ที่ออกเลขแล้วแก้ยอดไม่ได้",
  receipt_locked: "ใบเสร็จที่ออกแล้วแก้ไม่ได้",
  payment_locked: "รายการรับชำระที่บันทึกแล้วแก้ไม่ได้",
  need_cancel_reason: "ยกเลิกต้องบอกเหตุผล",
};

function why(message: string): string {
  if (/row-level security/i.test(message)) return "denied";
  /* ข้อความจากด่านลำดับงวด (รอบที่ 112) — ส่งข้อความของฐานข้อมูลต่อให้หน้าจอตรง ๆ */
  if (/ออกบิลงวดที่/.test(message)) return message.slice(0, 120);
  const hit = /invoice_locked|receipt_locked|payment_locked|need_cancel_reason/.exec(message);
  if (hit) return hit[0];
  return message.split("\n")[0].slice(0, 80);
}

async function dealIdOf(no: string): Promise<string | null> {
  const sb = supabase();
  if (!sb) return null;
  const got = await sb.from("deals").select("id").eq("no", no).maybeSingle();
  return (got.data as { id?: string } | null)?.id ?? null;
}

async function invoiceIdOf(no: string): Promise<string | null> {
  const sb = supabase();
  if (!sb) return null;
  const got = await sb.from("invoices").select("id").eq("no", no).maybeSingle();
  return (got.data as { id?: string } | null)?.id ?? null;
}

/**
 * บันทึกแผนวางบิล — งวดที่ออกใบแจ้งหนี้ไปแล้วแตะไม่ได้ (ฐานข้อมูลกันการลบไว้ด้วย)
 * วิธีง่ายและตรงที่สุดคือลบงวดที่ยังไม่ออกใบทิ้ง แล้วใส่ชุดใหม่ลงไป
 */
/**
 * บันทึกแผนงวดเงินทั้งชุด — ผ่านฟังก์ชันของฐานข้อมูล (รอบที่ 112)
 *
 * เดิมลบงวดเก่าแล้วค่อยใส่ชุดใหม่เป็นสองคำขอแยกกัน ระหว่างนั้นแผนไม่ครบ
 * และไม่มีใครตรวจว่าผลรวมเท่ายอดดีล — หน้าจอกันไว้ชั้นเดียว
 * ฟังก์ชันของฐานข้อมูลทำทั้งชุดในคำสั่งเดียว ตรวจผลรวม เลขงวด และงวดที่ออกบิลไปแล้ว
 */
export async function sbSavePlan(dealNo: string, plan: Installment[]): Promise<AccWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const got = await sb.rpc("save_installments", {
    p_deal: dealNo,
    p_rows: plan.map((p) => ({ seq: p.seq, pct: p.pct, amount: p.amount, due: p.due || "" })),
  });
  if (got.error) return { ok: false, reason: why(got.error.message) };
  const out = got.data as { ok?: boolean; reason?: string } | null;
  if (!out?.ok) return { ok: false, reason: out?.reason ?? "unknown" };
  return { ok: true };
}

/** ออกใบแจ้งหนี้ของงวดหนึ่ง — เลขที่ออกจากฐานข้อมูล */
export async function sbIssueInvoice(input: {
  dealNo: string;
  seq: number;
  issue: string;
  due: string;
  base: number;
  vat: number;
  wht: number;
  total: number;
  outstanding: number;
}): Promise<AccWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const id = await dealIdOf(input.dealNo);
  if (!id) return { ok: false, reason: "not_found" };

  const got = await sb
    .from("invoices")
    .insert({
      deal_id: id,
      seq: input.seq,
      issue: input.issue,
      due: input.due || null,
      base: input.base,
      vat: input.vat,
      wht: input.wht,
      total: input.total,
      outstanding: input.outstanding,
      created_by: myId(),
    })
    .select("no")
    .single();
  if (got.error) return { ok: false, reason: why(got.error.message) };

  /* วันครบกำหนดของงวดนั้นเดินตามใบที่เพิ่งออก */
  await sb.from("deal_installments").update({ due: input.due || null }).eq("deal_id", id).eq("seq", input.seq);
  return { ok: true, no: (got.data as { no: string }).no };
}

/**
 * บันทึกรับชำระโดยไม่ออกใบเสร็จ (รอบที่ 118)
 *
 * งานบุคคลกับบุคคลไม่ออกใบเสร็จ แต่ต้องรู้ว่ารับเงินแล้ว
 * เขียนรายการรับชำระกับยอดค้างของใบแจ้งหนี้ ไม่แตะตารางใบเสร็จ
 */
export async function sbRecordPayment(input: {
  invoiceNo: string;
  date: string;
  received: number;
  wht: number;
  outstanding: number;
}): Promise<AccWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const id = await invoiceIdOf(input.invoiceNo);
  if (!id) return { ok: false, reason: "not_found" };

  const pay = await sb.from("payments").insert({
    invoice_id: id,
    on_date: input.date,
    received: input.received,
    wht: input.wht,
    cert_received: input.wht <= 0,
    created_by: myId(),
  });
  if (pay.error) return { ok: false, reason: why(pay.error.message) };

  const left = Math.max(0, input.outstanding);
  const up = await sb
    .from("invoices")
    .update({ outstanding: left, status: left > 0 ? "partial" : "paid" })
    .eq("id", id);
  if (up.error) return { ok: false, reason: why(up.error.message) };
  return { ok: true };
}

export async function sbLogCollection(invoiceNo: string, c: Collection): Promise<AccWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const id = await invoiceIdOf(invoiceNo);
  if (!id) return { ok: false, reason: "not_found" };
  const got = await sb.from("invoice_collections").insert({
    invoice_id: id,
    on_date: c.date,
    channel: c.channel,
    result: c.result,
    next_step: c.next,
    by_id: myId(),
  });
  if (got.error) return { ok: false, reason: why(got.error.message) };
  return { ok: true };
}

/** ออกใบเสร็จ = บันทึกรับชำระหนึ่งครั้ง แล้วอัปเดตยอดค้างของใบแจ้งหนี้ */
export async function sbIssueReceipt(input: {
  invoiceNo: string;
  date: string;
  received: number;
  wht: number;
  base: number;
  vatAmount: number;
  certReceived: boolean;
  vatDoc: boolean;
  outstanding: number;
}): Promise<AccWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const id = await invoiceIdOf(input.invoiceNo);
  if (!id) return { ok: false, reason: "not_found" };

  const pay = await sb
    .from("payments")
    .insert({
      invoice_id: id,
      on_date: input.date,
      received: input.received,
      wht: input.wht,
      cert_received: input.certReceived,
      created_by: myId(),
    })
    .select("id")
    .single();
  if (pay.error) return { ok: false, reason: why(pay.error.message) };

  const rc = await sb
    .from("receipts")
    .insert({
      invoice_id: id,
      payment_id: (pay.data as { id: string }).id,
      on_date: input.date,
      base: input.base,
      vat_amount: input.vatAmount,
      wht: input.wht,
      total: input.received,
      cert_received: input.certReceived,
      vat_doc: input.vatDoc,
      created_by: myId(),
    })
    .select("no")
    .single();
  if (rc.error) return { ok: false, reason: why(rc.error.message) };

  const up = await sb
    .from("invoices")
    .update({
      outstanding: input.outstanding,
      status: input.outstanding > 0 ? "partial" : "paid",
    })
    .eq("id", id);
  if (up.error) return { ok: false, reason: why(up.error.message) };
  return { ok: true, no: (rc.data as { no: string }).no };
}

/** ยกเลิกใบแจ้งหนี้ของดีลที่ถูกยกเลิก — ต้องบอกเหตุผลเสมอ */
export async function sbCancelInvoices(
  dealNo: string,
  c: { at: string; by: string; why: string; note?: string },
): Promise<AccWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const id = await dealIdOf(dealNo);
  if (!id) return { ok: false, reason: "not_found" };
  const got = await sb
    .from("invoices")
    .update({
      status: "cancelled",
      cancel_at: new Date().toISOString(),
      cancel_by: c.by,
      cancel_why: c.why,
      cancel_note: c.note ?? "",
    })
    .eq("deal_id", id)
    .in("status", ["pending", "partial"]);
  if (got.error) return { ok: false, reason: why(got.error.message) };
  return { ok: true };
}

/** ฝ่ายบัญชีเปิดดูดีลใหม่แล้ว — จุดแดงที่เมนูวางบิลหายไป */
export async function sbMarkDealsSeen(): Promise<AccWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const got = await sb.from("deals").update({ acc_seen: true }).eq("acc_seen", false);
  if (got.error) return { ok: false, reason: why(got.error.message) };
  return { ok: true };
}

export async function sbSaveWht(row: WhtRow): Promise<AccWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const data = {
    on_date: row.date,
    name: row.name,
    tax_id: row.tax,
    kind: row.kind,
    pay_type: row.type,
    base: row.base,
    rate: row.rate,
  };
  /* รหัสที่ขึ้นต้นด้วย W เป็นของเก่าที่หน้าจอสร้างเอง ยังไม่เคยอยู่ในฐานข้อมูล */
  const isDbId = /^[0-9a-f-]{36}$/.test(row.id);
  const got = isDbId
    ? await sb.from("wht_rows").update(data).eq("id", row.id)
    : await sb.from("wht_rows").insert({ ...data, created_by: myId() });
  if (got.error) return { ok: false, reason: why(got.error.message) };
  return { ok: true };
}

export async function sbRemoveWht(id: string): Promise<AccWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const got = await sb.from("wht_rows").delete().eq("id", id).select("id");
  if (got.error) return { ok: false, reason: why(got.error.message) };
  if (!got.data?.length) return { ok: false, reason: "denied" };
  return { ok: true };
}

/**
 * ออกหนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ)
 * ยังไม่มีเลข — ฐานข้อมูลออกเลขให้ · มีเลขแล้ว — แก้เนื้อหาได้แต่เลขเดิมคงไว้
 */
export async function sbIssueWht(row: WhtRow): Promise<{ ok: boolean; no?: string; reason?: string }> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return { ok: false, reason: "no_backend" };

  let no = row.no ?? "";
  if (!no) {
    const got = await sb.rpc("next_wht_no", { p_issued: row.issued ?? null });
    if (got.error || !got.data) return { ok: false, reason: why(got.error?.message ?? "no_number") };
    no = got.data as string;
  }

  const data = {
    on_date: row.date,
    name: row.name,
    tax_id: row.tax,
    kind: row.kind,
    payee_type: row.payeeType ?? (row.kind === "3" ? "individual" : "juristic"),
    pay_type: row.type,
    base: row.base,
    rate: row.rate,
    no,
    addr: row.addr ?? "",
    cond: row.cond ?? null,
    cond_note: row.condNote ?? "",
    issued: row.issued ?? null,
    gpf: row.gpf ?? 0,
    sso: row.sso ?? 0,
    pvd: row.pvd ?? 0,
  };
  const isDbId = /^[0-9a-f-]{36}$/.test(row.id);
  const res = isDbId
    ? await sb.from("wht_rows").update(data).eq("id", row.id)
    : await sb.from("wht_rows").insert({ ...data, created_by: myId() });
  if (res.error) return { ok: false, reason: why(res.error.message) };
  return { ok: true, no };
}
