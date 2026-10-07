/*
 * โครงเมนูทั้งระบบ — ขึ้นกับบทบาทที่ล็อกอินอยู่ (ดู role.ts)
 *
 * กลุ่ม "ของฉัน" เป็นงานบุคคลของตัวเอง จึงเหมือนกันทุกบทบาท
 * ที่ต่างกันคือกลุ่มงานข้างบน — ฝั่งขายได้ "งานขาย" ฝั่ง PM ได้ "งานของ PM"
 */

import { useSyncExternalStore } from "react";
import { createPersistedStore } from "./persisted-store";
import { approvesFor, type ApprovalRoute, type Role } from "./role";

export type IconName =
  | "leads"
  | "presales"
  | "quotation"
  | "deals"
  | "chart"
  | "clock"
  | "leave"
  | "ot"
  | "commission"
  | "user"
  | "inbox"
  | "planboard"
  | "project"
  | "team"
  | "ads"
  | "accboard"
  | "billing"
  | "receipt"
  | "tax"
  | "approve"
  | "tasks"
  | "pin"
  | "shield"
  | "home";

/** หัวข้อกลุ่มในเมนูซ้าย */
export type NavGroup =
  | "งานขาย" | "งานก่อนการขาย" | "โปรเจค" | "บัญชี" | "ฝ่ายบุคคล" | "งานของฉัน" | "ของฉัน" | "ผู้บริหาร" | "ภาพรวมระบบ" | "ผู้จัดการทั่วไป" | "ตั้งค่า"
  /* กลุ่มเมนูของผู้ดูแลระบบ */
  | "ผู้ใช้และสิทธิ์" | "การทำงาน" | "เอกสารและการเงิน" | "ดูแลระบบ";

/** title = ชื่อบนแถบบนถ้าต่างจากชื่อแท็บ */
export type SubItem = {
  label: string;
  href: string;
  title?: string;
  /** หัวข้อกลุ่มที่คั่นเหนือรายการนี้ในเมนูย่อย */
  caption?: string;
  /** หน้าย่อยที่แยกด้วย query (เช่น ?s=) บอกเองว่ากำลังเปิดอยู่ไหม */
  on?: (pathname: string, q: URLSearchParams) => boolean;
};

/*
 * หัวข้อของหน้าตั้งค่าระบบ (/admin/settings?s=<key>) — ยกการวางแบบมาจากระบบต้นฉบับ
 * หัวข้ออยู่ในเมนูย่อยของแถบข้าง (จอคอม) และแถบชิปเหนือเนื้อหา (มือถือ) ไม่มีรายการซ้อนในเนื้อหาอีก
 * ลำดับและกลุ่มตามต้นแบบ "ตั้งค่าระบบ — ERP MAZ.html" · หน้าตั้งค่าอ่านรายการนี้ชุดเดียวกัน
 */
export const SETTINGS_SECTIONS = [
  { key: "master", label: "ข้อมูลหลัก", group: "ข้อมูลองค์กร" },
  { key: "positions", label: "ตำแหน่งและสายอนุมัติ", group: "ข้อมูลองค์กร" },
  { key: "services", label: "บริการ", group: "ข้อมูลองค์กร" },
  { key: "leave", label: "ประเภทการลา", group: "การลาและเวลา" },
  { key: "holidays", label: "วันหยุดบริษัท", group: "การลาและเวลา" },
  { key: "attendance", label: "เวลาทำงานและจุดลงเวลา", group: "การลาและเวลา" },
  { key: "payroll", label: "การคำนวณเงินเดือน", group: "เงินและเอกสาร" },
  { key: "wht", label: "หัก ณ ที่จ่าย", group: "เงินและเอกสาร" },
  { key: "issuer", label: "ข้อมูลผู้ออกเอกสาร", group: "เงินและเอกสาร" },
] as const;
export type SettingsKey = (typeof SETTINGS_SECTIONS)[number]["key"];

/** หัวข้อที่เปิดอยู่จาก ?s= — ไม่มีหรือไม่รู้จัก = ข้อมูลหลัก */
export function settingsKeyOf(q: URLSearchParams): SettingsKey {
  const s = q.get("s");
  return SETTINGS_SECTIONS.find((x) => x.key === s)?.key ?? "master";
}

const SETTINGS_SUB: SubItem[] = [
  ...SETTINGS_SECTIONS.map((x, i, all) => ({
    label: x.label,
    href: `/admin/settings?s=${x.key}`,
    caption: i === 0 || all[i - 1].group !== x.group ? x.group : undefined,
    on: (p: string, q: URLSearchParams) => p === "/admin/settings" && settingsKeyOf(q) === x.key,
  })),
  /* หน้าระบบที่แยกเป็นหน้าของตัวเอง — อยู่ท้ายเมนูย่อย */
  { label: "เลขที่เอกสาร", href: "/admin/doc-numbers", caption: "ระบบ" },
  { label: "ประวัติการตั้งค่า", href: "/admin/log" },
  { label: "ข้อมูลตัวอย่าง", href: "/admin/data" },
];

/*
 * คำขออนุมัติของ CEO แยกสองเมนูย่อย (ยกจากระบบต้นฉบับ) — ส่งต่อกันทาง ?k= ไม่ใช่แท็บในหน้า
 * ไม่มี ?k= ถือเป็นลาและโอที (ลิงก์เก่า ?req= จากแดชบอร์ดหรือ LINE เป็นคำขอของพนักงานทั้งหมด)
 */
