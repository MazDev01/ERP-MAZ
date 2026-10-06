"use client";

/*
 * บทบาทของคนที่ล็อกอินอยู่ — เลือกตอนเข้าสู่ระบบ แล้วทั้งแอปเปลี่ยนตาม
 *
 * ตอนนี้มีเก้าบทบาท: พนักงานขาย · ทีมก่อนการขาย (SA/BD) · ผู้จัดการโครงการ (PM) · พนักงานบัญชี · ฝ่ายบุคคล · ทีมงาน · GM · ผู้บริหาร (CEO) · ผู้ดูแลระบบ
 * ทุกบทบาทใช้กลุ่มเมนู "ของฉัน" ชุดเดียวกัน ต่างกันแค่กลุ่มงานของตัวเอง
 * หนึ่งบทบาทคือหนึ่งคน ข้อมูลส่วนตัวจึงแยกเก็บตามบทบาท (ดู role-store.ts)
 *
 * ยังไม่มี backend — เมื่อต่อ auth จริงแล้ว บทบาทต้องมาจากเซิร์ฟเวอร์
 * ไม่ใช่จาก localStorage ที่ผู้ใช้แก้เองได้
 */

import { useSyncExternalStore } from "react";
import { createPersistedStore } from "./persisted-store";
import { settings } from "./system-settings";
import { HR_EMP, ROLE_EMPLOYEE } from "./hr-data";

/*
 * บริษัทไม่มีผู้ดูแลระบบแยก ฝ่ายบุคคลดูแลการตั้งค่าทั้งหมด (Full Proposal · M5)
 * บทบาท admin จึงถูกถอดออกเมื่อ 28 ก.ย. 2569 — หน้าตั้งค่าย้ายไปอยู่ในเมนูของฝ่ายบุคคล
 */
/* intern = นักศึกษาฝึกงาน · maid = แม่บ้าน (ยกมาจากระบบต้นฉบับ 6 ต.ค. 2569)
   สองบทบาทนี้มีบัญชีเข้าระบบ แต่ใช้ได้เฉพาะเมนูของตัวเอง และคำขอขึ้นฝ่ายบุคคล/GM */
export type Role = "sales" | "ps" | "pm" | "acc" | "hr" | "staff" | "gm" | "ceo" | "intern" | "maid";

/*
 * en ใช้เฉพาะการ์ดเลือกบทบาทในหน้าเข้าสู่ระบบ — ที่อื่นในระบบยังใช้ชื่อภาษาไทย (label)
 * short = ชื่อฝ่ายสั้น ๆ ใช้ตอนคนเดียวทำสองฝ่าย จะได้เขียนรวบเป็น "บัญชีและบุคคล"
 */
export const ROLES: { key: Role; label: string; short: string; note: string; en: string }[] = [
  { key: "sales", label: "พนักงานขาย", short: "ขาย", note: "ดูแลผู้สนใจ ใบเสนอราคา และดีล",
    en: "Sales" },
  /* ทีมก่อนการขาย (SA/BD) — รับคำขอก่อนการขายจากฝ่ายขาย ทำข้อเสนอแล้วส่งกลับ (ต้นแบบ presales-work.html) */
  { key: "ps", label: "ทีมก่อนการขาย", short: "ก่อนการขาย", note: "รับคำขอจากฝ่ายขาย จัดทำข้อเสนอแล้วส่งกลับ",
    en: "Presales (SA/BD)" },
  { key: "pm", label: "ผู้จัดการโครงการ", short: "โปรเจค", note: "รับใบงานแล้วมอบหมายให้ทีม",
    en: "Project Manager" },
  { key: "acc", label: "พนักงานบัญชี", short: "บัญชี", note: "วางบิล ติดตามหนี้ ออกใบเสร็จ และยื่นภาษี",
    en: "Accountant" },
  { key: "hr", label: "ฝ่ายบุคคล", short: "บุคคล", note: "ดูแลข้อมูลพนักงาน เวลาทำงาน และเงินเดือน",
    en: "Human Resources" },
  { key: "staff", label: "ทีมงาน", short: "ทีมงาน", note: "รับงานจาก PM ลงมือทำ แล้วส่งผลงานให้ตรวจ",
    en: "Team Member" },
  { key: "gm", label: "ผู้จัดการทั่วไป (GM)", short: "ผู้จัดการทั่วไป", note: "อนุมัติใบลาของพนักงานทั่วไป",
    en: "General Manager" },
  { key: "ceo", label: "ผู้บริหาร", short: "ผู้บริหาร", note: "อนุมัติคำขอที่ขึ้นถึงผู้บริหาร และอนุมัติยอดเงินเดือน",
    en: "CEO" },
  { key: "intern", label: "นักศึกษาฝึกงาน", short: "ฝึกงาน", note: "ลงเวลาเข้า-ออกงาน และยื่นใบลา",
    en: "Intern" },
  /* แม่บ้าน — ลงเวลา เบิกค่าใช้จ่าย ลา และดูสลิปเงินเดือน (ระบบต้นฉบับ 2 ต.ค. 2569) */
  { key: "maid", label: "แม่บ้าน", short: "แม่บ้าน", note: "ลงเวลา ยื่นใบลา เบิกค่าใช้จ่าย และดูสลิปเงินเดือน",
    en: "Housekeeper" },
];

