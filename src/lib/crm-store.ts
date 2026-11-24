"use client";

import type { ServiceKey } from "./pm-data";
import { settings } from "./system-settings";
import { useSyncExternalStore } from "react";
import {
  ACTIVITIES,
  CHANGE_LOGS,
  CUSTOMERS,
  DEALS,
  SEED_CONTRACTS,
  JOB_ORDERS,
  PRESALES_REQUESTS,
  PRESALES_ROUNDS,
  QUOTATION_REVISIONS,
  QUOTATIONS,
  canBillQuotation,
  findParty,
  quotationTotals,
  type Activity,
  type BuyerType,
  type ChangeLog,
  type Customer,
  type CustomerStatus,
  type Deal,
  type DealCancel,
  type DealContract,
  issuerOf,
  type IssuerCode,
  type JobOrder,
  type PresalesRequest,
  type PresalesRound,
  type ProposalPlanPhase,
  type Quotation,
  type QuotationRevision,
  type Urgency,
} from "./crm-data";
import { addDays, bkkNow, nextDocNo, todayIso } from "./format";
import { firstLine } from "./rich-text";
import { CURRENT_USER } from "./mock-data";
import { createPersistedStore } from "./persisted-store";
import { hasBackend } from "./supabase/env";
import {
  EMPTY_PARTIES,
  EMPTY_PRESALES,
  fetchPresales,
  fetchSalesParties,
  sbAddLead,
  sbAddPresales,
  sbAddPresalesRound,
  sbEditPresales,
  sbLogActivity,
  sbMoveCustomer,
  sbRemoveLead,
  sbUpdateCustomer,
  EMPTY_DOCS,
  fetchSalesDocs,
  sbAcceptQuotation,
  sbAddQuotation,
  sbAttachContract,
  sbCancelDeal,
  sbMarkJobsDelivered,
  sbRejectQuotation,
  type SalesDocs,
  type SalesParties,
  type SalesPresales,
} from "./supabase/crm";

/*
 * งานขายทั้งสายอยู่ในสโตร์เดียว เพราะแต่ละขั้นส่งงานต่อกัน:
 * รับผู้สนใจ → ขอข้อเสนอ → ส่งใบเสนอราคา → ลูกค้ายอมรับ → เกิดดีลและใบงาน
 * ถ้าแยกสโตร์ จะเกิดสถานะที่ขัดกันเอง เช่น ดีลปิดแล้วแต่ลูกค้ายังเป็นผู้สนใจ
 */
export type CrmState = {
  customers: Customer[];
  activities: Activity[];
  changeLogs: ChangeLog[];
  presales: PresalesRequest[];
  presalesRounds: PresalesRound[];
  quotations: Quotation[];
  quotationRevisions: QuotationRevision[];
  deals: Deal[];
  jobOrders: JobOrder[];
};

const INITIAL: CrmState = {
  customers: CUSTOMERS,
  activities: ACTIVITIES,
  changeLogs: CHANGE_LOGS,
  presales: PRESALES_REQUESTS,
  presalesRounds: PRESALES_ROUNDS,
  quotations: QUOTATIONS,
  quotationRevisions: QUOTATION_REVISIONS,
  deals: DEALS,
  jobOrders: JOB_ORDERS,
};

/*
 * เติมฟิลด์ที่เพิ่มเข้ามาทีหลังให้ข้อมูลเก่าที่ค้างอยู่ในเครื่องผู้ใช้
 * ไม่เปลี่ยนคีย์ เพราะจะทิ้งผู้สนใจและใบเสนอราคาที่เขาสร้างไว้เองไปด้วย
 */
function migrateCrm(v: CrmState): CrmState {
  const typeOf = new Map(CUSTOMERS.map((c) => [c.code, c.type]));
  const customers = v.customers.map((c) =>
    c.type ? c : { ...c, type: typeOf.get(c.code) ?? ("juristic" as BuyerType) },
  );
  /* รหัสผู้สนใจเดิมเพิ่มเข้ามาทีหลัง (23 ก.ย. 2569) — ลูกค้าที่ปิดการขายไปก่อนหน้านี้ยังไม่มีช่องนี้
     เติมย้อนจากรหัสปัจจุบัน (CUS-6908-021 → LEAD-6908-021) ลิงก์เก่าจะได้เปิดได้ และลำดับไม่ถูกใช้ซ้ำ */
  const leadHead = settings().docs.lead + "-";
  const withLead = customers.map((c) =>
    c.leadCode || c.code.startsWith(leadHead)
      ? c
      : { ...c, leadCode: leadHead + c.code.replace(/^[A-Za-z]+-/, "") },
  );
  const buyerOf = new Map(withLead.map((c) => [c.code, c.type]));
  return {
    ...v,
    customers: withLead,
    quotations: v.quotations.map((q) =>
      q.buyer ? q : { ...q, buyer: buyerOf.get(q.customerCode) ?? ("juristic" as BuyerType) },
    ),
    presales: v.presales.map((p) => (p.attachments ? p : { ...p, attachments: [] })),
    /* รอบข้อเสนอตั้งต้นที่เพิ่มทีหลัง (PR7–PR9 · 22 ก.ย. 2569) — เติมเฉพาะที่ยังไม่มีทั้งรหัสและเลขรอบของคำขอนั้น
       ไม่ทับรอบที่ทีมก่อนการขายส่งเองในเครื่อง */
    presalesRounds: [
      ...v.presalesRounds,
      ...PRESALES_ROUNDS.filter(
        (s) =>
          !v.presalesRounds.some(
            (x) => x.id === s.id || (x.requestNo === s.requestNo && x.round === s.round),
          ),
      ),
    ],
    /* ของเก่ามีแต่การเปลี่ยนสถานะ ยังไม่มีการรับช่วงดูแล
       ต้องผ่าน Record ก่อน เพราะ ChangeLog เป็นยูเนียน กระจายตรง ๆ ไม่ได้ */
    changeLogs: v.changeLogs.map((l) =>
      l.kind
        ? l
        : ({ ...(l as Record<string, unknown>), kind: "status" } as unknown as ChangeLog),
    ),
    /* ตัวอย่างดีลที่ถูกยกเลิก (ครัวคุณจิ) เพิ่มเข้าชุดตั้งต้น 21 ก.ย. 2569 — เครื่องที่เก็บข้อมูลไว้ก่อนให้เห็นด้วย
       ใช้เฉพาะรายการตั้งต้นที่มีการยกเลิก และของในเครื่องยังเดินอยู่ ไม่ทับของที่ผู้ใช้ยกเลิกเอง */
    deals: v.deals.map((d) => {
      const seed = DEALS.find((x) => x.no === d.no && x.cancelled);
      const next =
        seed && d.status === "ปิดการขาย" && !d.cancelled
          ? { ...d, status: seed.status, lostReason: seed.lostReason, cancelled: seed.cancelled }
          : d;
      /* สัญญาตัวอย่างเพิ่มเข้าชุดตั้งต้น 22 ก.ย. 2569 — ดีลที่ยังไม่เคยมีช่องสัญญาเลยให้เห็นด้วย */
      return next.contracts || !SEED_CONTRACTS[d.no] ? next : { ...next, contracts: SEED_CONTRACTS[d.no] };
    }),
  };
}