const CEO_APPROVALS_SUB: SubItem[] = [
  {
    label: "ลาและโอที",
    href: "/ceo/approvals?k=time",
    on: (p, q) => p === "/ceo/approvals" && q.get("k") !== "pay",
  },
  {
    label: "ยอดเงินเดือน",
    href: "/ceo/approvals?k=pay",
    on: (p, q) => p === "/ceo/approvals" && q.get("k") === "pay",
  },
];

export type NavItem = {
  group: NavGroup;
  label: string;
  icon: IconName;
  href: string;
  /** หน้าย่อยของหัวข้อนี้ — โผล่เป็นดรอปดาวน์ใต้แถบบน */
  sub?: SubItem[];
  /** หน้านอกเมนูที่อยู่ใต้หัวข้ออื่น — เมนูซ้ายไฮไลต์หัวข้อนั้นแทน */
  parent?: string;
};

/*
 * งานบุคคลของตัวเอง — ทุกบทบาทเห็นชุดนี้ แต่ "ประเภทการจ้าง" ตัดบางเมนูออก
 * (เจ้าของสั่ง 30 ก.ย. 2569 · ตามเอกสารสอบถามฝ่ายบุคคล)
 *   ฝึกงาน   ไม่มีค่าจ้าง จึงไม่มีโอที ไม่มีเบิกค่าใช้จ่าย และไม่มีสลิป — เหลือเวลาทำงานกับการลา
 *   ทดลองงาน จ่ายรายวัน มีสลิปค่าจ้างรายสัปดาห์ — เมนูครบ แต่เรียกว่า "สลิปค่าจ้าง"
 */
const MINE: NavItem[] = [
  {
    group: "ของฉัน",
    label: "เวลาทำงาน",
    icon: "clock",
    href: "/",
    sub: [
      { label: "ตอกบัตรเข้า/ออก", href: "/", title: "เวลาทำงาน" },
      { label: "บันทึกเวลาของฉัน", href: "/records" },
    ],
  },
  { group: "ของฉัน", label: "การลา", icon: "leave", href: "/leave" },
  /* เข้ามาจากปุ่ม "ขอโอที" ในหน้าเวลาทำงาน — กดย้อนกลับต้องกลับไปหน้านั้น
     (เจ้าของแจ้ง 5 ต.ค. 2569 ว่าเด้งไปหน้าแรก) */
  { group: "ของฉัน", label: "โอที", icon: "ot", href: "/ot", parent: "/" },
  { group: "ของฉัน", label: "เบิกค่าใช้จ่าย", icon: "commission", href: "/expense" },
  /* ปลายทางของสายเงินเดือน — ฝ่ายบุคคลเผยแพร่แล้วทุกคนเปิดดูของตัวเองได้จากตรงนี้ */
  { group: "ของฉัน", label: "สลิปเงินเดือน", icon: "receipt", href: "/payslip" },
];

/** ประเภทการจ้าง — ชนิดเดียวกับทะเบียนฝ่ายบุคคล (ไม่ import เพื่อไม่ให้ nav ผูกกับข้อมูล HR) */
export type MineEmpType = "full" | "probat" | "intern";

/** เมนู "ของฉัน" ที่ประเภทการจ้างนี้เห็น */
function mineFor(type: MineEmpType = "full"): NavItem[] {
  if (type === "intern")
    /* ฝึกงานไม่มีค่าจ้าง — ไม่มีโอที ไม่มีเบิกค่าใช้จ่าย ไม่มีสลิป แต่ยังต้องลงเวลาและลา
       (เจ้าของยืนยัน 30 ก.ย. 2569) */
    return MINE.filter((i) => !["/ot", "/expense", "/payslip"].includes(i.href));
  if (type === "probat")
    /* ทดลองงานจ่ายรายวัน สลิปเป็นค่าจ้างรายสัปดาห์ ไม่ใช่เงินเดือน */
    return MINE.map((i) => (i.href === "/payslip" ? { ...i, label: "สลิปค่าจ้าง" } : i));
  return MINE;
}

/* ลำดับและชื่อเมนูตาม Proposal · Sales Site Map */
const SALES: NavItem[] = [
  { group: "งานขาย", label: "แดชบอร์ด", icon: "chart", href: "/dashboard" },
  { group: "งานขาย", label: "ผู้สนใจ", icon: "leads", href: "/leads" },
  { group: "งานขาย", label: "คำขอก่อนการขาย", icon: "presales", href: "/presales" },
  { group: "งานขาย", label: "ใบเสนอราคา", icon: "quotation", href: "/quotations" },
  { group: "งานขาย", label: "ดีล", icon: "deals", href: "/deals" },
  /* ตารางงานของฝ่ายขาย — ผู้เข้าร่วมเป็นผู้สนใจ (ยกมาจากระบบต้นฉบับ) */
  { group: "งานขาย", label: "ตารางงาน", icon: "leave", href: "/sales-schedule" },
];

/*
 * ทีมก่อนการขาย (SA/BD) — รับคำขอจากฝ่ายขายแล้วส่งข้อเสนอกลับ
 * ต้นแบบชุด 2 ต.ค. 2569 (presales-work / presales-schedule / presales-templates.html)
 * เอาแดชบอร์ดกับคลังเทมเพลตกลับเข้าเมนู และเรียกหน้างานว่า "งานก่อนการขาย"
 * (ของฝ่ายขายคือ "คำขอก่อนการขาย" คนละหน้ากัน)
 */