/*
 * ⚠️ 25 ก.ย. 2569 เจ้าของสั่งให้ผู้ดูแลระบบ "แยกออกไปเลย"
 * เดิมผูกไว้กับบัญชีฝ่ายบุคคล และให้ผู้บริหารถือเป็นตัวสำรอง (ADMIN_BACKUP = "ceo")
 * ผลคือเมนูของผู้บริหารมีหน้าตั้งค่าของผู้ดูแลระบบติดมาด้วย ซึ่งไม่ใช่งานของผู้บริหาร
 * ตอนนี้เป็นบัญชีของตัวเอง เข้าระบบด้วยบทบาทผู้ดูแลระบบโดยตรง ไม่ควบกับใคร
 */

function isRole(value: unknown): value is Role {
  return ROLES.some((r) => r.key === value);
}

const store = createPersistedStore<Role>("maz-erp.role.v1", "sales", isRole);

export function useRole() {
  return useSyncExternalStore(store.subscribe, store.get, store.getServer);
}

/** อ่านนอก React เช่นตอนบันทึกใบงาน */
export function currentRole() {
  return store.get();
}

export function setRole(role: Role) {
  store.set(role);
}

/** ให้สโตร์อื่นเกาะไปด้วยได้ เช่นโปรไฟล์ที่ต้องเปลี่ยนตามบทบาท */
export const subscribeRole = store.subscribe;

export function roleLabel(role: Role) {
  return ROLES.find((r) => r.key === role)!.label;
}

/**
 * ชื่อฝ่ายของคนคนหนึ่ง — ทำฝ่ายเดียวใช้ชื่อตำแหน่งเต็ม ทำสองฝ่ายเขียนรวบด้วย "และ"
 * เช่น "บัญชีและบุคคล" (เจ้าของสั่ง 5 ต.ค. 2569 — เดิมเขียนว่า "ควบ 2 ตำแหน่ง · …" ยาวและอ่านยาก)
 */
export function rolesLabel(roles: Role[]) {
  if (roles.length < 2) return roleLabel(roles[0]);
  return roles.map((r) => ROLES.find((x) => x.key === r)!.short).join("และ");
}

/**
 * สายอนุมัติของคำขอส่วนตัว — แยกตาม "ประเภทคำขอ" ไม่ใช่ตามผังบังคับบัญชาอย่างเดียว
 *
 * ใบลากับโอทีเป็นเรื่องของเวลาทำงาน หัวหน้าสายงานเป็นคนตัดสิน
 * ใบเบิกค่าน้ำมันของทีม PM เป็นคนตัดสินตามต้นแบบ pm-approvals.html (ดูหมายเหตุที่ DEFAULT_ROUTE)
 *
 * ผู้อนุมัติระดับผู้บริหารคือบทบาท CEO (เปิดเมื่อ 21 ก.ย. 2569) ตัดสินที่หน้า /ceo/approvals
 */
export type RequestKind = "leave" | "ot" | "expense";

export type Approver = {
  /** บทบาทที่ล็อกอินเข้ามาอนุมัติได้ — null คือยังไม่มีบทบาทนี้ในระบบ */
  role: Role | null;
  name: string;
  title: string;
};