const store = createPersistedStore<CrmState>(
  /* v4 (23 ก.ย. 2569) — ลูกค้าเพิ่มชื่อนิติบุคคล/ที่อยู่จดทะเบียน/สาขา และใบเสนอราคาเพิ่มอัตราหัก ณ ที่จ่าย
     ของเก่าไม่มีสามช่องนี้ ถ้าใช้ต่อจะออกใบกำกับภาษีไม่ได้ทั้งชุด จึงเริ่มจากชุดตั้งต้นใหม่
     v5 (28 ก.ย. 2569) — ลูกค้าตั้งต้นทั้ง 14 รายกรอกข้อมูลออกใบกำกับภาษีครบแล้ว (เจ้าของยืนยันว่าเป็นข้อมูลสมมติ)
     เครื่องที่ยังถือชุด v4 อยู่จะออกใบเสร็จของลูกค้าเก่าไม่ได้ จึงเปลี่ยนคีย์ให้เริ่มจากชุดใหม่ */
  "maz-erp.crm.v5",
  INITIAL,
  (v): v is CrmState =>
    typeof v === "object" && v !== null && Array.isArray((v as CrmState).customers),
  migrateCrm,
);

/* ─── สายผู้สนใจ/ลูกค้าจากฐานข้อมูล (รอบที่ 95–97) ────────────────────
 *
 * ต่อฐานข้อมูลแล้ว สามกองนี้ (ลูกค้า · บันทึกการติดต่อ · ประวัติ) อ่านจากฐานข้อมูลแทนเครื่อง
 * กองที่เหลือ (คำขอก่อนการขาย · ใบเสนอราคา · ดีล · ใบงาน) ยังอยู่ที่เครื่องจนกว่าจะต่อในรอบถัดไป
 *
 * ระหว่างยังโหลดไม่เสร็จให้เป็นกองว่างไว้ก่อน ไม่ใช่ข้อมูลตัวอย่างในเครื่อง
 * ไม่งั้นหน้าจอจะโชว์ลูกค้าสมมติแวบหนึ่งแล้วค่อยหายไป
 */
const live = hasBackend;
let parties: SalesParties | null = null;
let presalesData: SalesPresales | null = null;
let docsData: SalesDocs | null = null;
let loading = false;
const watchers = new Set<() => void>();

function tell() {
  for (const fn of watchers) fn();
}

function loadParties() {
  if (!live || loading || parties !== null) return;
  loading = true;
  void fetchSalesParties()
    .then(async (got) => {
      parties = got;
      /* คำขอก่อนการขายอ้างลูกค้าด้วย id ต้องมีตารางแปลง id → รหัส ก่อนจึงอ่านได้ */
      const codeById: Record<string, string> = {};
      for (const [code, id] of Object.entries(got.idByCode)) codeById[id] = code;
      presalesData = await fetchPresales(codeById);
      const psNoById: Record<string, string> = {};
      for (const [no, id] of Object.entries(presalesData.idByNo)) psNoById[id] = no;
      docsData = await fetchSalesDocs(codeById, psNoById);
    })
    .catch(() => {
      /* อ่านไม่ได้ — ให้เป็นกองว่าง ไม่ปล่อยเป็น null ไม่งั้นจะวนยิงใหม่ทุกครั้งที่ React อ่าน */
      parties = EMPTY_PARTIES;
      presalesData = EMPTY_PRESALES;
      docsData = EMPTY_DOCS;
    })
    .finally(() => {
      loading = false;
      tell();
    });
}

/** ขอข้อมูลใหม่หลังเขียน — ตัวเลขบนจอจะได้ตรงกับฐานข้อมูลเสมอ */
function refreshParties() {
  if (!live) return;
  parties = null;
  presalesData = null;
  docsData = null;
  loading = false;
  loadParties();
  tell();
}

/* useSyncExternalStore ต้องได้ snapshot ตัวเดิมเมื่อข้อมูลไม่เปลี่ยน ไม่งั้นวาดวนไม่หยุด */
let lastLocal: CrmState | null = null;
let lastParties: SalesParties | null = null;
let lastPresales: SalesPresales | null = null;
let lastDocs: SalesDocs | null = null;
let lastMerged: CrmState | null = null;

