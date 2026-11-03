/*
 * โปรไฟล์พนักงานที่ทุกหน้าอ่านร่วมกัน — แก้ที่หน้าโปรไฟล์แล้วเปลี่ยนทั้งระบบ
 * (เมนูมุมขวาบน ใบลา ใบเบิกค่าใช้จ่าย ฯลฯ)
 *
 * เก็บแยกตามบทบาท เพราะแต่ละบทบาทคือคนละคน — สลับบทบาทแล้วต้องได้โปรไฟล์ของคนนั้น
 * ไม่ใช่ชื่อของคนก่อนหน้าค้างอยู่
 *
 * ต่อฐานข้อมูลแล้วช่องที่ฝ่ายบุคคลเป็นเจ้าของ (ชื่อ ตำแหน่ง ฝ่าย หัวหน้า วันเริ่มงาน
 * ประเภทการจ้าง) อ่านจากฐานข้อมูลของคนที่ล็อกอินอยู่จริง — ดู supabase/me.ts
 * ส่วนช่องที่พนักงานแก้เองได้ (เบอร์ที่ทำงาน เบอร์ฉุกเฉิน) ยังเก็บในเครื่อง
 */

import { USERS } from "./mock-data";
import { HR_EMP, HR_EMPTYPE, hrDept, hrPos } from "./hr-data";
import { loadMe, meNow, subscribeMe, type Me } from "./supabase/me";
import { staffEmployeeId, subscribeStaffEmployee } from "./staff-identity";
import { psEmployeeId, subscribePsEmployee } from "./ps-identity";
import { createPersistedStore } from "./persisted-store";
import { currentRole, subscribeRole, type Role } from "./role";
import { useSyncExternalStore } from "react";

export type EmployeeProfile = {
  name: string;
  employeeId: string;
  position: string;
  department: string;
  supervisor: string;
  email: string;
  phone: string;
  /** เบอร์ที่ทำงาน และเบอร์ติดต่อฉุกเฉิน */
  officePhone: string;
  emergencyPhone: string;
  birth: string;
  startDate: string;
  employmentType: string;
  workSchedule: string;
};

type ProfileByRole = Record<Role, EmployeeProfile>;

function seed(role: Role): EmployeeProfile {
  return { ...USERS[role], officePhone: "", emergencyPhone: "", birth: "1996-11-24" };
}

/** ค่าตั้งต้นก่อนพนักงานแก้อะไร — มาจากข้อมูลจำลองชุดเดียวกับที่ใช้ทั้งระบบ */
export const DEFAULT_PROFILE: ProfileByRole = {
  sales: seed("sales"),
  ps: seed("ps"),
  pm: seed("pm"),
  acc: seed("acc"),
  hr: seed("hr"),
  staff: seed("staff"),
  gm: seed("gm"),
  ceo: seed("ceo"),
  intern: seed("intern"),
  maid: seed("maid"),
};

function isProfileByRole(value: unknown): value is ProfileByRole {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (["sales", "pm", "acc", "hr"] as const).every((role) => {
    const one = p[role] as Record<string, unknown> | undefined;
    return Boolean(one) && typeof one!.name === "string" && typeof one!.phone === "string";
  });
}


const store = createPersistedStore<ProfileByRole>(
  "maz-erp.profile.v3",
  DEFAULT_PROFILE,
  isProfileByRole,
);

/**
 * ฟิลด์ที่ฝ่ายบุคคลเป็นเจ้าของ พนักงานแก้เองไม่ได้ในหน้าโปรไฟล์
 * จึงต้องอ่านจากต้นทางเสมอ ไม่ใช่จากที่เก็บไว้ในเครื่อง
 * ไม่งั้นพอต้นทางแก้ (เช่น ย้ายฝ่าย) คนที่เคยเปิดแอปแล้วจะเห็นของเก่าค้างตลอดไป
 */
/** บทบาทที่ไม่ได้ผูกกับคนเดียว — คืนรหัสพนักงานที่เลือกไว้ ที่เหลือคืนค่าว่าง */
function pickedId(role: Role): string | null {
  if (role === "staff") return staffEmployeeId();
  /* ทีมก่อนการขายมี SA กับ BD (เจ้าของถาม 5 ต.ค. 2569 "แล้วของ BD ล่ะ") */
  if (role === "ps") return psEmployeeId();
  return null;
}