/*
 * ใครเป็น "คน" คนเดียวกัน — ผู้อนุมัติต้องไม่ใช่ผู้ยื่น และต้องดูกันที่ตัวคน ไม่ใช่ที่ชื่อบทบาท
 * (ผู้ใช้ตัดสิน 24 ก.ย. 2569) วันนี้อรอนงค์ถือทั้งบัญชี บุคคล และผู้ดูแลระบบ
 * สายเดิมส่งใบเบิกของฝ่ายบุคคลไปหา "บัญชีและบุคคล" ซึ่งก็คือตัวเธอเอง
 *
 * รหัสพนักงานของแต่ละบทบาทอ่านจากทะเบียน (ROLE_EMPLOYEE) · บทบาทผู้ดูแลระบบอยู่บนบัญชี
 * เดียวกับฝ่ายบุคคล (ACCOUNT_ROLE_SEED ใน hr-data.ts) จึงผูกไว้ตรงนี้อย่างเดียว
 * ไม่เติมลง ROLE_EMPLOYEE เพราะสะพานฝ่ายบุคคลจะรวมใบของบทบาทนั้นเข้าเป็นคนเดียวกันทันที
 * บทบาทที่ไม่มีคนในทะเบียน (ผู้บริหาร) ถือเป็นคนละคนกับทุกคนเสมอ
 */
const ROLE_PERSON: Partial<Record<Role, string>> = { ...ROLE_EMPLOYEE };

export function personOfRole(role: Role) {
  return ROLE_PERSON[role] ?? `role:${role}`;
}

/** บทบาทที่ล็อกอินเข้ามาอนุมัติของแต่ละสาย */
const APPROVER_ROLE: Record<ApproverKey, Role | null> = {
  pm: "pm",
  acc: "acc",
  hr: "hr",
  gm: "gm",
  exec: "ceo",
};

/**
 * ผู้อนุมัติที่เลือกได้ในหน้าตั้งค่าบทบาทของผู้ดูแลระบบ (/admin/roles)
 * เก็บเป็นคีย์ ไม่ได้เก็บชื่อคน — ชื่อและตำแหน่งดึงจากตรงนี้เสมอ
 */
export type ApproverKey = "pm" | "acc" | "hr" | "gm" | "exec";

/** ผู้อนุมัติทั้งหมด — ชื่อ/ตำแหน่งอ่านจากการตั้งค่าทุกครั้ง (ผู้ดูแลระบบแก้ได้ที่ /admin/roles) */
export function approvers(): Record<ApproverKey, Approver> {
  const n = settings().approvers;
  return {
    pm: { role: APPROVER_ROLE.pm, ...n.pm },
    acc: { role: APPROVER_ROLE.acc, ...n.acc },
    hr: { role: APPROVER_ROLE.hr, ...n.hr },
    gm: { role: APPROVER_ROLE.gm, ...n.gm },
    exec: { role: APPROVER_ROLE.exec, ...n.exec },
  };
}

export type ApprovalRoute = Record<RequestKind, Record<Role, ApproverKey>>;

/*
 * ค่าตั้งต้นของสายอนุมัติ — ตาม ERD โมดูลฝ่ายบุคคล (HR-BR-14, HR-BR-15) ผู้ดูแลระบบแก้ได้
 *
 * ใบลา: พนักงานทั่วไป → GM · GM และตำแหน่งบัญชีและบุคคล (บัญชี, ฝ่ายบุคคล) → CEO
 *        นักศึกษาฝึกงานไม่มีบัญชีเข้าระบบ ฝ่ายบุคคลอนุมัติที่แดชบอร์ดของตัวเอง (hr-store)
 * โอที: CEO อนุมัติเฉพาะตำแหน่ง SA / Dev / Website (CEO-BR-02 · ผู้ใช้เลือก 22 ก.ย. 2569) · ตำแหน่งอื่น → PM
 *        ทีมก่อนการขาย (ps) เป็นตำแหน่ง SA จึงขึ้น CEO
 *        PM อนุมัติของตัวเองไม่ได้ จึงขึ้นหัวหน้าตามสาย (GM) · GM ขึ้น CEO ตามสายบังคับบัญชา
 * ใบเบิก: ⚠️ เปลี่ยน 22 ก.ย. 2569 ตามต้นแบบ pm-approvals.html ชุดใหม่ — PM เป็นผู้อนุมัติใบเบิกค่าน้ำมันของทีม
 *        ขาย · ทีมก่อนการขาย · พนักงาน → PM · ใบของ PM เอง → CEO (ต้นแบบ gm-approvals ไม่ให้ GM อนุมัติใบเบิก)
 *        เดิมทุกบทบาทขึ้นฝ่ายบัญชี (ผู้ใช้ยืนยัน 21 ก.ย.) ต้นแบบชุดใหม่ทับค่านั้น
 *        ⚠️ เครื่องที่ผู้ดูแลระบบเคยแก้สายอนุมัติไว้ — เปลี่ยนคีย์สโตร์เป็น v4 เมื่อ 22 ก.ย. 2569 ค่าที่เคยแก้ไว้จึงกลับเป็นค่าตั้งต้น
 * ⚠️ สายอนุมัติผูกกับบทบาท ไม่ใช่ตำแหน่ง — หนึ่งบทบาทคือหนึ่งคนในตอนนี้ จึงแทนกันได้
 * ผู้ดูแลระบบและผู้บริหารไม่ยื่นคำขอ (NO_REQUESTS) ค่าของสองบทบาทนี้มีไว้ให้ครบเฉย ๆ
 */