function snapshot(): CrmState {
  const local = store.get();
  if (!live) return local;
  loadParties();
  if (
    lastMerged &&
    lastLocal === local &&
    lastParties === parties &&
    lastPresales === presalesData &&
    lastDocs === docsData
  ) {
    return lastMerged;
  }
  lastLocal = local;
  lastParties = parties;
  lastPresales = presalesData;
  lastDocs = docsData;
  lastMerged = {
    ...local,
    customers: parties?.customers ?? [],
    activities: parties?.activities ?? [],
    changeLogs: parties?.changeLogs ?? [],
    presales: presalesData?.presales ?? [],
    presalesRounds: presalesData?.presalesRounds ?? [],
    quotations: docsData?.quotations ?? [],
    quotationRevisions: [],
    deals: docsData?.deals ?? [],
    jobOrders: docsData?.jobOrders ?? [],
  };
  return lastMerged;
}

function subscribeAll(onChange: () => void) {
  const off = store.subscribe(onChange);
  watchers.add(onChange);
  return () => {
    off();
    watchers.delete(onChange);
  };
}

export function useCrm() {
  return useSyncExternalStore(subscribeAll, snapshot, store.getServer);
}

export function resetCrm() {
  store.reset();
  refreshParties();
}

/** อ่านค่าปัจจุบันนอกคอมโพเนนต์ — ใช้ตอนส่งงานข้ามฝ่าย (ดู flow.ts) */
export function crmSnapshot() {
  return snapshot();
}

/**
 * ลูกค้าตัวจริงของดีลหนึ่ง — ฝั่งบัญชีเก็บไว้แค่ชื่อลูกค้า ต้องย้อนกลับมาหาที่นี่
 * ไล่จากดีลฝั่งขายก่อน ไม่เจอค่อยดูใบเสนอราคา แล้วค่อยเทียบด้วยชื่อเป็นทางสุดท้าย
 */
export function customerOfDeal(s: CrmState, dealNo: string, quotationNo: string, name: string) {
  const code =
    s.deals.find((d) => d.no === dealNo)?.customerCode ??
    s.quotations.find((q) => q.no === quotationNo)?.customerCode;
  return (
    (code ? findParty(s.customers, code) : undefined) ?? s.customers.find((c) => c.name === name)
  );
}

// ─── ตัวช่วยออกเลขเอกสาร ──────────────────────────────────────────
function today() {
  return todayIso();
}

/** เลขเอกสารเดินตามรอบปี พ.ศ. แยกตามชนิด — กันเลขซ้ำด้วยการดูของเดิมที่มากสุด */
/* ตัวนำหน้าตั้งได้ที่ /admin/doc-numbers — เปลี่ยนแล้วเลขลำดับเริ่มนับใหม่ของตัวนำหน้าใหม่ */
const nextNo = nextDocNo;

/**
 * รหัสผู้สนใจถัดไป — รูปแบบ LEAD-ปีเดือน-ลำดับ ตามที่ฝ่ายขายใช้กันอยู่
 *
 * ปีคริสต์สองหลัก (LEAD-6909-001 = ก.ย. 2026)
 * เคยบวก 543 เป็นปีพุทธ ได้ LEAD-6909-… ไม่ตรงกับรหัสเดิม และนับลำดับใหม่จาก 001 ซ้ำ
 *
 * เลขที่ออกไปแล้วถือว่าใช้ไปตลอด ลำดับเดินหน้าอย่างเดียว จึงนับทุกรหัสที่เคยออกในเดือนนั้น
 * ทั้งผู้สนใจที่ยังตามอยู่ · รายที่ถูกปฏิเสธ · และรายที่ปิดการขายไปแล้ว (หัวเปลี่ยนเป็น CUS- แต่เลขเดิม
 * และยังเก็บรหัสเดิมไว้ที่ leadCode) ถ้านับเฉพาะรหัสที่ขึ้นต้นด้วย LEAD- รายที่ปิดการขายจะคืนเลข
 * ให้รายใหม่ ลิงก์เก่าก็จะเปิดไปคนละบริษัท
 */
export function nextLeadCode(customers: Customer[]) {
  const d = bkkNow();
  /* ปีไทยสองหลัก + เดือน (เช่น 6909 = ก.ย. 2569) — ให้ตัวเลขปีอ่านตรงกับเลขเอกสารอื่นทั้งระบบ
     เดิมใช้ปี ค.ศ. สองหลัก (2609) ซึ่งคนอ่านเป็น "ปี 2609" (ผู้ใช้ทักท้วง 25 ก.ย. 2569) */
  const period = String(d.getFullYear() + 543).slice(-2) + String(d.getMonth() + 1).padStart(2, "0");
  /* หัวรหัสอะไรก็นับหมด (LEAD- / CUS- / ตัวนำหน้าที่ผู้ดูแลระบบเคยตั้งไว้) ขอแค่เดือนเดียวกัน */
  const used = new RegExp(`^[A-Za-z]+-${period}-(\\d+)$`);
  const max = customers
    .flatMap((c) => [c.code, c.leadCode ?? ""])
    .reduce((m, code) => {
      const hit = used.exec(code);
      return hit ? Math.max(m, Number(hit[1]) || 0) : m;
    }, 0);
  return `${settings().docs.lead}-${period}-${String(max + 1).padStart(3, "0")}`;
}