const PS: NavItem[] = [
  { group: "งานก่อนการขาย", label: "แดชบอร์ด", icon: "chart", href: "/presales-dash" },
  { group: "งานก่อนการขาย", label: "งานก่อนการขาย", icon: "presales", href: "/presales-work" },
  /* BD/SA รับงานจาก PM เหมือนทีมโปรเจค (Proposal · BD / SA Site Map) */
  { group: "งานก่อนการขาย", label: "งานที่ได้รับ", icon: "tasks", href: "/my-tasks" },
  { group: "งานก่อนการขาย", label: "ตารางงาน", icon: "leave", href: "/presales-schedule" },
  { group: "งานก่อนการขาย", label: "คลังเทมเพลต", icon: "project", href: "/presales-templates" },
  /*
   * SA รับโอนโปรเจคจาก PM ได้ (Proposal · PM — Transfer Project)
   * หน้านี้ของ SA แสดงเฉพาะโปรเจคที่ตัวเองเป็นผู้ดูแล ไม่ใช่โปรเจคทั้งบริษัทแบบฝั่ง PM
   */
  { group: "งานก่อนการขาย", label: "โปรเจคที่รับโอน", icon: "project", href: "/pm/projects" },
];

const PM: NavItem[] = [
  { group: "โปรเจค", label: "แดชบอร์ด", icon: "chart", href: "/pm/dashboard" },
  { group: "โปรเจค", label: "งานเข้าใหม่", icon: "inbox", href: "/pm/inbox" },
  { group: "โปรเจค", label: "โปรเจค", icon: "project", href: "/pm/projects" },
  /* งานที่ทีมส่งกลับมาให้ตรวจ — คู่กับหน้า "งานที่ได้รับ" ของพนักงาน */
  { group: "โปรเจค", label: "งานรอตรวจ", icon: "tasks", href: "/pm/reviews" },
  /* ปฏิทินนัดหมายของ PM — คนละเรื่องกับงานย่อยในโปรเจค */
  { group: "โปรเจค", label: "ตารางงาน", icon: "leave", href: "/pm/schedule" },
  /* Proposal · PM Site Map กำหนดให้ PM มีเมนูนี้ด้วย (เดิมมีแต่ GM) */
  { group: "โปรเจค", label: "โฆษณาและรายงาน", icon: "ads", href: "/pm/ads" },
];

/*
 * พนักงาน — เห็นแค่งานที่ตัวเองถูกมอบหมาย กับตารางงานที่ใช้ร่วมกับ PM
 * ไม่เห็นรายการโปรเจคทั้งหมด เพราะไม่ได้เป็นคนคุมภาพรวม
 */
const STAFF: NavItem[] = [
  { group: "งานของฉัน", label: "งานที่ได้รับ", icon: "tasks", href: "/my-tasks" },
  /* ตารางงานของพนักงานเป็นหน้าของตัวเอง (ต้นแบบ my-schedule.html) — เห็นเฉพาะนัดที่ตัวเองต้องเข้าร่วม */
  { group: "งานของฉัน", label: "ตารางงาน", icon: "leave", href: "/my-schedule" },
];


const ACC: NavItem[] = [
  { group: "บัญชี", label: "แดชบอร์ด", icon: "accboard", href: "/acc/dashboard" },
  /* ใบเสนอราคาของบัญชี — ออกให้ลูกค้าที่ปิดการขายแล้วเท่านั้น (ต้นแบบ acc-quotations.html) */
  { group: "บัญชี", label: "ใบเสนอราคา", icon: "quotation", href: "/acc/quotations" },
  { group: "บัญชี", label: "วางบิล", icon: "billing", href: "/acc/billing" },
  { group: "บัญชี", label: "ใบเสร็จรับเงิน", icon: "receipt", href: "/acc/receipts" },
  { group: "บัญชี", label: "หัก ณ ที่จ่าย", icon: "tax", href: "/acc/wht" },
];

/*
 * รอบเงินเดือนแยกเป็นสองเมนูย่อยตามกลุ่มการจ่าย (ยกมาจากระบบต้นฉบับ 6 ต.ค. 2569)
 *   "พนักงาน" = จ่ายรายเดือน · "ทดลองงาน" = จ่ายรายวัน
 * ทั้งสี่ขั้น (ตรวจเวลา · คำนวณ · ออกสลิป · ประวัติรอบ) ใช้ชุดเดียวกัน กลุ่มส่งต่อกันทาง ?g=
 * ไม่มี ?g= ถือเป็นรายเดือน (ลิงก์เก่าและแถบล่างบนมือถือ)
 */
const PAY_STEPS = ["/hr/timesheet", "/hr/payroll", "/hr/payslip", "/hr/cycles"];
const PAY_SUB: SubItem[] = [
  {
    label: "พนักงาน",
    href: "/hr/timesheet?g=month",
    on: (p, q) => PAY_STEPS.includes(p) && q.get("g") !== "day",
  },
  {
    label: "ทดลองงาน",
    href: "/hr/timesheet?g=day",
    on: (p, q) => PAY_STEPS.includes(p) && q.get("g") === "day",
  },
];