export const DEFAULT_ROUTE: ApprovalRoute = {
  leave: { sales: "gm", ps: "gm", pm: "gm", staff: "gm", acc: "exec", hr: "exec", gm: "exec", ceo: "hr", intern: "hr", maid: "gm" },
  /* 22 ก.ย. 2569 ผู้ใช้เอาเมนูรายการรออนุมัติออกจาก PM — คำขอที่เคยขึ้น PM ย้ายไป GM */
  /* ต้นแบบ gm-approvals.html ชุด 22 ก.ย. 2569 (files (2)):
       โอที — GM อนุมัติทุกตำแหน่ง ยกเว้น SA/Dev/Website/GM และบัญชีและบุคคล → CEO
       ใบเบิก — GM อนุมัติทุกคน ยกเว้นใบของ GM เอง (ผู้ใช้ยืนยัน 24 ก.ย. 2569 ว่าขึ้น CEO) */
  ot: { sales: "gm", ps: "exec", acc: "exec", hr: "exec", staff: "exec", pm: "gm", gm: "exec", ceo: "hr", intern: "hr", maid: "gm" },
  /* 24 ก.ย. 2569 ผู้ใช้ตัดสิน: ใบเบิกของฝ่ายบุคคลไปที่ GM เหมือนพนักงานทั่วไป
     (เดิมส่งไป "บัญชีและบุคคล" ซึ่งเป็นคนเดียวกับผู้ยื่น) · ใบเบิกของ GM เองขึ้น CEO ตามสายบังคับบัญชา
     ผู้ดูแลระบบอยู่บัญชีเดียวกับฝ่ายบุคคล จึงย้ายไป GM ด้วย (บทบาทนี้ยังไม่ยื่นคำขอ — NO_REQUESTS) */
  expense: { sales: "gm", ps: "gm", pm: "gm", staff: "gm", hr: "gm", gm: "exec", acc: "gm", ceo: "acc", intern: "hr", maid: "gm" },
};

const KINDS = ["leave", "ot", "expense"] as const;

function isRoute(v: unknown): v is ApprovalRoute {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return KINDS.every((k) => typeof r[k] === "object" && r[k] !== null);
}

/** เติมบทบาทที่เพิ่มทีหลังจากค่าตั้งต้น และทิ้งค่าที่ไม่รู้จัก — ไม่ทับที่ผู้ดูแลเลือกไว้ */
function fillRoute(v: ApprovalRoute): ApprovalRoute {
  const out = {} as ApprovalRoute;
  for (const k of KINDS) {
    out[k] = { ...DEFAULT_ROUTE[k] };
    for (const r of ROLES) {
      const key = (v[k] as Record<string, unknown>)[r.key];
      /* เก็บค่าที่ผู้ดูแลระบบเลือกไว้ตามเดิม แม้ตอนนี้จะกลายเป็นคนเดียวกับผู้ยื่น
         (คนหนึ่งรับบทบาทเพิ่มทีหลังได้) — ตรงนั้นไปตัดสินตอนอ่านที่ approverOf */
      if (typeof key === "string" && key in APPROVER_ROLE) {
        out[k][r.key] = key as ApproverKey;
      }
    }
  }
  return out;
}

const routeStore = createPersistedStore<ApprovalRoute>(
  "maz-erp.approval-route.v4",
  DEFAULT_ROUTE,
  isRoute,
  fillRoute,
);

export function useApprovalRoute() {
  return useSyncExternalStore(routeStore.subscribe, routeStore.get, routeStore.getServer);
}

/**
 * อนุมัติใบของตัวเองไม่ได้ — ดูที่ "ตัวคน" ไม่ใช่ชื่อบทบาท (ผู้ใช้ตัดสิน 24 ก.ย. 2569)
 * คนหนึ่งถือได้หลายบทบาท ถ้าเทียบแค่ชื่อบทบาท ใบเบิกของฝ่ายบุคคลจะวิ่งไปหาตัวเธอเองที่บทบาทบัญชี
 */