/*
 * ช่องที่มาจากฐานข้อมูลของคนที่ล็อกอินอยู่ — ไม่มีก็คืน null ให้ไปใช้ทางเดิม
 * บัญชีที่ไม่ใช่พนักงาน (ผู้บริหาร) ไม่มีตำแหน่งและฝ่าย จึงเว้นว่างไว้
 */
/* จำผลไว้ตามตัว Me ที่อ่านได้ — useSyncExternalStore ต้องได้วัตถุอ้างอิงเดิม
   ถ้าสร้างใหม่ทุกครั้งที่อ่าน React จะวนวาดไม่จบ (เจอจริงตอนต่อโปรไฟล์ 2 พ.ย. 2569) */
let fromMe: Me | null = null;
let fromMeOut: DbProfile = null;

type DbProfile = {
  name: string;
  employeeId: string;
  position: string;
  department: string;
  supervisor: string;
  startDate: string;
  employmentType: string;
  email: string;
  phone: string;
  birth: string;
} | null;

function fromDb(): DbProfile {
  loadMe();
  const me = meNow();
  if (me === fromMe) return fromMeOut;
  fromMe = me;
  fromMeOut = me ? build(me) : null;
  return fromMeOut;
}

function build(me: Me): DbProfile {
  const pos = me.pos ? hrPos(me.pos) : null;
  return {
    name: me.name,
    employeeId: me.empNo,
    position: pos ? hrPos(me.pos).label : "",
    department: pos ? hrDept(pos.dept).label : "",
    supervisor: me.bossName
      ? `${me.bossName}${me.bossPos ? ` (${hrPos(me.bossPos).label})` : ""}`
      : "",
    startDate: me.startDate,
    employmentType: me.type ? HR_EMPTYPE[me.type].label : "",
    email: me.email,
    phone: me.phone,
    birth: me.birth,
  };
}

function hrOwned(role: Role) {
  /*
   * บทบาท "พนักงาน" ไม่ได้ผูกกับคนเดียว — มีหลายตำแหน่ง (SA · Dev · Graphic · Content · Website · Media · BD)
   * ชื่อกับตำแหน่งจึงมาจากคนที่เลือกไว้ในทะเบียนฝ่ายบุคคล ไม่ใช่ค่าตายตัวใน USERS (เจ้าของสั่ง 29 ก.ย. 2569)
   */
  if (role === "staff" || role === "ps") {
    const e = HR_EMP.find((x) => x.id === pickedId(role));
    if (e) {
      const boss = HR_EMP.find((x) => x.id === e.boss);
      return {
        employeeId: e.id,
        position: hrPos(e.pos).label,
        department: hrDept(hrPos(e.pos).dept).label,
        supervisor: boss ? `${boss.name} (${hrPos(boss.pos).label})` : "",
        startDate: e.startedAt,
        employmentType: HR_EMPTYPE[e.type].label,
        workSchedule: USERS[role].workSchedule,
      };
    }
  }
  const u = USERS[role];
  return {
    employeeId: u.employeeId,
    position: u.position,
    department: u.department,
    supervisor: u.supervisor,
    startDate: u.startDate,
    employmentType: u.employmentType,
    workSchedule: u.workSchedule,
  };
}

/* useSyncExternalStore ต้องได้อ็อบเจ็กต์ตัวเดิมถ้าข้อมูลไม่เปลี่ยน
   ถ้า merge ใหม่ทุกครั้งที่อ่าน React จะวนเรนเดอร์ไม่จบ — จึงจำผลไว้ */
let seenAll: ProfileByRole | null = null;
let seenRole: Role | null = null;
let merged: EmployeeProfile = { ...DEFAULT_PROFILE.sales, ...hrOwned("sales") };

let seenStaff: string | null = null;