const HR: NavItem[] = [
  { group: "ฝ่ายบุคคล", label: "แดชบอร์ด", icon: "accboard", href: "/hr/dashboard" },
  { group: "ฝ่ายบุคคล", label: "พนักงาน", icon: "team", href: "/hr/employees" },
  /* ต้นแบบมีรายการเดียวคือ "รอบเงินเดือน" แล้วข้ามขั้นด้วยแถบขั้นตอนในหน้า (dose-erp-maz/hr-*.html)
     เมนูย่อยแยกตามกลุ่มการจ่าย ยกมาจากระบบต้นฉบับ 6 ต.ค. 2569 */
  { group: "ฝ่ายบุคคล", label: "รอบเงินเดือน", icon: "clock", href: "/hr/timesheet", sub: PAY_SUB },
  { group: "ฝ่ายบุคคล", label: "รายงาน", icon: "chart", href: "/hr/report" },
  { group: "ฝ่ายบุคคล", label: "จัดการบัญชีผู้ใช้", icon: "user", href: "/hr/accounts" },

  /*
   * ตั้งค่าระบบและข้อมูลหลัก (Full Proposal · M5) — เจ้าของโมดูลคือฝ่ายบุคคล
   * 28 ก.ย. 2569 เจ้าของส่งต้นแบบ "ตั้งค่าระบบ — ERP MAZ.html" มาแล้วสั่งให้เปลี่ยนตามนั้น
   * ทั้ง 9 หัวข้อจึงรวมอยู่ในหน้าเดียว (/admin/settings) เลือกหัวข้อจากรายการด้านซ้าย
   * 29 ก.ย. 2569 เจ้าของสั่ง "อันเก่าลบทิ้ง" — หน้าเดิมของแต่ละหัวข้อถูกลบไปแล้ว เหลือหน้าเดียวนี้
   * 29 ก.ย. 2569 เจ้าของสั่ง "อันเก่าลบทิ้ง" — หน้าย่อยที่ไม่มีในต้นแบบ
   * (บทบาทและสิทธิ์ · เลขที่เอกสาร · ประวัติการตั้งค่า · ข้อมูลตัวอย่าง) ถูกลบไปแล้ว
   */
  {
    group: "ตั้งค่า",
    label: "ตั้งค่าระบบ",
    icon: "shield",
    href: "/admin/settings",
    sub: SETTINGS_SUB,
  },
];

/*
 * PM เหลือ 5 เมนู (ผู้ใช้สั่ง 22 ก.ย. 2569) ไม่มีโฆษณาและรายงาน และไม่มีรายการรออนุมัติ
 *   — คำขอที่เคยขึ้น PM ย้ายไป GM ทั้งหมด (role.ts DEFAULT_ROUTE)
 *
 * ผู้จัดการทั่วไป (GM) — ต้นแบบชุด 22 ก.ย. 2569 (gm-*.html + pm-*.html?as=gm) กลุ่ม "ผู้จัดการทั่วไป"
 * แดชบอร์ด (ของ GM) · งานเข้าใหม่ · โปรเจค · งานรอตรวจ · ตารางงาน (ปฏิทินทีม) · โฆษณาและรายงาน · รายการรออนุมัติ
 * หน้าของ PM ที่ GM เปิดเป็นแบบดูอย่างเดียว (pm-readonly.tsx) — ยกเว้นโฆษณาและรายงาน
 * เพราะผู้ใช้เอาเมนูนี้ออกจาก PM แล้ว GM จึงเป็นคนเดียวที่ใช้งาน
 */
const GM: NavItem[] = [
  { group: "ผู้จัดการทั่วไป", label: "แดชบอร์ด", icon: "chart", href: "/gm/dashboard" },
  { group: "ผู้จัดการทั่วไป", label: "งานเข้าใหม่", icon: "inbox", href: "/pm/inbox" },
  { group: "ผู้จัดการทั่วไป", label: "โปรเจค", icon: "project", href: "/pm/projects" },
  { group: "ผู้จัดการทั่วไป", label: "งานรอตรวจ", icon: "tasks", href: "/pm/reviews" },
  { group: "ผู้จัดการทั่วไป", label: "ตารางงาน", icon: "leave", href: "/gm/calendar" },
  { group: "ผู้จัดการทั่วไป", label: "โฆษณาและรายงาน", icon: "ads", href: "/pm/ads" },
];

/*
 * ผู้บริหาร (CEO) — ตามต้นแบบ dose-erp-maz/ceo-*.html
 * "ผู้บริหาร" = งานของ CEO เอง · "ภาพรวมระบบ" = หน้าของฝ่ายอื่นแบบดูอย่างเดียว (ceo-view.tsx)
 * ไม่มีกลุ่ม "ของฉัน" ตามต้นแบบ · ไม่ใช้เมนู "รายการรออนุมัติ" กลาง เพราะมีหน้าคำขออนุมัติของตัวเอง
 */
const CEO: NavItem[] = [
  { group: "ผู้บริหาร", label: "แดชบอร์ด", icon: "chart", href: "/ceo/dashboard" },
  { group: "ผู้บริหาร", label: "คำขออนุมัติ", icon: "approve", href: "/ceo/approvals", sub: CEO_APPROVALS_SUB },
  { group: "ภาพรวมระบบ", label: "งานขาย", icon: "deals", href: "/ceo/sales" },
  { group: "ภาพรวมระบบ", label: "บัญชี", icon: "accboard", href: "/ceo/acc" },
  { group: "ภาพรวมระบบ", label: "บุคคล", icon: "team", href: "/ceo/hr" },
  { group: "ภาพรวมระบบ", label: "โปรเจค", icon: "project", href: "/ceo/pm" },
];


/*
 * นักศึกษาฝึกงาน — หน้าเหมือนทีมงานทุกอย่าง ตัดโอที เบิกค่าใช้จ่าย และสลิปเงินเดือนออก
 * (ผู้ใช้สั่ง 7 ต.ค. 2569) เพราะฝึกงานไม่มีค่าจ้าง · กลุ่ม "ของฉัน" กรองด้วย mineFor("intern")
 */
const INTERN: NavItem[] = STAFF;