export function canRoute(key: ApproverKey, from: Role) {
  const role = APPROVER_ROLE[key];
  /* ผู้อนุมัติที่ยังไม่มีบทบาทให้ล็อกอิน ยังไม่ใช่ใคร จึงไม่ชนกับผู้ยื่น */
  if (role === null) return true;
  return personOfRole(role) !== personOfRole(from);
}

export function setApprover(kind: RequestKind, from: Role, key: ApproverKey) {
  if (!canRoute(key, from)) return;
  routeStore.update((r) => ({ ...r, [kind]: { ...r[kind], [from]: key } }));
}

export function resetApprovalRoute() {
  routeStore.reset();
}

/**
 * ใครเป็นคนอนุมัติคำขอประเภทนี้ของบทบาทนี้
 * ในคอมโพเนนต์ให้ส่ง route จาก useApprovalRoute() มาด้วย ตอน hydrate จะได้ตรงกับฝั่งเซิร์ฟเวอร์
 */
/**
 * ไม่มีผู้อนุมัติที่ใช้ได้ — ผู้อนุมัติที่ตั้งไว้เป็นคนเดียวกับผู้ยื่น
 * ต้องบอกออกไปตรง ๆ ว่าใบนี้ "ยังไม่มีผู้อนุมัติ" ดีกว่าปล่อยให้อนุมัติของตัวเอง
 * หรือปล่อยให้ใบหายเงียบ ๆ ไม่โผล่ในคิวใคร (ผู้ใช้ตัดสิน 24 ก.ย. 2569)
 */
export const NO_APPROVER: Approver = {
  role: null,
  name: "ยังไม่มีผู้อนุมัติ",
  title: "ผู้อนุมัติที่ตั้งไว้เป็นคนเดียวกับผู้ยื่น",
};

/**
 * ตำแหน่งงานของบทบาทที่ล็อกอิน — ใช้หาสายอนุมัติรายตำแหน่ง
 * บทบาทที่ไม่มีคนในทะเบียน (ผู้บริหาร) ไม่มีตำแหน่ง จึงใช้สายตามบทบาทเหมือนเดิม
 */
export function positionOfRole(role: Role) {
  const id = ROLE_EMPLOYEE[role];
  return id ? (HR_EMP.find((e) => e.id === id)?.pos ?? "") : "";
}

/**
 * ผู้อนุมัติที่ตั้งไว้ — สายรายตำแหน่ง (/admin/positions) มาก่อนสายรายบทบาท (Full Proposal · M5)
 * ตำแหน่งไหนยังไม่ได้ตั้ง ก็ตกมาใช้ค่าตามบทบาทเหมือนเดิม
 */
function routeKeyOf(role: Role, kind: RequestKind, route: ApprovalRoute): ApproverKey {
  const byPos = settings().posRoute[positionOfRole(role)]?.[kind];
  return byPos && byPos in APPROVER_ROLE ? (byPos as ApproverKey) : route[kind][role];
}

export function approverOf(role: Role, kind: RequestKind, route = routeStore.get()): Approver {
  const key = routeKeyOf(role, kind, route);
  return canRoute(key, role) ? approvers()[key] : NO_APPROVER;
}

/** ใบประเภทนี้ของบทบาทนี้ ยังไม่มีใครอนุมัติได้ */
export function hasNoApprover(role: Role, kind: RequestKind, route = routeStore.get()) {
  return !canRoute(routeKeyOf(role, kind, route), role);
}

/** บทบาทที่ไม่มีเมนู "ของฉัน" จึงไม่ได้ยื่นคำขอ — ไม่นับเป็นหน้าที่อนุมัติของใคร */
export const NO_REQUESTS: Role[] = ["ceo"];

/** คำขอประเภทไหนของบทบาทไหนบ้าง ที่คนนี้ต้องเป็นคนอนุมัติ */
export function approvesFor(
  role: Role,
  route = routeStore.get(),
): { kind: RequestKind; from: Role }[] {
  const out: { kind: RequestKind; from: Role }[] = [];
  for (const kind of KINDS) {
    for (const r of ROLES) {
      if (NO_REQUESTS.includes(r.key)) continue;
      /* ใบของตัวเองต้องไม่เข้าคิวตัวเอง ต่อให้สายอนุมัติชี้มาแบบนั้น — ตรวจที่ตัวคน */
      const key = routeKeyOf(r.key, kind, route);
      if (!canRoute(key, r.key)) continue;
      if (APPROVER_ROLE[key] === role) out.push({ kind, from: r.key });
    }
  }
  return out;
}