function pick(all: ProfileByRole, role: Role): EmployeeProfile {
  /* พนักงานสลับคนได้ จึงต้องคิดใหม่เมื่อคนเปลี่ยนด้วย ไม่ใช่เฉพาะตอนสลับบทบาท */
  const staffId = pickedId(role);
  if (all !== seenAll || role !== seenRole || staffId !== seenStaff) {
    seenAll = all;
    seenRole = role;
    seenStaff = staffId;
    const e = staffId ? HR_EMP.find((x) => x.id === staffId) : undefined;
    /* เครื่องที่เก็บโปรไฟล์ไว้ก่อนมีบทบาทใหม่จะไม่มีก้อนของบทบาทนั้น — เติมจากค่าตั้งต้น */
    merged = {
      ...DEFAULT_PROFILE[role],
      ...all[role],
      /* สลับคนแล้วชื่อและช่องทางติดต่อต้องเป็นของคนนั้น ไม่ใช่ของคนก่อนหน้าที่ค้างอยู่ในเครื่อง */
      ...(e ? { name: e.name, email: e.email, phone: e.phone, birth: e.birth } : {}),
      ...hrOwned(role),
    };
  }
  return merged;
}

/*
 * ผสมของจริงจากฐานข้อมูลทับโปรไฟล์ในเครื่อง
 *
 * แยกออกมาจาก pick() เพราะค่านี้มีแต่ฝั่งเบราว์เซอร์ ฝั่งเซิร์ฟเวอร์ไม่มี
 * ถ้าใส่ไปใน snapshot ตรง ๆ หน้าที่วาดช้ากว่า (อยู่ใน Suspense) จะ hydrate
 * ด้วยค่าที่ไม่ตรงกับ HTML ที่เซิร์ฟเวอร์ส่งมา — React เตือนและวาดทั้งกิ่งใหม่
 * จึงให้ useProfile() เป็นคนผสม หลังรู้แล้วว่าวาดอยู่ฝั่งเบราว์เซอร์
 */
let overAll: EmployeeProfile | null = null;
let overFrom: EmployeeProfile | null = null;
let overDb: DbProfile = null;

function withDb(local: EmployeeProfile): EmployeeProfile {
  const db = fromDb();
  if (!db) return local;
  if (overAll && overFrom === local && overDb === db) return overAll;
  overFrom = local;
  overDb = db;
  /* เว้นช่องที่ฐานข้อมูลยังไม่มีค่า ให้ของเดิมอยู่ต่อ */
  overAll = {
    ...local,
    ...Object.fromEntries(Object.entries(db).filter(([, v]) => v !== "" && v !== null)),
  };
  return overAll;
}

const getMerged = () => pick(store.get(), currentRole());
const getMergedServer = () => pick(store.getServer(), "sales");

/* วาดอยู่ฝั่งเบราว์เซอร์แล้วหรือยัง — ตอน hydrate React ใช้ค่าของฝั่งเซิร์ฟเวอร์ (false)
   แล้วค่อยวาดใหม่ด้วย true ให้เอง จึงไม่มีการเตือนว่า HTML ไม่ตรงกัน */
const noSub = () => () => {};
const onClient = () => true;
const onServer = () => false;

/* โปรไฟล์เปลี่ยนได้สองทาง — แก้ข้อมูลเอง หรือสลับบทบาท จึงต้องฟังทั้งคู่ */
function subscribeBoth(onChange: () => void) {
  const off = [
    store.subscribe(onChange),
    subscribeRole(onChange),
    subscribeStaffEmployee(onChange),
    subscribePsEmployee(onChange),
    subscribeMe(onChange),
  ];
  return () => off.forEach((fn) => fn());
}

export function useProfile() {
  const hydrated = useSyncExternalStore(noSub, onClient, onServer);
  const local = useSyncExternalStore(subscribeBoth, getMerged, getMergedServer);
  return hydrated ? withDb(local) : local;
}

/** อ่านนอก React เช่นตอนบันทึกใบลา */
export function currentProfile() {
  return withDb(getMerged());
}

export function saveProfile(patch: Partial<EmployeeProfile>) {
  const role = currentRole();
  store.update((all) => ({ ...all, [role]: { ...DEFAULT_PROFILE[role], ...all[role], ...patch } }));
}

export function resetProfile() {
  store.reset();
}