/* แม่บ้าน — ลงเวลางาน · เบิกค่าใช้จ่าย · การลา · สลิปเงินเดือน · ดูบันทึกเวลาทั้งเดือนได้ ไม่มีโอที */
const MAID: NavItem[] = [
  { group: "ของฉัน", label: "ลงเวลางาน", icon: "clock", href: "/",
    sub: [
      { label: "ตอกบัตรเข้า/ออก", href: "/", title: "เวลาทำงาน" },
      { label: "บันทึกเวลาของฉัน", href: "/records" },
    ],
  },
  { group: "ของฉัน", label: "เบิกค่าใช้จ่าย", icon: "commission", href: "/expense" },
  { group: "ของฉัน", label: "การลา", icon: "leave", href: "/leave" },
  { group: "ของฉัน", label: "สลิปเงินเดือน", icon: "receipt", href: "/payslip" },
];

/** approvalsAfter = href ของเมนูที่ "รายการรออนุมัติ" ต่อท้าย — ไม่ระบุคือท้ายกลุ่มงาน */
const BY_ROLE: Record<Role, { work: NavItem[]; group: NavGroup; approvalsAfter?: string }> = {
  sales: { work: SALES, group: "งานขาย" },
  ps: { work: PS, group: "งานก่อนการขาย" },
  pm: { work: PM, group: "โปรเจค" },
  acc: { work: ACC, group: "บัญชี" },
  hr: { work: HR, group: "ฝ่ายบุคคล" },
  staff: { work: STAFF, group: "งานของฉัน" },
  /* รายการรออนุมัติอยู่ท้ายกลุ่มตามต้นแบบ */
  gm: { work: GM, group: "ผู้จัดการทั่วไป" },
  ceo: { work: CEO, group: "ผู้บริหาร" },
  /* ฝึกงานใช้กลุ่มเดียวกับทีมงาน — เมนูงานชุดเดียวกัน */
  intern: { work: INTERN, group: "งานของฉัน" },
  /* แม่บ้านมีแต่เมนูของตัวเอง จึงไม่ต้องต่อกลุ่ม "ของฉัน" ซ้ำอีก */
  maid: { work: MAID, group: "ของฉัน" },
};

/* ฝึกงานใช้กลุ่ม "ของฉัน" เหมือนทีมงาน แต่ mineFor("intern") ตัดโอที/เบิก/สลิปออกให้แล้ว */
const NO_MINE: Role[] = ["ceo", "maid"];

/*
 * เมนู "รายการรออนุมัติ" ไม่ได้ผูกกับบทบาทตายตัว — โผล่ให้บทบาทที่เป็นผู้อนุมัติของใครสักคน
 * ตามสายอนุมัติที่ผู้ดูแลระบบตั้ง (role.ts) ย้ายสายเมื่อไร เมนูย้ายตามเอง
 */
const APPROVALS_ITEM = { label: "รายการรออนุมัติ", icon: "approve", href: "/approvals" } as const;

// ─── เมนูที่ผู้ดูแลระบบปิดไว้ ─────────────────────────────────────

/** href ที่ปิดไว้ของแต่ละบทบาท — ไม่มีคือเปิดทั้งหมด */
export type MenuAccess = Partial<Record<Role, string[]>>;

function isAccess(v: unknown): v is MenuAccess {
  return (
    typeof v === "object" &&
    v !== null &&
    Object.values(v).every((x) => Array.isArray(x) && x.every((h) => typeof h === "string"))
  );
}

const accessStore = createPersistedStore<MenuAccess>("maz-erp.menu-access.v1", {}, isAccess);

export function useMenuAccess() {
  return useSyncExternalStore(accessStore.subscribe, accessStore.get, accessStore.getServer);
}

/** เมนูที่ผู้ดูแลระบบเปิด/ปิดได้ของบทบาทนี้ — ไม่รวมรายการรออนุมัติ เพราะขึ้นกับสายอนุมัติ */
export function configurableItems(role: Role): NavItem[] {
  return NO_MINE.includes(role) ? BY_ROLE[role].work : [...BY_ROLE[role].work, ...MINE];
}

export function setMenuOpen(role: Role, href: string, open: boolean) {
  accessStore.update((a) => {
    const hidden = new Set(a[role] ?? []);
    if (open) hidden.delete(href);
    else hidden.add(href);
    /* ต้องเหลืออย่างน้อยหนึ่งเมนู ไม่งั้นล็อกอินแล้วไม่มีหน้าให้ไป */
    if (configurableItems(role).every((i) => hidden.has(i.href))) return a;
    return { ...a, [role]: [...hidden] };
  });
}

export function resetMenuAccess(role?: Role) {
  if (!role) return accessStore.reset();
  accessStore.update((a) => {
    const next = { ...a };
    delete next[role];
    return next;
  });
}

/**
 * เมนูของบทบาทนี้ หลังหักที่ผู้ดูแลระบบปิดไว้
 * ในคอมโพเนนต์ให้ส่ง access/route จาก hook มาด้วย ตอน hydrate จะได้ตรงกับฝั่งเซิร์ฟเวอร์
 */
export function navItems(
  role: Role,
  access: MenuAccess = accessStore.get(),
  route?: ApprovalRoute,
  /** ประเภทการจ้างของคนที่ล็อกอินอยู่ — ตัดเมนู "ของฉัน" ที่ไม่เกี่ยวกับคนนั้นออก */
  empType?: MineEmpType,
): NavItem[] {
  const hidden = new Set(access[role] ?? []);
  const { work: all, group, approvalsAfter } = BY_ROLE[role];
  /* ตำแหน่งที่แทรก "รายการรออนุมัติ" — นับจากเมนูเต็ม เมนูที่ถูกปิดไม่ทำให้ตำแหน่งเลื่อน */
  const at = approvalsAfter ? all.findIndex((i) => i.href === approvalsAfter) + 1 : all.length;
  const shown = (i: NavItem) => !hidden.has(i.href);
  const approves = role !== "ceo" && approvesFor(role, route).length > 0;
  const approvals: NavItem[] = approves ? [{ ...APPROVALS_ITEM, group }] : [];
  /* บทบาทฝึกงานใช้ชุดของฝึกงานเสมอ ไม่ว่าทะเบียนจะบันทึกประเภทการจ้างไว้อย่างไร */
  const mine = NO_MINE.includes(role) ? [] : mineFor(role === "intern" ? "intern" : empType).filter(shown);
  return [...all.slice(0, at || all.length).filter(shown), ...approvals, ...all.slice(at || all.length).filter(shown), ...mine];
}