function newId(prefix: string) {
  return prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

/** เปลี่ยนสถานะลูกค้าพร้อมบันทึกประวัติ — ทุกที่ต้องผ่านนี่ จะได้มีร่องรอยเสมอ */
function moveCustomer(
  s: CrmState,
  code: string,
  to: CustomerStatus,
  reason: string,
): CrmState {
  const current = s.customers.find((c) => c.code === code);
  if (!current || current.status === to) return s;
  const log: ChangeLog = {
    id: newId("CL"),
    kind: "status",
    at: today(),
    customerCode: code,
    from: current.status,
    to,
    reason,
    by: CURRENT_USER.name,
  };
  return {
    ...s,
    customers: s.customers.map((c) =>
      c.code === code
        ? { ...c, status: to, closedReason: to === "ปฏิเสธ" ? reason : "" }
        : c,
    ),
    changeLogs: [log, ...s.changeLogs],
  };
}

/**
 * รับช่วงดูแลผู้สนใจที่เป็นของคนอื่น — ผู้ที่กดกลายเป็นเจ้าของรายการนี้แทน
 *
 * เกิดตอนคนเดิมลาออก ย้ายทีม หรือลายาว งานที่ค้างต้องมีคนรับต่อ ไม่งั้นลูกค้าหลุด
 * บันทึกลงประวัติเดียวกับการเปลี่ยนสถานะ จะได้เห็นเรียงตามเวลาในที่เดียว
 */
export async function takeOverLead(code: string, reason: string) {
  if (live) {
    const now = snapshot().customers.find((c) => c.code === code);
    if (!now || now.owner === CURRENT_USER.name) return;
    await sbMoveCustomer({ code, kind: "owner", from: now.owner, to: CURRENT_USER.name, reason });
    refreshParties();
    return;
  }
  store.update((s) => {
    const current = s.customers.find((c) => c.code === code);
    if (!current || current.owner === CURRENT_USER.name) return s;
    const log: ChangeLog = {
      id: newId("CL"),
      kind: "owner",
      at: today(),
      customerCode: code,
      from: current.owner,
      to: CURRENT_USER.name,
      reason,
      by: CURRENT_USER.name,
    };
    return {
      ...s,
      customers: s.customers.map((c) =>
        c.code === code ? { ...c, owner: CURRENT_USER.name } : c,
      ),
      changeLogs: [log, ...s.changeLogs],
    };
  });
}

// ─── ผู้สนใจ ──────────────────────────────────────────────────────
export async function addLead(input: {
  name: string;
  contact: string;
  phone: string;
  email: string;
  address: string;
  source: string;
  taxId: string;
  type: BuyerType;
  legalName: string;
  branch: string;
  activity: {
    date: string;
    channel: string;
    summary: string;
    nextAction: string;
    followUp: string;
  };
}) {
  if (live) {
    /* รหัสผู้สนใจออกจากฐานข้อมูล ไม่ใช่จากเบราว์เซอร์ — สองเครื่องกดพร้อมกันจะได้ไม่ซ้ำ */
    const made = await sbAddLead({
      name: input.name,
      contact: input.contact,
      phone: input.phone,
      email: input.email,
      address: input.address,
      source: input.source,
      taxId: input.taxId,
      type: input.type,
      legalName: input.type === "juristic" ? input.legalName : "",
      branch: input.type === "juristic" ? input.branch : "",
      owner: CURRENT_USER.name,
    });
    if (made.ok && made.code) await sbLogActivity({ code: made.code, ...input.activity });
    refreshParties();
    return made.ok && made.code ? made.code : "";
  }
  let code = "";
  store.update((s) => {
    code = nextLeadCode(s.customers);
    const customer: Customer = {
      code,
      name: input.name,
      contact: input.contact,
      phone: input.phone,
      email: input.email,
      address: input.address,
      source: input.source,
      taxId: input.taxId,
      /* นิติบุคคลต้องมีชื่อตามหนังสือรับรองกับสำนักงานใหญ่/สาขา ไม่งั้นบัญชีออกใบกำกับภาษีไม่ได้ */
      type: input.type,
      legalName: input.type === "juristic" ? input.legalName : "",
      branch: input.type === "juristic" ? input.branch : "",
      status: "รอนัดหมาย",
      closedReason: "",
      owner: CURRENT_USER.name,
    };
    const activity: Activity = {
      id: newId("AC"),
      customerCode: code,
      ...input.activity,
    };
    return {
      ...s,
      customers: [customer, ...s.customers],
      activities: [activity, ...s.activities],
    };
  });
  return code;
}

export async function logActivity(input: {
  customerCode: string;
  date: string;
  channel: string;
  summary: string;
  nextAction: string;
  followUp: string;
}) {
  if (live) {
    await sbLogActivity({ code: input.customerCode, ...input });
    refreshParties();
    return;
  }
  store.update((s) => ({
    ...s,
    activities: [{ id: newId("AC"), ...input }, ...s.activities],
  }));
}

/* ต่อฐานข้อมูลแล้วเปลี่ยนสถานะที่เดียว แล้วลงประวัติในคำสั่งเดียวกัน (sbMoveCustomer) */
async function moveLead(code: string, to: CustomerStatus, reason: string) {
  const now = snapshot().customers.find((c) => c.code === code);
  if (!now || now.status === to) return;
  await sbMoveCustomer({ code, kind: "status", from: now.status, to, reason });
  refreshParties();
}

export async function closeLead(code: string, reason: string) {
  if (live) return moveLead(code, "ปฏิเสธ", reason);
  store.update((s) => moveCustomer(s, code, "ปฏิเสธ", reason));
}

export async function reopenLead(code: string) {
  if (live) return moveLead(code, "รอนัดหมาย", "เปิดรับพิจารณาใหม่");
  store.update((s) => moveCustomer(s, code, "รอนัดหมาย", "เปิดรับพิจารณาใหม่"));
}

/** เปลี่ยนเป็นปิดงานเองจากดรอปดาวน์สถานะ — ปกติเกิดเองเมื่อลูกค้าตอบรับใบเสนอราคา */
export async function markLeadWon(code: string, reason: string) {
  if (live) return moveLead(code, "ปิดงาน", reason);
  store.update((s) => moveCustomer(s, code, "ปิดงาน", reason));
}

// ─── คำขอก่อนการขาย ───────────────────────────────────────────────
export async function addPresalesRequest(input: {
  customerCode: string;
  kind: "BD" | "SA";
  problem: string;
  due: string;
  urgency: Urgency;
  urgentReason: string;
  budget: number;
  attachments: string[];
}) {
  /* ผู้รับผิดชอบตั้งต้นตามคิวของแต่ละประเภท (ต้นแบบ presales.html) */
  const firstAssignee = input.kind === "SA" ? "ปิยะวัฒน์ (SA)" : "ธนดล (BD)";
  if (live) {
    /* เลขที่คำขอออกจากฐานข้อมูล ไม่ใช่จากเบราว์เซอร์ */
    const made = await sbAddPresales({
      customerCode: input.customerCode,
      kind: input.kind,
      problem: input.problem,
      assignee: firstAssignee,
      due: input.due,
      urgency: input.urgency,
      urgentReason: input.urgentReason,
      budget: input.budget,
    });
    refreshParties();
    return made.ok && made.code ? made.code : "";
  }
  let no = "";
  store.update((s) => {
    no = nextNo(settings().docs.presales, s.presales.map((p) => p.no));
    const request: PresalesRequest = {
      id: newId("PS"),
      no,
      customerCode: input.customerCode,
      kind: input.kind,
      problem: input.problem,
      /* ผู้รับผิดชอบตั้งต้นตามคิวของแต่ละประเภท (ต้นแบบ presales.html) — คนที่กดรับงานจะถูกบันทึกแทน */
      assignee: input.kind === "SA" ? "ปิยะวัฒน์ (SA)" : "ธนดล (BD)",
      due: input.due,
      urgency: input.urgency,
      urgentReason: input.urgentReason,
      budget: input.budget,
      attachments: input.attachments,
      status: "รอรับงาน",
      createdAt: today(),
      hours: 0,
    };
    return { ...s, presales: [request, ...s.presales] };
  });
  return no;
}

/*
 * ฝั่งผู้รับคำขอ — ทีมก่อนการขาย (บทบาท ps หน้า /presales-work)
 *   รอรับงาน → รับงาน → กำลังทำ → ส่งข้อเสนอ → ส่งกลับแล้ว (ฝ่ายขายออกใบเสนอราคาต่อ)
 *                        ↘ ขอข้อมูลเพิ่ม → รอข้อมูลเพิ่ม → ฝ่ายขายตอบ → กำลังทำ
 */
function editPresales(no: string, fn: (p: PresalesRequest) => PresalesRequest) {
  store.update((s) => ({ ...s, presales: s.presales.map((p) => (p.no === no ? fn(p) : p)) }));
}

/** รับงาน — by = ชื่อในคิวของคนที่กดรับ (เช่น "ปิยะวัฒน์ (SA)") ไม่ส่งมาคงผู้รับผิดชอบเดิม */
export async function acceptPresales(no: string, by?: string) {
  if (live) {
    const now = snapshot().presales.find((p) => p.no === no);
    if (!now || now.status !== "รอรับงาน") return;
    await sbEditPresales(no, { status: "กำลังทำ", ...(by ? { assignee: by } : {}) });
    refreshParties();
    return;
  }
  editPresales(no, (p) =>
    p.status === "รอรับงาน" ? { ...p, status: "กำลังทำ", ...(by ? { assignee: by } : {}) } : p,
  );
}

export async function askPresalesInfo(no: string, ask: string) {
  if (live) {
    const now = snapshot().presales.find((p) => p.no === no);
    const can = now && ["กำลังทำ", "รอรับงาน", "รอข้อมูลเพิ่ม"].includes(now.status);
    if (!can) return;
    await sbEditPresales(no, { status: "รอข้อมูลเพิ่ม", ask });
    refreshParties();
    return;
  }
  editPresales(no, (p) =>
    p.status === "กำลังทำ" || p.status === "รอรับงาน" || p.status === "รอข้อมูลเพิ่ม"
      ? { ...p, status: "รอข้อมูลเพิ่ม", ask }
      : p,
  );
}

/** ฝ่ายขายตอบข้อมูลที่ขอ — งานกลับไปที่ผู้รับคำขอ */
export async function replyPresalesInfo(no: string, reply: string) {
  if (live) {
    const now = snapshot().presales.find((p) => p.no === no);
    if (!now || now.status !== "รอข้อมูลเพิ่ม") return;
    await sbEditPresales(no, { status: "กำลังทำ", reply });
    refreshParties();
    return;
  }
  editPresales(no, (p) => (p.status === "รอข้อมูลเพิ่ม" ? { ...p, status: "กำลังทำ", reply } : p));
}

/**
 * ส่งข้อเสนอกลับ — เป็นรอบใหม่ต่อจากรอบเดิมเสมอ ไม่ทับรอบก่อน
 * ชั่วโมงของรอบนี้บวกเข้าชั่วโมงรวมของคำขอ · ส่งได้ระหว่างรอข้อมูลเพิ่มด้วย (ต้นแบบ presales-work.html)
 */
export async function submitPresalesRound(
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
) {
  if (live) {
    const now = snapshot().presales.find((p) => p.no === no);
    const can = now && ["กำลังทำ", "รอข้อมูลเพิ่ม", "ส่งกลับแล้ว"].includes(now.status);
    if (!can) return;
    await sbAddPresalesRound(no, input);
    refreshParties();
    return;
  }
  store.update((s) => {
    const req = s.presales.find((p) => p.no === no);
    if (!req || (req.status !== "กำลังทำ" && req.status !== "รอข้อมูลเพิ่ม" && req.status !== "ส่งกลับแล้ว")) return s;
    const round = s.presalesRounds.filter((r) => r.requestNo === no).reduce((m, r) => Math.max(m, r.round), 0) + 1;
    const r: PresalesRound = { id: newId("PR"), requestNo: no, round, at: today(), ...input };
    return {
      ...s,
      presalesRounds: [r, ...s.presalesRounds],
      presales: s.presales.map((p) =>
        p.no === no ? { ...p, status: "ส่งกลับแล้ว" as const, hours: (p.hours ?? 0) + input.hours } : p,
      ),
    };
  });
}

export async function closePresales(no: string) {
  if (live) {
    await sbEditPresales(no, { status: "ปิดคำขอ" });
    refreshParties();
    return;
  }
  store.update((s) => ({
    ...s,
    presales: s.presales.map((p) =>
      p.no === no ? { ...p, status: "ปิดคำขอ" as const } : p,
    ),
  }));
}

// ─── ใบเสนอราคา ───────────────────────────────────────────────────
/*
 * วงจรตามต้นแบบ quotations.html — ใบเสนอราคาไม่มีช่องสถานะให้กดเปลี่ยน ระบบอนุมานจากข้อมูลเอง
 *   บันทึก = ออกเลขที่เอกสารทันทีและนับว่าส่งให้ลูกค้าแล้ว (ไม่มีขั้นร่าง · เจ้าของแจ้ง 5 ต.ค. 2569)
 *   → ลูกค้าตกลง = "ส่งไปวางบิล" (เกิดดีล) · ลูกค้าไม่เอา = "ลูกค้าปฏิเสธ" พร้อมเหตุผล
 *   แก้ใบเดิมไม่ได้เลย ต้อง "ออกใบใหม่แทนใบนี้" เลขใหม่ ใบเดิมเป็น "แทนที่แล้ว" และจำว่าถูกแทนด้วยใบไหน (replacedBy)
 * ลำดับเลขเดินหน้าอย่างเดียว ไม่มีเลขข้ามและไม่นำกลับมาใช้ซ้ำ
 */
export type QuotationInput = {
  customerCode: string;
  issuer: IssuerCode;
  buyer: BuyerType;
  service: ServiceKey;
  validDays: number;
  amount: number;
  discount: number;
  wht: boolean;
  body: string;
  terms: string;
  /** อ้างอิงคำขอก่อนการขาย — เอกสารของคำขอจะตามไปถึง PM */
  ps?: string;
  /** ออกแทนใบเดิม — ใบเดิมจะถูกบันทึกว่าออกใบใหม่แทนแล้ว */
  replaces?: string;
};

/**
 * บันทึกใบเสนอราคาใหม่ — ออกเลขที่เอกสารทันทีและนับว่าส่งให้ลูกค้าแล้ว (วันยืนราคาเริ่มนับวันนี้)
 * ออกแทนใบเดิมได้ ใบเดิมจะกลายเป็น "แทนที่แล้ว" · คืนเลขที่ที่ออก
 */
export async function addQuotation(input: QuotationInput) {
  if (live) {
    const issuer = issuerOf(input.issuer);
    const issued = today();
    const made = await sbAddQuotation({
      customerCode: input.customerCode,
      issuer: input.issuer,
      /* คำนำหน้าเลขใบแยกตามผู้ออกเอกสาร — ตัวนับของฐานข้อมูลจึงเดินคนละชุด */
      prefixKey: issuer.prefix === settings().docs.quotationB1 ? "quotationB1" : "quotationMaz",
      prefix: issuer.prefix,
      buyer: input.buyer,
      service: input.service,
      issued,
      validDays: input.validDays,
      validUntil: addDays(issued, input.validDays),
      amount: input.amount,
      discount: input.discount,
      wht: input.wht,
      body: input.body,
      terms: input.terms,
      psNo: input.ps,
      replaces: input.replaces,
    });
    refreshParties();
    return made.ok && made.code ? made.code : "";
  }
  let no = "";
  store.update((s) => {
    /* ตัวนำหน้าเลขใบเสนอราคาแยกตามผู้ออกเอกสาร (/admin/company) */
    no = nextNo(issuerOf(input.issuer).prefix, s.quotations.map((q) => q.no));
    const issued = today();
    const { replaces, ps, ...rest } = input;
    const old = replaces ? s.quotations.find((q) => q.no === replaces && !q.replacedBy) : undefined;
    const quotation: Quotation = {
      id: newId("Q"),
      no,
      ...rest,
      issued,
      validUntil: addDays(issued, input.validDays),
      status: "ส่งแล้ว",
      revision: 1,
      createdAt: issued,
      /* ออกเลขแล้วถือว่าส่งให้ลูกค้าเลย ไม่มีขั้น "บันทึกว่าส่งแล้ว" อีก */
      sentAt: issued,
      ...(ps ? { ps } : {}),
      ...(old ? { replaces: old.no } : {}),
    };
    return {
      ...s,
      quotations: [
        quotation,
        ...s.quotations.map((q) =>
          old && q.id === old.id ? { ...q, replacedBy: no, status: "แทนที่แล้ว" as const } : q,
        ),
      ],
    };
  });
  return no;
}

/** ผู้สนใจที่ปิดการขายได้กลายเป็นลูกค้า — รหัส LEAD- เปลี่ยนเป็น CUS- ทุกที่ที่อ้างถึงในสายงานขาย */
function renameCustomer(s: CrmState, from: string, to: string): CrmState {
  if (from === to || s.customers.some((c) => c.code === to)) return s;
  const fix = <T extends { customerCode: string }>(x: T): T =>
    x.customerCode === from ? { ...x, customerCode: to } : x;
  return {
    ...s,
    /* เก็บรหัสผู้สนใจเดิมไว้ด้วย — ลำดับจะได้ไม่ถูกนำกลับมาใช้ซ้ำ และลิงก์เก่ายังเปิดไปถูกราย */
    customers: s.customers.map((c) =>
      c.code === from ? { ...c, code: to, leadCode: c.leadCode ?? from } : c,
    ),
    activities: s.activities.map(fix),
    changeLogs: s.changeLogs.map((l) => (l.customerCode === from ? ({ ...l, customerCode: to } as ChangeLog) : l)),
    presales: s.presales.map(fix),
    quotations: s.quotations.map(fix),
    deals: s.deals.map(fix),
  };
}

/** รหัสลูกค้าของผู้สนใจรายนี้เมื่อปิดการขายได้ — LEAD-6908-030 → CUS-6908-030 */
export function customerCodeOf(code: string) {
  const head = settings().docs.lead + "-";
  return code.startsWith(head) ? "CUS-" + code.slice(head.length) : code;
}

/**
 * ส่งใบเสนอราคาไปวางบิล = ลูกค้าตกลง → เกิดดีลปิดการขายและใบงานตั้งต้นทันที
 * ผู้สนใจกลายเป็นลูกค้า (เปลี่ยนรหัสเป็น CUS-) · เรียกผ่าน acceptQuotationFlow (flow.ts) เท่านั้น
 */
export async function acceptQuotation(id: string) {
  if (live) {
    /* ตอบรับแล้วต้องเปลี่ยนสี่ตารางพร้อมกัน จึงให้ฐานข้อมูลทำทั้งชุดในคำสั่งเดียว (รอบที่ 98) */
    const q = snapshot().quotations.find((x) => x.id === id);
    if (!q) return "";
    const got = await sbAcceptQuotation({
      no: q.no,
      scope: firstLine(q.body),
      delivery: addDays(today(), 45),
      jobOwner: "ศิริกร (AE)",
    });
    refreshParties();
    return got.ok && got.deal ? got.deal : "";
  }
  /* คืนเลขที่ดีลที่เพิ่งเกิด เพื่อให้ชั้นส่งงานข้ามฝ่ายหยิบไปเปิดงานฝั่งบัญชีต่อได้ */
  let created = "";
  store.update((s0) => {
    const q0 = s0.quotations.find((x) => x.id === id);
    if (!q0 || !canBillQuotation(q0, s0.deals.some((d) => d.quotationNo === q0.no), today())) return s0;

    const s = renameCustomer(s0, q0.customerCode, customerCodeOf(q0.customerCode));
    const q = s.quotations.find((x) => x.id === id)!;
    const dealNo = nextNo(settings().docs.deal, s.deals.map((d) => d.no));
    created = dealNo;
    const scope = firstLine(q.body);
    const delivery = addDays(today(), 45);
    const deal: Deal = {
      id: newId("D"),
      no: dealNo,
      customerCode: q.customerCode,
      quotationNo: q.no,
      total: quotationTotals(q).grand,
      status: "ปิดการขาย",
      poRef: "",
      start: today(),
      delivery,
      scope,
      closedAt: today(),
      lostReason: "",
      seller: s.customers.find((c) => c.code === q.customerCode)?.owner,
    };
    const job: JobOrder = {
      id: newId("J"),
      dealNo,
      no: nextNo(settings().docs.jobOrder, s.jobOrders.map((j) => j.no)),
      owner: "ศิริกร (AE)",
      item: scope,
      due: delivery,
      status: "สร้างแล้ว",
    };

    const next: CrmState = {
      ...s,
      quotations: s.quotations.map((x) =>
        x.id === id ? { ...x, status: "ตอบรับ" as const } : x,
      ),
      deals: [deal, ...s.deals],
      jobOrders: [job, ...s.jobOrders],
    };
    return moveCustomer(next, q.customerCode, "ปิดงาน", "ปิดการขายจากใบเสนอราคา " + q.no);
  });
  return created;
}

/**
 * ยกเลิกดีลหลังปิดการขาย — เรียกผ่าน cancelDealFlow (flow.ts) เท่านั้น
 * ฝ่ายบัญชีกับ PM ต้องหยุดตามไปด้วย ถ้าเรียกตรงจะเหลือใบแจ้งหนี้และโปรเจคค้างอยู่
 */
/** ฝ่ายขายแนบสัญญาเข้าดีล — แนบเพิ่มได้ตลอด ไม่มีการลบ */
export async function attachContract(dealNo: string, c: DealContract) {
  if (live) {
    await sbAttachContract(dealNo, c);
    refreshParties();
    return;
  }
  store.update((s) => ({
    ...s,
    deals: s.deals.map((d) => (d.no === dealNo ? { ...d, contracts: [...(d.contracts ?? []), c] } : d)),
  }));
}

export async function cancelDeal(no: string, c: DealCancel) {
  if (live) {
    await sbCancelDeal(no, c.why, c.by);
    refreshParties();
    return;
  }
  store.update((s) => {
    const deal = s.deals.find((d) => d.no === no && d.status === "ปิดการขาย");
    if (!deal) return s;
    const next: CrmState = {
      ...s,
      deals: s.deals.map((d) =>
        d.no === no ? { ...d, status: "ยกเลิก" as const, lostReason: c.why, cancelled: c } : d,
      ),
    };
    /*
     * สถานะลูกค้าต้องมาจากดีลจริง ไม่ใช่ค้างค่าเดิมไว้ (เจ้าของสั่ง 24 ก.ย. 2569)
     * ลูกค้าที่ดีลถูกยกเลิกและไม่มีดีลอื่นที่ยังเดินอยู่ ต้องไม่ขึ้นว่า "ปิดงาน"
     * ไม่งั้นฝ่ายขายเลิกตามงานต่อ และรายงานนับยอดปิดเกินจริง
     * ย้ายกลับเป็น "รอนัดหมาย" เพราะลูกค้ายังอยู่ แค่งานนี้ไม่ได้ไปต่อ — ไม่ใช่ "ปฏิเสธ"
     */
    const live = next.deals.some(
      (d) => d.customerCode === deal.customerCode && d.status === "ปิดการขาย",
    );
    return live
      ? next
      : moveCustomer(next, deal.customerCode, "รอนัดหมาย", `ดีล ${no} ถูกยกเลิก · ${c.why}`);
  });
}

/**
 * งานฝั่ง PM ส่งมอบครบแล้ว — ปิดใบงานของดีลนั้นทั้งหมด
 * ฝ่ายขายจะได้เห็นว่างานที่ตัวเองปิดการขายไว้เดินไปถึงไหนโดยไม่ต้องไปถาม PM
 */
export async function markJobsDelivered(dealNo: string) {
  if (live) {
    await sbMarkJobsDelivered(dealNo);
    refreshParties();
    return;
  }
  store.update((s) => ({
    ...s,
    jobOrders: s.jobOrders.map((j) =>
      j.dealNo === dealNo ? { ...j, status: "ส่งมอบ" as const } : j,
    ),
  }));
}

/**
 * ลูกค้าปฏิเสธ — บันทึกวันที่และเหตุผล (ต้นแบบ quotations.html) ไม่เกิดดีล
 * เหตุผลไปขึ้นในรายงาน "เหตุผลที่ไม่ตกลง" คู่กับดีลที่ถูกยกเลิก
 */
export async function rejectQuotation(id: string, reason: string) {
  if (live) {
    const q = snapshot().quotations.find((x) => x.id === id);
    if (!q) return;
    await sbRejectQuotation(q.no, reason);
    refreshParties();
    return;
  }
  store.update((s) => {
    const q = s.quotations.find((x) => x.id === id);
    if (!q || !canBillQuotation(q, s.deals.some((d) => d.quotationNo === q.no), today())) return s;
    return {
      ...s,
      quotations: s.quotations.map((x) =>
        x.id === id
          ? { ...x, status: "ปฏิเสธ" as const, rejectedAt: today(), rejectReason: reason }
          : x,
      ),
    };
  });
}

/** แก้ข้อมูลติดต่อในการ์ดโปรไฟล์ — แก้ได้เฉพาะช่องข้อมูล ไม่แตะสถานะ */
/*
 * ลบผู้สนใจที่กรอกผิด — ลบได้เฉพาะรายที่ยังไม่มีอะไรผูกอยู่
 * ถ้ามีคำขอก่อนการขาย ใบเสนอราคา ดีล หรือใบงานแล้ว ลบไม่ได้ เพราะเอกสารพวกนั้นอ้างชื่อลูกค้าอยู่
 * ลบไปยอดในแดชบอร์ดกับรายงานจะเพี้ยน ให้เปลี่ยนสถานะเป็นปฏิเสธหรือปิดงานแทน
 */
export function leadDeleteBlock(s: CrmState, code: string) {
  const c = s.customers.find((x) => x.code === code);
  const codes = [code, c?.leadCode ?? ""].filter(Boolean);
  const hit = (v: string) => codes.includes(v);
  if (s.presales.some((r) => hit(r.customerCode))) return "มีคำขอก่อนการขายของลูกค้ารายนี้แล้ว";
  if (s.quotations.some((q) => hit(q.customerCode))) return "มีใบเสนอราคาของลูกค้ารายนี้แล้ว";
  /* ใบงานผูกกับดีล ไม่ได้ผูกกับลูกค้าตรง ๆ เช็คที่ดีลก็ครอบคลุมแล้ว */
  if (s.deals.some((d) => hit(d.customerCode))) return "มีดีลของลูกค้ารายนี้แล้ว";
  return "";
}

/** ลบผู้สนใจพร้อมบันทึกการติดต่อและประวัติการเปลี่ยนแปลงของรายนั้น — คืน true เมื่อลบจริง */
export async function removeLead(code: string) {
  if (live) {
    if (leadDeleteBlock(snapshot(), code)) return false;
    const got = await sbRemoveLead(code);
    refreshParties();
    return got.ok;
  }
  let done = false;
  store.update((s) => {
    if (leadDeleteBlock(s, code)) return s;
    if (!s.customers.some((c) => c.code === code)) return s;
    done = true;
    return {
      ...s,
      customers: s.customers.filter((c) => c.code !== code),
      activities: s.activities.filter((a) => a.customerCode !== code),
      changeLogs: s.changeLogs.filter((l) => l.customerCode !== code),
    };
  });
  return done;
}

/*
 * บันทึกแผนงานของข้อเสนอ (Full Proposal · M2) — แก้ได้ตราบที่คำขอยังไม่เกิดดีล
 * เรียงตามสัปดาห์เริ่มให้เสมอ จะได้อ่านไล่ลำดับได้ และกันช่วงสัปดาห์กลับหัว
 */
export async function savePresalesPlan(no: string, plan: ProposalPlanPhase[]) {
  const clean = plan
    .filter((p) => p.name.trim())
    .map((p) => ({
      ...p,
      name: p.name.trim(),
      fromWeek: Math.max(1, Math.round(p.fromWeek)),
      toWeek: Math.max(Math.max(1, Math.round(p.fromWeek)), Math.round(p.toWeek)),
      tasks: p.tasks.map((t) => t.trim()).filter(Boolean),
    }))
    .sort((a, b) => a.fromWeek - b.fromWeek || a.toWeek - b.toWeek);
  if (live) {
    await sbEditPresales(no, { plan: clean });
    refreshParties();
    return;
  }
  store.update((s) => ({
    ...s,
    presales: s.presales.map((r) => (r.no === no ? { ...r, plan: clean } : r)),
  }));
}

export async function updateCustomer(
  code: string,
  patch: Partial<
    Pick<
      Customer,
      | "contact" | "phone" | "email" | "source" | "taxId" | "address"
      | "legalName" | "legalAddress" | "branch"
    >
  >,
) {
  if (live) {
    await sbUpdateCustomer(code, patch);
    refreshParties();
    return;
  }
  store.update((s) => ({
    ...s,
    customers: s.customers.map((c) => (c.code === code ? { ...c, ...patch } : c)),
  }));
}