/**
 * เมนูของคนที่ควบหลายบทบาท — เอาเมนูของทุกบทบาทมาต่อกัน ไม่ให้ซ้ำ
 * เรียงตามลำดับบทบาทในบัญชี บทบาทแรกขึ้นก่อน
 */
export function navItemsOf(
  roles: Role[],
  access: MenuAccess = accessStore.get(),
  route?: ApprovalRoute,
  empType?: MineEmpType,
): NavItem[] {
  const seen = new Set<string>();
  return roles
    .flatMap((r) => navItems(r, access, route, empType))
    .filter((i) => (seen.has(i.href) ? false : seen.add(i.href)));
}

/** กลุ่มเมนูของทุกบทบาทที่ควบอยู่ — "ของฉัน" มีชุดเดียวและอยู่ท้ายสุดเสมอ */
export function navGroupsOf(roles: Role[]): NavGroup[] {
  const all = [...new Set(roles.flatMap(navGroups))];
  /*
   * กลุ่มงานขึ้นก่อน แล้วค่อยตั้งค่าและของฉันไว้ล่างสุดเสมอ (เจ้าของสั่ง 29 ก.ย. 2569)
   * คนที่ควบสองตำแหน่ง เช่น ฝ่ายบุคคล + บัญชี จะได้ไม่มีกลุ่มตั้งค่าคั่นกลางระหว่างงานสองฝ่าย
   */
  const last: NavGroup[] = ["ตั้งค่า", "ของฉัน"];
  const work = all.filter((g) => !last.includes(g));
  return [...work, ...last.filter((g) => all.includes(g))];
}

/** เข้าหน้านี้ได้ไหม เมื่อคนคนเดียวควบหลายบทบาท */
export function canVisitAny(
  pathname: string,
  roles: Role[],
  access?: MenuAccess,
  route?: ApprovalRoute,
  empType?: MineEmpType,
): boolean {
  return roles.some((r) => canVisit(pathname, r, access, route, empType));
}

export function navGroups(role: Role): NavGroup[] {
  if (role === "ceo") return ["ผู้บริหาร", "ภาพรวมระบบ"];
  /* ฝ่ายบุคคลดูแลการตั้งค่าระบบด้วย (Full Proposal · M5) จึงมีสามกลุ่ม */
  if (role === "hr") return ["ฝ่ายบุคคล", "ตั้งค่า", "ของฉัน"];
  return NO_MINE.includes(role) ? [BY_ROLE[role].group] : [BY_ROLE[role].group, "ของฉัน"];
}

/**
 * หน้าหลักการ์ดเมนูบนมือถือ — ผู้ใช้สั่ง 22 ก.ย. 2569 ให้ทุกบทบาทใช้แบบเดียวกับหน้าหลัก CEO (ceo-home.html)
 * CEO กับพนักงานคงที่อยู่เดิมตามต้นแบบของตัวเอง บทบาทอื่นใช้ /home
 */
export function mobileHomeOf(role: Role) {
  if (role === "ceo") return "/ceo/home";
  /* ฝึกงานใช้หน้าหลักการ์ดเมนูชุดเดียวกับทีมงาน (ผู้ใช้สั่ง 7 ต.ค. 2569) */
  if (role === "staff" || role === "intern") return "/my-home";
  return "/home";
}

/**
 * หน้าแรกหลังล็อกอิน — ปกติคือหน้าตอกบัตร ถ้าบทบาทนี้ไม่มีหน้าตอกบัตรไปเมนูแรกของตัวเอง
 * บนมือถือ (phone) CEO กับพนักงานมีหน้าหลักการ์ดเมนูของตัวเอง (ต้นแบบ ceo-home.html · my-home.html)
 */
export function homeOf(role: Role, access?: MenuAccess, route?: ApprovalRoute, phone = false) {
  if (phone) return mobileHomeOf(role);
  const items = navItems(role, access, route);
  return items.some((i) => i.href === "/") ? "/" : (items[0]?.href ?? "/profile");
}

/**
 * เมนูล่างบนมือถือของบทบาทที่ยังใช้เปลือกแบบเดิม — เอาเฉพาะหน้าที่เข้าบ่อยที่สุด 4 หน้า
 * ที่เหลือกดปุ่ม "อื่นๆ" แล้วเปิดเมนูเต็มเป็นลิ้นชัก
 *
 * "เวลาทำงาน" อยู่ช่องแรกทุกบทบาท เพราะทุกคนต้องตอกบัตรก่อนเริ่มงาน
 * พนักงานใช้เปลือกแบบใหม่ (แถบล่างสามช่อง) จึงไม่ได้อ่านตารางนี้
 */
const BOTTOM_HREFS: Record<Role, string[]> = {
  sales: ["/", "/leads", "/quotations", "/leave"],
  ps: ["/", "/presales-work", "/my-tasks", "/presales-schedule"],
  pm: ["/", "/pm/dashboard", "/pm/inbox", "/pm/projects"],
  acc: ["/", "/acc/dashboard", "/acc/billing", "/acc/receipts"],
  hr: ["/", "/hr/employees", "/hr/timesheet", "/hr/report"],
  staff: ["/", "/my-tasks", "/my-schedule", "/leave"],
  gm: ["/", "/gm/dashboard", "/pm/inbox", "/approvals"],
  ceo: ["/ceo/home", "/ceo/dashboard", "/ceo/approvals"],
  intern: ["/", "/my-tasks", "/my-schedule", "/leave"],
  maid: ["/", "/expense", "/leave", "/payslip"],
};

export function bottomNav(
  role: Role,
  access?: MenuAccess,
  route?: ApprovalRoute,
  empType?: MineEmpType,
): NavItem[] {
  const all = navItems(role, access, route, empType);
  return BOTTOM_HREFS[role]
    /* หน้านอกเมนูซ้ายที่ตั้งใจให้อยู่แถบล่าง เช่น หน้าหลักของ CEO บนมือถือ */
    .map((href) => all.find((item) => item.href === href) ?? EXTRA_PAGES[href])
    .filter((item): item is NavItem => Boolean(item));
}

/*
 * หน้าที่ไม่มีในเมนูซ้าย แต่ต้องมีชื่อและไอคอนบนแถบบน
 *
 * หน้าวางแผนงานกับหน้ารายละเอียดโปรเจคเข้าจากปุ่มในหน้าอื่น ไม่ได้เข้าจากเมนู
 * จึงไม่อยู่ในเมนูซ้าย แต่ยังต้องมีชื่อบนแถบบนตอนเปิดอยู่
 */
const EXTRA_PAGES: Record<string, NavItem> = {
  /* หน้ารวมผู้สนใจและใบเสนอราคาของมือถือ (ยกมาจากระบบต้นฉบับ) — จอคอมยังใช้สองเมนูเดิม */
  "/leads-quotes": {
    group: "งานขาย",
    label: "ผู้สนใจและใบเสนอราคา",
    icon: "quotation",
    href: "/leads-quotes",
    parent: "/quotations",
  },
  "/pm/plan": {
    group: "โปรเจค",
    label: "จัดคิวงาน",
    icon: "planboard",
    href: "/pm/plan",
    /* จัดคิวงานเป็นขั้นหนึ่งของโปรเจค (โฟลเดอร์ → รายละเอียด → จัดคิว) ตามต้นแบบ เมนูจึงค้างที่ "โปรเจค" */
    parent: "/pm/projects",
  },
  /* โปรเจคใหม่เข้าจากปุ่มในหน้ารายการโปรเจค เมนูจึงค้างที่ "โปรเจค" (ต้นแบบ project-new.html) */
  "/pm/projects/new": {
    group: "โปรเจค",
    label: "โปรเจคใหม่",
    icon: "project",
    href: "/pm/projects/new",
    parent: "/pm/projects",
  },
  "/hr/payroll": {
    group: "ฝ่ายบุคคล",
    label: "คำนวณเงินเดือน",
    icon: "commission",
    href: "/hr/payroll",
    parent: "/hr/timesheet",
  },
  "/hr/payslip": {
    group: "ฝ่ายบุคคล",
    label: "สลิปเงินเดือน",
    icon: "receipt",
    href: "/hr/payslip",
    parent: "/hr/timesheet",
  },
  "/hr/cycles": {
    group: "ฝ่ายบุคคล",
    label: "ประวัติรอบจ่าย",
    icon: "receipt",
    href: "/hr/cycles",
    parent: "/hr/timesheet",
  },
  /* ดีลของ CEO เข้าจากปุ่มในหน้างานขาย เมนูจึงค้างที่ "งานขาย" (ต้นแบบ ceo-deals.html) */
  "/ceo/deals": {
    group: "ภาพรวมระบบ",
    label: "ดีลและใบงาน",
    icon: "deals",
    href: "/ceo/deals",
    parent: "/ceo/sales",
  },
  /* หน้าหลักของ CEO มีเฉพาะบนมือถือ (ต้นแบบ ceo-home.html) — จอใหญ่เด้งไปแดชบอร์ด */
  "/ceo/home": {
    group: "ผู้บริหาร",
    label: "หน้าหลัก",
    icon: "home",
    href: "/ceo/home",
  },
  /* หน้าหลักของพนักงานมีเฉพาะบนมือถือ (ต้นแบบ my-home.html) — จอใหญ่เด้งไปเมนูแรก */
  "/my-home": {
    group: "งานของฉัน",
    label: "หน้าหลัก",
    icon: "home",
    href: "/my-home",
  },
  /* หน้าหลักการ์ดเมนูของบทบาทอื่นบนมือถือ — จอใหญ่เด้งไปเมนูแรก */
  "/home": {
    group: "ของฉัน",
    label: "หน้าหลัก",
    icon: "home",
    href: "/home",
  },
  "/profile": {
    group: "ของฉัน",
    label: "โปรไฟล์ของฉัน",
    icon: "user",
    href: "/profile",
  },
};

/*
 * หาว่าหน้าที่เปิดอยู่คือรายการไหน
 *
 * ค้นในเมนูของบทบาทตัวเองก่อน ไม่เจอค่อยค้นในเมนูของทุกบทบาท
 * เพราะหน้าต่าง ๆ ลิงก์ข้ามฝ่ายกันได้ เช่น บัญชีกดจากใบแจ้งหนี้ไปดูใบเสนอราคาของฝ่ายขาย
 * ถ้าไม่ค้นเผื่อ แถบบนจะขึ้นว่า "ERP MAZ" ลอย ๆ ทั้งที่อยู่ในหน้าที่มีชื่อ
 */
function matchIn(items: NavItem[], pathname: string) {
  return (
    items.find((item) => item.sub?.some((s) => s.href === pathname)) ??
    items.find((item) => item.href === pathname) ??
    /* ต้องตัดที่ "/" — ไม่งั้น /presales-work (ทีมก่อนการขาย) ไปติดเมนู /presales ของฝ่ายขาย */
    items.find((item) => item.href !== "/" && pathname.startsWith(item.href + "/"))
  );
}

/*
 * ที่อยู่เก่าที่ไม่อยู่ในเมนูแล้วแต่ยังต้องเปิดได้ — ถือสิทธิ์และชื่อหน้าเหมือนหน้าที่มันพาไป
 * /admin/roles รวมเข้า /admin/settings?s=positions แล้ว (ยกมาจากระบบต้นฉบับ)
 */
const MOVED: Record<string, string> = { "/admin/roles": "/admin/settings" };

/** หน้าที่ทุกบทบาทเปิดได้ นอกจากเมนูของตัวเอง */
/* /notify-test = หน้าทดสอบแจ้งเตือนบนมือถือ เปิดได้ทุกบทบาทโดยไม่ต้องอยู่ในเมนู (ชุดทดสอบ 2 ต.ค. 2569) */
const SHARED_PAGES = ["/profile", "/notifications", "/notify-test"];

/** หน้านอกเมนูที่เป็นของบทบาทใดบทบาทหนึ่ง */
const EXTRA_OWNER: Record<string, Role | Role[]> = {
  /* GM ใช้เมนูชุดเดียวกับ PM จึงเปิดหน้าจัดคิวงานได้ด้วย */
  "/pm/plan": ["pm", "gm", "ps"],
  "/hr/payroll": "hr",
  "/hr/payslip": "hr",
  "/hr/cycles": "hr",
  "/ceo/deals": "ceo",
  "/ceo/home": "ceo",
  "/my-home": ["staff", "intern"],
  "/leads-quotes": "sales",
  /* ทุกบทบาทเปิด /home ได้ — บทบาทที่มีหน้าหลักของตัวเอง (พนักงาน · CEO) ถูกพาไปหน้านั้นต่อ (HomePage) */
  "/home": ["sales", "ps", "pm", "acc", "hr", "gm", "staff", "ceo", "maid"],
};

/**
 * บทบาทนี้เปิดหน้านี้ได้ไหม — ใช้กันไม่ให้คลิกหรือพิมพ์ที่อยู่แล้วหลุดเข้าหน้าของบทบาทอื่น
 * เปิดได้เฉพาะเมนูของตัวเอง (รวมหน้าย่อยใต้เมนู เช่น /leads/<รหัส>) กลุ่ม "ของฉัน" และหน้ากลาง
 */
export function canVisit(
  pathname: string,
  role: Role,
  access?: MenuAccess,
  route?: ApprovalRoute,
  empType?: MineEmpType,
): boolean {
  pathname = MOVED[pathname] ?? pathname;
  if (SHARED_PAGES.includes(pathname)) return true;
  const owner = EXTRA_OWNER[pathname];
  if (owner) return Array.isArray(owner) ? owner.includes(role) : owner === role;
  return Boolean(matchIn(navItems(role, access, route, empType), pathname));
}

/*
 * ชื่อหน้าบนแถบบนไม่ขึ้นกับว่าเมนูถูกปิดหรือไม่ — ค้นจากเมนูทั้งหมดของทุกบทบาท
 * หน้าที่ถูกปิดยังต้องมีชื่อบนแถบบน ตอนขึ้นหน้าแจ้งว่าเข้าไม่ได้
 */
/**
 * ที่อยู่นี้มีหน้าอยู่จริงไหม (ตรวจระบบ 5 ต.ค. 2569 · BUG-004)
 * ใช้แยก "พิมพ์ที่อยู่ผิด ไม่มีหน้านี้" ออกจาก "มีหน้าแต่ไม่ใช่ของบทบาทนี้"
 * สองเรื่องนี้ผู้ใช้ต้องทำคนละอย่าง จะได้ไม่งงว่าตัวเองไม่มีสิทธิ์ทั้งที่พิมพ์ผิด
 */
export function isKnownPage(pathname: string) {
  return SHARED_PAGES.includes(pathname) || Boolean(findItem(pathname, "sales"));
}

export function findItem(pathname: string, role: Role): NavItem | undefined {
  pathname = MOVED[pathname] ?? pathname;
  const own = [...configurableItems(role), { ...APPROVALS_ITEM, group: BY_ROLE[role].group }];
  const everyRole = Object.values(BY_ROLE).flatMap((r) => r.work);
  return (
    EXTRA_PAGES[pathname] ??
    matchIn(own, pathname) ??
    matchIn([...everyRole, ...MINE], pathname)
  );
}

/** ชื่อบนแถบบน — ใช้ชื่อหน้าย่อยถ้ามี */
/* หน้าที่ไม่ได้อยู่ในเมนูแต่มีชื่อของตัวเอง (เปิดจากกระดิ่งหรือเมนูผู้ใช้) */
const PAGE_NAME: Record<string, string> = {
  "/notifications": "แจ้งเตือน",
  "/notify-test": "ทดสอบแจ้งเตือน",
  "/profile": "โปรไฟล์ของฉัน",
};

export function pageTitle(pathname: string, role: Role) {
  const named = PAGE_NAME[pathname];
  if (named) return named;
  const item = findItem(pathname, role);
  if (!item) return "ERP MAZ";
  const sub = item.sub?.find((s) => s.href === pathname);
  return sub ? (sub.title ?? sub.label) : item.label;
}
