"use client";

/*
 * สโตร์ของฝ่ายบุคคล — พนักงาน เวลาทำงาน รอบเงินเดือน และสลิป
 *
 * รวมไว้สโตร์เดียวเพราะสี่หน้านี้เดินต่อกันเป็นสาย
 * ปิดรอบเวลาทำงาน → คำนวณเงินเดือน → สร้างสลิป → เผยแพร่
 * ถ้าแยกสโตร์ ด่านกันข้ามขั้นจะต้องอ่านข้ามสโตร์กันไปมาทุกหน้า
 *
 * ต่อฐานข้อมูลแล้วย้ายมาทีละส่วน — ส่วนที่ย้ายแล้วจะทับค่าในเครื่องตอนอ่าน
 * ตอนนี้: รอบเวลาทำงาน (periods) อ่านจากตาราง pay_periods แล้ว
 * ที่เหลือ (ทะเบียนพนักงาน รอบเงินเดือน สลิป) ยังอยู่ใน localStorage ของเครื่องที่เปิดอยู่
 */

import { useSyncExternalStore } from "react";
import {
  HR_EMP,
  HR_EXTRA,
  HR_PAYRUN,
  HR_PAYSLIP,
  HR_PERIOD,
  HR_TIME,
  HR_INTERN_LEAVE,
  HR_PAYAPPROVE,
  ROLE_EMPLOYEE,
  accountRoles,
  rolesOfEmployee,
  rolesOfPosition,
  HR_MAX_ROLES,
  payApproveKey,
  fillPeriod,
  withLoginAccounts,
  fillSlip,
  hrCycle,
  type CycleSum,
  type PayGroup,
  type PosKey,
  type EmpType,
  type Employee,
  type Extra,
  type Period,
  type Slip,
  type TimeRec,
  type InternLeave,
  type PayApproval,
  closedIn,
} from "./hr-data";
import { isWorkday } from "./holidays";
import { bkkStamp, parseIsoDate, toIsoDate, todayIso } from "./format";
import { requirePasswordReset, restoreAccount, suspendAccount } from "./accounts";
import { refreshRecords } from "./attendance-store";
import { createPersistedStore } from "./persisted-store";
import type { Role } from "./role";
import { hasBackend } from "./supabase/env";
import {
  PERIOD_REASON,
  blankPeriods,
  closePeriodRemote,
  fetchPeriods,
  reopenPeriodRemote,
} from "./supabase/periods";
import {
  EMP_REASON,
  addSalaryStep,
  createEmployee,
  fetchEmployees,
  saveEmployee,
} from "./supabase/employees";
import { forgetPeople } from "./supabase/people";
import {
  REVIEW_REASON,
  fetchAdjusts,
  fetchExtras,
  fetchReviews,
  fetchTimeEdits,
  fillPunch,
  saveExtraRemote,
  saveReview,
  saveTimeEdit,
  type Review,
  type TimeEdit,
} from "./supabase/hr-review";
import {
  PAYRUN_REASON,
  closePayrunRemote,
  decidePayrollRemote,
  fetchPayApprovals,
  fetchPayruns,
  fetchSlips,
  publishSlipsRemote,
  reopenPayrunRemote,
  sendPayroll,
  unpublishSlipsRemote,
} from "./supabase/payrun";

export type HrState = {
  emp: Employee[];
  time: Record<string, TimeRec>;
  /** รอบเวลาทำงาน — ปิดแล้วตัวเลขเวลาถูกล็อก */
  periods: Period[];
  /** รอบคำนวณเงินเดือน — ปิดได้ต่อเมื่อรอบเวลาทำงานของเดือนนั้นปิดแล้ว */
  payruns: Period[];
  slips: Slip[];
  extras: Record<string, Record<string, Extra>>;
  /** ใบลาของนักศึกษาฝึกงาน — ฝ่ายบุคคลอนุมัติเอง */
  internLeave: InternLeave[];
  /** CEO อนุมัติยอดเงินเดือน แยกรอบและกลุ่ม (คีย์ month|group) */
  payApprove: Record<string, PayApproval>;
};

const INITIAL: HrState = {
  emp: withLoginAccounts(HR_EMP),
  time: HR_TIME,
  periods: HR_PERIOD,
  payruns: HR_PAYRUN,
  slips: HR_PAYSLIP,
  extras: HR_EXTRA,
  internLeave: HR_INTERN_LEAVE,
  payApprove: HR_PAYAPPROVE,
};

function isHrState(value: unknown): value is HrState {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    Array.isArray(s.emp) &&
    Array.isArray(s.periods) &&
    Array.isArray(s.payruns) &&
    Array.isArray(s.slips) &&
    typeof s.time === "object" &&
    typeof s.extras === "object"
  );
}

/*
 * เครื่องที่เคยเปิดหน้าฝ่ายบุคคลแล้วมีรายชื่อพนักงานเก็บไว้ชุดเก่า
 * คนที่เพิ่มเข้าชุดตั้งต้นทีหลัง (E18–E20) จะไม่โผล่ ถ้าไม่เติมให้ตรงนี้
 * เติมเฉพาะรหัสที่ยังไม่มี คนเดิมที่ถูกแก้ไว้ (ย้ายประเภท ฯลฯ) ไม่ถูกทับ
 */
function addNewStaff(s: HrState): HrState {
  const have = new Set(s.emp.map((e) => e.id));
  const missing = HR_EMP.filter((e) => !have.has(e.id));
  const added = missing.length ? { ...s, emp: [...s.emp, ...missing] } : s;
  /* ERD เพิ่มตำแหน่ง sales — ผู้ขายที่ล็อกอินได้เคยถูกบันทึกเป็น bd ย้ายให้ตรง ไม่งั้นไม่ได้ค่าคอม */
  const seller = ROLE_EMPLOYEE.sales;
  const withStaff = {
    ...added,
    emp: added.emp.map((e) =>
      e.id === seller && e.pos === "bd"
        ? { ...e, pos: "sales", history: e.history.map((h) => (h.pos === "bd" ? { ...h, pos: "sales" } : h)) }
        : e,
    ),
  };
  /*
   * เครื่องที่เก็บทะเบียนไว้ก่อน 29 ก.ย. 2569 ยังมีตำแหน่งรวม "บัญชีและบุคคล" (account_hr)
   * ซึ่งถูกแยกเป็นบัญชีกับฝ่ายบุคคลแล้ว — ย้ายให้ตรงกับทะเบียนใหม่ ไม่งั้นหน้าจอโชว์ชื่อคีย์ดิบ
   * และบทบาทของบัญชีนั้นจะค้างเป็นของตำแหน่งเดิม
   */
  const splitAccHr = {
    ...withStaff,
    emp: withStaff.emp.map((e) => {
      if (e.pos !== ("account_hr" as PosKey)) return e;
      const now = HR_EMP.find((x) => x.id === e.id);
      const pos = (now?.pos ?? "hr") as PosKey;
      return {
        ...e,
        pos,
        posMore: now?.posMore ?? e.posMore,
        history: e.history.map((h) => (h.pos === ("account_hr" as PosKey) ? { ...h, pos } : h)),
        /* บทบาทตั้งใหม่ตามตำแหน่งจริง — ของเดิมเป็นชุดของตำแหน่งรวมที่ไม่มีแล้ว */
        account: e.account ? { ...e.account, roles: rolesOfPosition(pos) } : e.account,
      };
    }),
  };
  /* ข้อมูลที่เก็บไว้ก่อนแยกกลุ่มปิดรอบ ยังไม่มีช่องของกลุ่มรายวัน เติมให้ครบก่อนใช้ */
  return {
    ...splitAccHr,
    emp: withLoginAccounts(splitAccHr.emp),
    periods: splitAccHr.periods.map(fillPeriod),
    payruns: splitAccHr.payruns.map(fillPeriod),
    slips: splitAccHr.slips.map(fillSlip),
    /* ข้อมูลที่เก็บไว้ก่อนมีใบลาฝึกงานและการอนุมัติของ CEO */
    internLeave: splitAccHr.internLeave ?? HR_INTERN_LEAVE,
    payApprove: splitAccHr.payApprove ?? HR_PAYAPPROVE,
  };
}

const store = createPersistedStore<HrState>("maz-erp.hr.v3", INITIAL, isHrState, addNewStaff);

/* ─── รอบเวลาทำงานจากฐานข้อมูล ─────────────────────────────────────
 * useSyncExternalStore ต้องได้คำตอบทันที รอ await ไม่ได้ ครั้งแรกจึงคืน
 * รายการเดือนเปล่า (ยังไม่มีรอบไหนปิด) แล้วสั่งโหลดไว้ พอข้อมูลมาถึงก็บอกให้วาดใหม่
 *
 * ค่าตั้งต้นต้องเป็น "ว่างจริง" ห้ามใช้รอบจำลอง ไม่งั้นหน้าจอจะโชว์ว่ารอบ ก.ค.–ส.ค.
 * ปิดแล้วทั้งที่ฐานข้อมูลไม่มี แล้วแก้เวลาทำงานของรอบนั้นไม่ได้โดยไม่มีใครรู้สาเหตุ
 */
const live = hasBackend;
const BLANK_PERIODS: Period[] = live ? blankPeriods() : [];
/* ทะเบียนว่างจริงตอนยังอ่านไม่เสร็จ — ห้ามใช้ทะเบียนจำลอง ไม่งั้นหน้าจอจะโชว์คนที่ไม่มีในระบบ */
const BLANK_EMP: Employee[] = [];
let remote: Period[] | null = null;
let loadingPeriods = false;
let people: Employee[] | null = null;
let loadingPeople = false;
let runs: Period[] | null = null;
let approvals: Record<string, PayApproval> | null = null;
let slips: Slip[] | null = null;
let loadingPay = false;
const watchers = new Set<() => void>();

function tell() {
  for (const fn of watchers) fn();
}

function loadPeriods() {
  if (!live || loadingPeriods || remote !== null) return;
  loadingPeriods = true;
  void fetchPeriods()
    .then((list) => {
      remote = list;
    })
    .catch(() => {
      /* อ่านไม่ได้ — ให้เป็นรายการเปล่าไว้ก่อน ไม่ปล่อยเป็น null ไม่งั้นจะวนยิงใหม่ไม่จบ */
      remote = blankPeriods();
    })
    .finally(() => {
      loadingPeriods = false;
      tell();
    });
}

/*
 * ทะเบียนพนักงานจากฐานข้อมูล
 *
 * เจ้าของสั่ง 2 พ.ย. 2569 ว่าทะเบียนจริงอยู่ที่ฐานข้อมูลที่เดียว
 * ทะเบียนจำลองที่เคยอยู่ในหน้าจอถูกย้ายไปเป็นข้อมูลทดสอบของฐานข้อมูลแล้ว
 * (supabase/seed.sql ชุด T01–T19 ติดธง is_demo)
 */
function loadPeople() {
  if (!live || loadingPeople || people !== null) return;
  loadingPeople = true;
  void fetchEmployees()
    .then((list) => {
      people = list;
    })
    .catch(() => {
      people = BLANK_EMP;
    })
    .finally(() => {
      loadingPeople = false;
      tell();
    });
}

/*
 * รอบจ่าย การอนุมัติของ CEO และสลิป — อ่านพร้อมกันเพราะอยู่หน้าเดียวกัน
 * และต้องเห็นตรงกันเสมอ (ยอดที่ CEO อนุมัติ = ยอดที่ปิดรอบ = ยอดบนสลิป)
 */
function loadPay() {
  if (!live || loadingPay || runs !== null) return;
  loadingPay = true;
  void Promise.all([fetchPayruns(), fetchPayApprovals(), fetchSlips()])
    .then(([a, b, c]) => {
      runs = a;
      approvals = b;
      slips = c;
    })
    .catch(() => {
      runs = BLANK_PERIODS;
      approvals = {};
      slips = [];
    })
    .finally(() => {
      loadingPay = false;
      tell();
    });
}

/** สั่งอ่านรอบจ่ายใหม่ — เรียกหลังส่งให้ CEO ปิดรอบ หรือออกสลิป */
export function refreshPayruns() {
  if (!live) return;
  runs = null;
  approvals = null;
  slips = null;
  loadPay();
}

/** สั่งอ่านรอบเวลาทำงานใหม่ — เรียกหลังปิดหรือเปิดรอบ */
function refreshPeriods() {
  if (!live) return;
  remote = null;
  loadPeriods();
}

/** สั่งอ่านทะเบียนใหม่ — เรียกหลังฝ่ายบุคคลเพิ่มหรือแก้พนักงาน */
export function refreshEmployees() {
  if (!live) return;
  people = null;
  forgetPeople();
  loadPeople();
}

/* ประกอบร่างแล้วจำไว้ — useSyncExternalStore ต้องได้วัตถุอ้างอิงเดิมถ้าข้อมูลไม่เปลี่ยน
   ไม่งั้นจะวาดใหม่ไม่จบ (snapshot ไม่เท่าเดิมทุกครั้งที่อ่าน) */
let shown: HrState | null = null;
let fromState: HrState | null = null;
let fromPeriods: Period[] | null = null;
let fromPeople: Employee[] | null = null;

let fromRuns: Period[] | null = null;
let fromReviews: Review[] | null = null;
let fromExtras: Record<string, Record<string, Extra>> | null = null;

/*
 * ผลการตรวจเวลาทำงาน และเงินเพิ่ม/เงินหักรายคน — ย้ายขึ้นฐานข้อมูลแล้ว (รอบที่ 19)
 * ของเดิมอยู่ในเครื่องของฝ่ายบุคคลที่เปิดหน้าอยู่ อีกเครื่องจึงเห็นไม่ตรงกัน
 * ทั้งที่สองเรื่องนี้เป็นตัวตั้งของเงินที่จ่ายจริง
 */
let reviews: Review[] | null = null;
let edits: TimeEdit[] | null = null;
let loadingReviews = false;

function loadReviews() {
  if (!live || loadingReviews || reviews !== null) return;
  loadingReviews = true;
  void Promise.all([fetchReviews(), fetchTimeEdits()])
    .then(([list, editList]) => {
      reviews = list;
      edits = editList;
    })
    .catch(() => {
      reviews = [];
      edits = [];
    })
    .finally(() => {
      loadingReviews = false;
      tell();
    });
}

const NO_EDITS: TimeEdit[] = [];

/** รายการแก้ตัวเลขเวลาของฝ่ายบุคคล — หน้าที่คิดเวลาเองเอาไปทาบ */
export function useTimeEdits(): TimeEdit[] {
  return useSyncExternalStore(
    subscribe,
    () => {
      loadReviews();
      return edits ?? NO_EDITS;
    },
    () => NO_EDITS,
  );
}

/** เงินเพิ่มของทุกเดือนที่โหลดมาแล้ว — โหลดแยกรายเดือนตามที่หน้าจอขอ */
let extraMonths: Record<string, Record<string, Extra>> = {};
const askedExtras = new Set<string>();

function loadExtras(month: string) {
  if (!live || !month || askedExtras.has(month)) return;
  askedExtras.add(month);
  void Promise.all([fetchExtras(month), fetchAdjusts(month)])
    .then(([list, adjusts]) => {
      const out: Record<string, Extra> = {};
      for (const r of list) out[r.emp] = { incentive: r.incentive, allowance: r.allowance, adjust: [] };
      for (const a of adjusts) {
        out[a.emp] ??= { incentive: 0, allowance: 0, adjust: [] };
        out[a.emp].adjust.push({ amt: a.amount, why: a.why });
      }
      extraMonths = { ...extraMonths, [month]: out };
    })
    .catch(() => {
      extraMonths = { ...extraMonths, [month]: {} };
    })
    .finally(tell);
}

const NO_REVIEWS: Review[] = [];

/** ผลการตรวจทั้งหมดจากฐานข้อมูล — หน้าจอที่สร้างรายการต้องตรวจเองเอาไปทาบ */
export function useReviews(): Review[] {
  return useSyncExternalStore(
    subscribe,
    () => {
      loadReviews();
      return reviews ?? NO_REVIEWS;
    },
    () => NO_REVIEWS,
  );
}

/** สั่งอ่านใหม่หลังฝ่ายบุคคลบันทึก */
function refreshReviews() {
  reviews = null;
  edits = null;
  loadReviews();
}

function refreshExtras(month: string) {
  askedExtras.delete(month);
  loadExtras(month);
}

/* ผลการตรวจจากฐานข้อมูลทับของในเครื่อง — ฐานข้อมูลเป็นเจ้าของค่า */
function withReviews(s: HrState): HrState {
  if (!reviews?.length) return s;
  const byEmp = new Map<string, Review[]>();
  for (const r of reviews) {
    const list = byEmp.get(r.emp) ?? [];
    list.push(r);
    byEmp.set(r.emp, list);
  }
  const time = { ...s.time };
  for (const [emp, list] of byEmp) {
    const rec = time[emp];
    if (!rec) continue;
    time[emp] = {
      ...rec,
      issues: rec.issues.map((x) => {
        const hit = list.find((r) => r.day === x.d);
        return hit ? { ...x, note: hit.note, absent: hit.absent } : x;
      }),
    };
  }
  return { ...s, time };
}

function snapshot(): HrState {
  const s = store.get();
  if (!live) return s;
  loadPeriods();
  loadPeople();
  loadPay();
  loadReviews();
  const periods = remote ?? BLANK_PERIODS;
  const emp = people ?? BLANK_EMP;
  const payruns = runs ?? BLANK_PERIODS;
  if (
    shown === null ||
    fromState !== s ||
    fromPeriods !== periods ||
    fromPeople !== emp ||
    fromRuns !== payruns ||
    fromReviews !== reviews ||
    fromExtras !== extraMonths
  ) {
    fromState = s;
    fromPeriods = periods;
    fromPeople = emp;
    fromRuns = payruns;
    fromReviews = reviews;
    fromExtras = extraMonths;
    shown = withReviews({
      ...s,
      periods,
      emp,
      payruns,
      payApprove: approvals ?? {},
      slips: slips ?? [],
      extras: { ...s.extras, ...extraMonths },
    });
  }
  return shown;
}


function subscribe(onChange: () => void) {
  watchers.add(onChange);
  const off = store.subscribe(onChange);
  return () => {
    watchers.delete(onChange);
    off();
  };
}

/*
 * ฝั่งเซิร์ฟเวอร์และตอน hydrate ครั้งแรกต้องได้รายการเดือนชุดเดียวกับที่ฐานข้อมูลจะให้
 * ไม่ใช่รอบจำลอง — ไม่งั้นหน้าจอตั้งเดือนที่เลือกไว้จากรายการจำลอง (ก.ค.–ก.ย.)
 * แล้ว ?m= ของเดือนปัจจุบันจะถูกปัดทิ้ง เพราะตอนนั้นยังไม่มีเดือนนี้ในรายการ
 */
const SERVER_STATE: HrState = live
  ? {
      ...store.getServer(),
      periods: BLANK_PERIODS,
      emp: BLANK_EMP,
      payruns: BLANK_PERIODS,
      payApprove: {},
      slips: [],
    }
  : store.getServer();

const getServerState = () => SERVER_STATE;

export function useHr() {
  return useSyncExternalStore(subscribe, snapshot, getServerState);
}

/** อ่านนอก React — พนักงานของ PM ซิงก์จากทะเบียนชุดเดียวกันนี้ (ERD HR-BR-19, ดู pm-store) */
export function hrSnapshot() {
  return snapshot();
}

export const subscribeHr = subscribe;

export function resetHr() {
  store.reset();
  refreshPeriods();
  refreshEmployees();
}

/** ผู้ใช้ที่ล็อกอินเป็นฝ่ายบุคคล — ยังไม่มี auth จริงจึงตรึงไว้ที่คนเดียว */
export const HR_ME = "E12";

// ─── ข้อมูลพนักงาน ────────────────────────────────────────────────

/**
 * เปลี่ยนประเภทการจ้าง — ฝึกงาน / ทดลองงาน / พนักงานประจำ
 *
 * บันทึกเป็นประวัติแถวใหม่ ไม่ใช่แก้แถวเดิม เพราะวันที่มีผลคือวันที่ HR สั่ง
 * ไม่ใช่วันที่เริ่มงาน ถ้าทับแถวเดิมจะไม่เหลือหลักฐานว่าเคยเป็นอะไรมาก่อน
 *
 * เงินเดือนยกมาจากแถวล่าสุด เพราะการเปลี่ยนประเภทไม่ได้แปลว่าเงินเดือนเปลี่ยน
 * ถ้าจะปรับต้องเป็นคำสั่งแยกอีกใบ
 */
export async function changeEmpType(
  id: string,
  type: EmpType,
  today: string,
  note: string,
): Promise<EmpResult> {
  if (live) {
    const now = snapshot().emp.find((e) => e.id === id);
    if (!now || now.type === type) return { ok: true };
    const last = now.history[now.history.length - 1];
    /* ประเภทการจ้างเปลี่ยน แต่เงินเดือนยกมาจากแถวล่าสุด — ต่อประวัติอีกแถวไว้เป็นหลักฐาน */
    const step = await addSalaryStep(
      id,
      { at: today, pos: now.pos, salary: last?.salary ?? 0, note },
      false,
    );
    if (!step.ok) return { ok: false, message: empSay(step.reason) };
    const res = await saveEmployee(id, { type });
    refreshEmployees();
    return res.ok ? { ok: true } : { ok: false, message: empSay(res.reason) };
  }
  store.update((s) => ({
    ...s,
    emp: s.emp.map((e) => {
      if (e.id !== id || e.type === type) return e;
      const last = e.history[e.history.length - 1];
      return {
        ...e,
        type,
        history: [...e.history, { at: today, pos: e.pos, salary: last.salary, note }],
      };
    }),
  }));
  return { ok: true };
}

/**
 * บันทึกผ่านทดลองงาน (HR-06 S-4) — เปลี่ยนเป็นพนักงานประจำพร้อมเงินเดือนใหม่ตั้งแต่วันที่มีผล
 *
 * ต่างจาก changeEmpType ตรงที่ต้องให้ HR ระบุเงินเดือนเอง ห้ามยกตัวเลขเดิมมาใช้ต่อ
 * เพราะตัวเลขเดิมของคนทดลองงานเป็นฐานของอัตรารายวัน คนละความหมายกับเงินเดือนรายเดือน
 */
export async function passProbation(id: string, at: string, salary: number): Promise<EmpResult> {
  if (live) {
    const now = snapshot().emp.find((e) => e.id === id);
    if (!now || now.type !== "probat") return { ok: true };
    const step = await addSalaryStep(
      id,
      { at, pos: now.pos, salary, note: "ผ่านทดลองงาน เปลี่ยนเป็นจ่ายรายเดือน" },
      false,
    );
    if (!step.ok) return { ok: false, message: empSay(step.reason) };
    const res = await saveEmployee(id, { type: "full" });
    refreshEmployees();
    return res.ok ? { ok: true } : { ok: false, message: empSay(res.reason) };
  }
  store.update((s) => ({
    ...s,
    emp: s.emp.map((e) =>
      e.id !== id || e.type !== "probat"
        ? e
        : {
            ...e,
            type: "full" as const,
            history: [
              ...e.history,
              { at, pos: e.pos, salary, note: "ผ่านทดลองงาน เปลี่ยนเป็นจ่ายรายเดือน" },
            ],
          },
    ),
  }));
  return { ok: true };
}

/** ข้อมูลที่แก้ทับได้ตรง ๆ — ไม่กระทบตัวเลขเงินเดือนย้อนหลัง จึงไม่ต้องเก็บเป็นประวัติ */
/**
 * เพิ่มพนักงานใหม่ (ตามต้นแบบ hr-employees.html)
 *
 * คนเข้าใหม่เริ่มที่ "ทดลองงาน" เสมอ HR เป็นคนเปลี่ยนเป็นพนักงานประจำเมื่อผ่านเกณฑ์ (BR ของ HR-06)
 * เงินเดือนที่กรอกลงเป็นประวัติแถวแรกพร้อมวันที่มีผล ไม่เขียนทับภายหลัง
 */
export async function addEmployee(
  input: Omit<Employee, "id" | "status" | "history"> & { salary: number },
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  if (live) {
    /* รอบที่ปิดแล้วไม่รับคนเพิ่ม — กันที่นี่เหมือนเดิม ฐานข้อมูลยังไม่รู้เรื่องรอบเงินเดือน */
    const lock = lockedUntil(snapshot());
    if (lock && input.startedAt <= lock) {
      return { ok: false, message: `รอบเงินเดือนถึง ${lock} ปิดแล้ว เพิ่มคนย้อนหลังไม่ได้` };
    }
    const res = await createEmployee(input);
    refreshEmployees();
    return res.ok ? { ok: true, id: res.empNo } : { ok: false, message: empSay(res.reason) };
  }

  const { salary, ...rest } = input;
  /** คืนรหัสของคนที่เพิ่ม — หน้ารายชื่อใช้เลื่อนไปหาคนนั้น (ต้นแบบ scrollIntoView) */
  let added = "";
  store.update((s) => {
    /* รอบที่ปิดแล้วไม่รับคนเพิ่มไม่ว่ากรณีใด (ผู้ใช้กำหนด 23 ก.ย. 2569)
       คนเข้าใหม่ย้อนหลังจริงให้จ่ายเป็นรายการปรับปรุงในรอบถัดไป — หน้าจอกันไว้แล้ว กันซ้ำที่นี่อีกชั้น */
    const lock = lockedUntil(s);
    if (lock && rest.startedAt <= lock) return s;
    /* รหัสถัดจากเลขที่มากที่สุด ไม่ใช้จำนวนแถว เพราะพนักงานที่พ้นสภาพยังอยู่ในระบบ (ห้ามลบ) */
    const max = s.emp.reduce((n, e) => Math.max(n, Number(e.id.replace(/\D/g, "")) || 0), 0);
    const id = `E${String(max + 1).padStart(2, "0")}`;
    added = id;
    const emp: Employee = {
      ...rest,
      id,
      status: "active",
      history: [
        {
          at: rest.startedAt,
          pos: rest.pos,
          salary,
          /* ต้นแบบบันทึก "เริ่มงาน" อย่างเดียวทุกประเภท — ประเภทดูได้จากตัวพนักงานอยู่แล้ว */
          note: "เริ่มงาน",
        },
      ],
    };
    return { ...s, emp: [...s.emp, emp] };
  });
  return added ? { ok: true, id: added } : { ok: false, message: "เพิ่มพนักงานไม่สำเร็จ" };
}

/*
 * บัญชีผู้ใช้ของพนักงาน — สร้าง รีเซ็ตรหัส ระงับ และคืนสิทธิ์ (หน้า /hr/accounts)
 *
 * ⚠️ ยังไม่มี backend จึงเก็บแค่ชื่อผู้ใช้กับสถานะไว้ข้างพนักงาน ไม่ได้เก็บรหัสผ่าน
 * รหัสชั่วคราวที่หน้าจอแสดงมีไว้ให้ฝ่ายบุคคลส่งต่อเท่านั้น ของจริงต้องสร้างที่ระบบยืนยันตัวตน
 */
function editEmp(id: string, fn: (e: Employee) => Employee) {
  store.update((s) => ({ ...s, emp: s.emp.map((e) => (e.id === id ? fn(e) : e)) }));
}


/*
 * บัญชีเข้าระบบอยู่ในระบบ auth ของ Supabase ซึ่งเขียนจากเบราว์เซอร์ตรง ๆ ไม่ได้
 * ต้องผ่านเส้นทางฝั่งเซิร์ฟเวอร์ (/api/accounts) ที่ถือกุญแจ service role
 * และตรวจเองว่าคนเรียกเป็นฝ่ายบุคคลจริง
 */
const ACC_REASON: Record<string, string> = {
  no_backend: "ยังไม่ได้ต่อฐานข้อมูล",
  not_hr: "จัดการบัญชีได้เฉพาะฝ่ายบุคคล",
  no_employee: "ไม่พบพนักงานคนนี้ในทะเบียน",
  no_account: "พนักงานคนนี้ยังไม่มีบัญชีเข้าระบบ",
  has_account: "พนักงานคนนี้มีบัญชีอยู่แล้ว",
  bad_username: "ชื่อผู้ใช้ไม่ถูกรูปแบบ",
  bad_roles: "ต้องมีบทบาท 1–2 บทบาท",
  weak_password: "รหัสชั่วคราวต้องยาวอย่างน้อย 8 ตัวอักษร",
  bad_json: "ส่งข้อมูลไม่ถูกต้อง",
};

async function callAccounts(
  method: "POST" | "PATCH" | "DELETE",
  body: Record<string, unknown>,
): Promise<EmpResult> {
  try {
    const res = await fetch("/api/accounts", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const out = (await res.json()) as { ok?: boolean; reason?: string };
    if (out.ok) return { ok: true };
    const reason = out.reason ?? "unknown";
    return { ok: false, message: ACC_REASON[reason] ?? reason };
  } catch {
    return { ok: false, message: "ติดต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง" };
  }
}

export async function createAccount(
  id: string,
  user: string,
  today: string,
  roles: Role[],
  tempPassword = "",
): Promise<EmpResult> {
  if (live) {
    const res = await callAccounts("POST", {
      employeeId: id,
      username: user,
      roles,
      tempPassword,
    });
    refreshEmployees();
    return res;
  }
  return createAccountLocal(id, user, today, roles);
}

function createAccountLocal(id: string, user: string, today: string, roles: Role[]): EmpResult {
  editEmp(id, (e) =>
    e.account
      ? e
      : { ...e, account: { user, roles, status: "active", mustChange: true, createdAt: today } },
  );
  /* คนที่เพิ่งได้บัญชี ต้องตั้งรหัสเองตอนเข้าระบบครั้งแรก */
  requirePasswordReset(id, true);
  return { ok: true };
}

/** ตั้งรหัสใหม่ให้พนักงาน — เปลี่ยนชื่อผู้ใช้ไปพร้อมกันได้ และบังคับตั้งรหัสเองตอนเข้าระบบ */
export async function resetAccount(
  id: string,
  user: string,
  roles: Role[],
  tempPassword = "",
): Promise<EmpResult> {
  if (live) {
    /* รหัสผ่านอยู่ในระบบ auth — เปลี่ยนได้ทางเดียวคือผ่านฝั่งเซิร์ฟเวอร์ */
    const pass = await fetch("/api/accounts/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ employeeId: id, tempPassword }),
    })
      .then((r) => r.json() as Promise<{ ok?: boolean; reason?: string }>)
      .catch(() => ({ ok: false, reason: "network" }));
    if (!pass.ok) {
      const reason = pass.reason ?? "unknown";
      return { ok: false, message: ACC_REASON[reason] ?? reason };
    }
    /* บทบาทเก็บคนละที่กับรหัสผ่าน ถ้าเปลี่ยนด้วยก็ส่งอีกคำขอ */
    const res = roles.length ? await callAccounts("PATCH", { employeeId: id, roles }) : { ok: true as const };
    refreshEmployees();
    return res;
  }
  editEmp(id, (e) =>
    e.account ? { ...e, account: { ...e.account, user, roles, mustChange: true } } : e,
  );
  requirePasswordReset(id, true);
  return { ok: true };
}

/**
 * ลบบัญชีผู้ใช้ของพนักงานคนนี้ (เจ้าของถาม 30 ก.ย. 2569)
 * ลบแค่ "บัญชี" ไม่ใช่ลบคน — พนักงานยังอยู่ในทะเบียน เวลาทำงานและเงินเดือนไม่หาย (BR-02)
 * ใช้ตอนสร้างบัญชีผิดคนหรือคนนั้นไม่ต้องใช้ระบบแล้ว · สร้างใหม่ได้เสมอ
 * คืนสิทธิ์ให้บทบาทที่เคยถูกระงับด้วย ไม่งั้นบัญชีใหม่ของบทบาทนั้นจะเข้าไม่ได้
 */
export async function deleteAccount(id: string): Promise<EmpResult> {
  if (live) {
    const res = await callAccounts("DELETE", { employeeId: id });
    if (res.ok) restoreAccount(id);
    refreshEmployees();
    return res;
  }
  restoreAccount(id);
  editEmp(id, (e) => {
    if (!e.account) return e;
    const next = { ...e };
    delete next.account;
    return next;
  });
  return { ok: true };
}

/**
 * ตั้งตำแหน่งที่คนนี้ทำอยู่ทั้งหมด (เจ้าของกำหนด 30 ก.ย. 2569 — "บทบาทคือตำแหน่งงาน")
 * ตำแหน่งหลักคงเดิมถ้ายังอยู่ในรายการที่เลือก เพราะเงินเดือนและประวัติผูกกับตำแหน่งหลัก
 * ไม่งั้นย้ายตำแหน่งหลักไปเป็นอันแรกที่เลือก · ที่เหลือเป็นตำแหน่งควบ
 */
export async function setEmpPositions(id: string, positions: PosKey[]): Promise<EmpResult> {
  if (!positions.length) return { ok: true };
  if (live) {
    const now = snapshot().emp.find((e) => e.id === id);
    const main = now && positions.includes(now.pos) ? now.pos : positions[0];
    const res = await saveEmployee(id, { pos: main, posMore: positions.filter((v) => v !== main) });
    refreshEmployees();
    return res.ok ? { ok: true } : { ok: false, message: empSay(res.reason) };
  }
  editEmp(id, (e) => {
    const main = positions.includes(e.pos) ? e.pos : positions[0];
    return { ...e, pos: main, posMore: positions.filter((v) => v !== main) };
  });
  return { ok: true };
}

/*
 * สิทธิ์วันลาเฉพาะคน (ผู้ใช้สั่ง 8 ต.ค. 2569) — ส่งเฉพาะประเภทที่ต่างจากค่ากลาง
 * ค่าว่างหรือเท่ากับค่ากลางให้ลบทิ้ง จะได้ไม่ต้องตามแก้ทุกคนเวลาค่ากลางเปลี่ยน
 */
export async function setEmpLeaveDays(
  id: string,
  days: Record<string, number>,
): Promise<EmpResult> {
  const clean: Record<string, number> = {};
  for (const [type, n] of Object.entries(days)) {
    if (Number.isFinite(n) && n >= 0) clean[type] = n;
  }
  if (live) {
    const res = await saveEmployee(id, { leaveDays: clean });
    refreshEmployees();
    return res.ok ? { ok: true } : { ok: false, message: empSay(res.reason) };
  }
  editEmp(id, (e) => ({ ...e, leaveDays: Object.keys(clean).length ? clean : undefined }));
  return { ok: true };
}

/** เปลี่ยนบทบาทที่บัญชีนี้เข้าใช้ได้ (คนควบสองตำแหน่งได้สองบทบาท) */
export async function setAccountRoles(id: string, roles: Role[]): Promise<EmpResult> {
  if (live) {
    const res = await callAccounts("PATCH", { employeeId: id, roles });
    refreshEmployees();
    return res;
  }
  editEmp(id, (e) => (e.account ? { ...e, account: { ...e.account, roles } } : e));
  return { ok: true };
}

export async function setAccountStatus(
  id: string,
  status: "active" | "suspended",
  at = "",
): Promise<EmpResult> {
  const emp = snapshot().emp.find((e) => e.id === id);
  if (live) {
    const res = await callAccounts("PATCH", { employeeId: id, status });
    refreshEmployees();
    return res;
  }
  editEmp(id, (e) => (e.account ? { ...e, account: { ...e.account, status } } : e));
  /* ระงับบัญชีต้องมีผลที่หน้าเข้าสู่ระบบด้วย — เก็บตามคน คนอื่นในบทบาทเดียวกันไม่โดนด้วย */
  if (status === "suspended") suspendAccount(id, `ฝ่ายบุคคลระงับบัญชีของ ${emp?.name ?? id}`, at);
  else restoreAccount(id);
  return { ok: true };
}

export type EmpProfile = Pick<
  Employee,
  "name" | "nick" | "sex" | "birth" | "edu" | "exp" | "phone" | "email" | "address" | "sos" | "boss" | "docs"
> & {
  /* ชื่อ-นามสกุลกรอกแยกช่อง ทั้งไทยและอังกฤษ (เจ้าของสั่ง 29 ก.ย. 2569)
     ภาษาอังกฤษใช้ตั้งชื่อผู้ใช้ตอนสร้างบัญชี */
  first?: string;
  last?: string;
  firstEn?: string;
  lastEn?: string;
  /* ตำแหน่งควบ — แก้พร้อมข้อมูลพนักงานได้เลย ไม่ต้องลงประวัติเงินเดือนเหมือนการปรับตำแหน่งหลัก */
  posMore?: PosKey[];
};

/** by = ชื่อผู้แก้ (ฝ่ายบุคคล) · ประทับเวลาไว้ที่ตัวพนักงานเป็น "แก้ไขล่าสุด" */
export async function updateEmpProfile(
  id: string,
  profile: EmpProfile,
  by: string,
): Promise<EmpResult> {
  if (live) {
    const res = await saveEmployee(id, profile as Partial<Employee>, by);
    refreshEmployees();
    return res.ok ? { ok: true } : { ok: false, message: empSay(res.reason) };
  }
  store.update((s) => ({
    ...s,
    emp: s.emp.map((e) => {
      if (e.id !== id) return e;
      const next = { ...e, ...profile, edited: { by, at: bkkStamp() } };
      /*
       * ฝ่ายบุคคลติ๊กควบตำแหน่งเพิ่ม → บัญชีของคนนั้นต้องได้เมนูของตำแหน่งใหม่ด้วย
       * (เจ้าของถาม 29 ก.ย. 2569 "ฝ่ายบุคคลปรับควบ 2 ตำแหน่งไม่ได้หรอ")
       * เติมบทบาทที่ยังขาด ไม่ถอดของที่ผู้ดูแลระบบตั้งเองไว้ และไม่เกินจำนวนที่ควบได้
       */
      if (!next.account) return next;
      const has = accountRoles(next.account);
      const add = rolesOfEmployee(next).filter((r) => !has.includes(r));
      if (!add.length) return next;
      return { ...next, account: { ...next.account, roles: [...has, ...add].slice(0, HR_MAX_ROLES) } };
    }),
  }));
  return { ok: true };
}

/**
 * วันสุดท้ายของรอบเงินเดือนล่าสุดที่ปิดแล้ว — ปรับตำแหน่ง/เงินเดือนหรือพ้นสภาพ
 * ให้มีผลก่อนหรือเท่าวันนี้ไม่ได้ ไม่งั้นตัวเลขของรอบที่ปิดไปแล้วจะเปลี่ยนเอง
 */
export function lockedUntil(s: HrState) {
  return s.payruns
    .filter((p) => p.closed)
    .map((p) => hrCycle(p.month).to)
    .sort()
    .pop();
}

/*
 * วันสุดท้ายของรอบ "เวลาทำงาน" ล่าสุดที่ปิดแล้ว — คนละอย่างกับ lockedUntil ที่ดูรอบเงินเดือน
 * (พบตอนไล่หาบั๊ก 12 ต.ค. 2569) ฝ่ายบุคคลปิดตารางเวลาก่อน แล้วค่อยคำนวณและปิดเงินเดือน
 * ช่วงคั่นกลางนั้นรอบเงินเดือนยังไม่ปิด lockedUntil จึงยังว่าง ถ้าผู้อนุมัติย้อนใบในช่วงนี้
 * ยอดที่ฝ่ายบุคคลปิดไปแล้วจะเปลี่ยนเงียบ ๆ ทั้งที่กติกาบอกว่าปิดแล้วต้องเปิดรอบก่อนถึงแก้ได้
 * ดูทั้งสองกลุ่ม รายเดือนและทดลองงานจ่ายรายวัน เพราะปิดแยกกัน
 */
export function timesheetLockedUntil(s: HrState) {
  return s.periods
    .filter((p) => p.closed || p.dayClosed)
    .map((p) => hrCycle(p.month).to)
    .sort()
    .pop();
}

/** ปรับตำแหน่งหรือเงินเดือน — ต่อแถวประวัติใหม่ ไม่แก้แถวเดิม ด้วยเหตุผลเดียวกับ changeEmpType */
export async function changePosition(
  id: string,
  at: string,
  pos: PosKey,
  salary: number,
  note: string,
): Promise<EmpResult> {
  if (live) {
    const lock = lockedUntil(snapshot());
    if (lock && at <= lock) {
      return { ok: false, message: `รอบเงินเดือนถึง ${lock} ปิดแล้ว ปรับย้อนหลังไม่ได้` };
    }
    const res = await addSalaryStep(id, { at, pos, salary, note });
    refreshEmployees();
    return res.ok ? { ok: true } : { ok: false, message: empSay(res.reason) };
  }
  store.update((s) => {
    const lock = lockedUntil(s);
    if (lock && at <= lock) return s;
    return {
      ...s,
      emp: s.emp.map((e) =>
        e.id !== id
          ? e
          : {
              ...e,
              pos,
              /* แทรกตามวันที่ ประวัติต้องเรียงเก่า→ใหม่เสมอ baseSalaryIn อาศัยลำดับนี้ */
              history: [...e.history, { at, pos, salary, note }].sort((a, b) =>
                a.at.localeCompare(b.at),
              ),
            },
      ),
    };
  });
  return { ok: true };
}

/** พ้นสภาพ / กลับมาปฏิบัติงาน — ว่างทั้งคู่คือกลับมาเป็นพนักงานปัจจุบัน */
export async function setEmpLeft(
  id: string,
  leftAt: string,
  leftWhy: string,
): Promise<EmpResult> {
  if (live) {
    const lock = lockedUntil(snapshot());
    if (leftAt && lock && leftAt <= lock) {
      return { ok: false, message: `รอบเงินเดือนถึง ${lock} ปิดแล้ว บันทึกย้อนหลังไม่ได้` };
    }
    const res = await saveEmployee(id, {
      status: leftAt ? "left" : "active",
      leftAt: leftAt || "",
      leftWhy: leftAt ? leftWhy : "",
    });
    refreshEmployees();
    if (!res.ok) return { ok: false, message: empSay(res.reason) };
    /* พ้นสภาพแล้วต้องเข้าระบบไม่ได้ — ระงับบัญชีเมื่อวันพ้นสภาพมาถึงแล้ว */
    const who = snapshot().emp.find((x) => x.id === id);
    if (leftAt && leftAt <= todayIso() && who?.account?.status === "active") {
      setAccountStatus(id, "suspended", bkkStamp());
    }
    return { ok: true };
  }
  store.update((s) => {
    const lock = lockedUntil(s);
    if (leftAt && lock && leftAt <= lock) return s;
    return {
      ...s,
      emp: s.emp.map((e) => {
        if (e.id !== id) return e;
        if (!leftAt) {
          const rest = { ...e, status: "active" as const };
          delete rest.leftAt;
          delete rest.leftWhy;
          return rest;
        }
        return { ...e, status: "left" as const, leftAt, leftWhy };
      }),
    };
  });
  /* พ้นสภาพแล้วต้องเข้าระบบไม่ได้ — ระงับบัญชีให้ทันทีเมื่อวันพ้นสภาพมาถึงแล้ว
     ลาออกล่วงหน้ายังใช้ระบบได้จนถึงวันนั้น · ยกเลิกการพ้นสภาพไม่คืนสิทธิ์เอง ให้ฝ่ายบุคคลตัดสินที่หน้าบัญชีผู้ใช้ */
  const e = store.get().emp.find((x) => x.id === id);
  if (leftAt && leftAt <= todayIso() && e?.status === "left" && e.account?.status === "active") {
    setAccountStatus(id, "suspended", bkkStamp());
  }
  return { ok: true };
}

// ─── เวลาทำงาน ────────────────────────────────────────────────────

function editTime(id: string, fn: (r: TimeRec) => TimeRec) {
  store.update((s) => {
    const cur = s.time[id] ?? { late: [], leave: [], ot: [], issues: [] };
    return { ...s, time: { ...s.time, [id]: fn(cur) } };
  });
}

/**
 * แก้จำนวนนาทีที่มาสาย
 *
 * เก็บค่าเดิมไว้ใน was ครั้งแรกที่แก้เท่านั้น แก้ซ้ำจะไม่ทับค่าเดิมทิ้ง
 * เพราะสิ่งที่ต้องตรวจย้อนได้คือ "เครื่องบันทึกมาเท่าไร" ไม่ใช่ค่าก่อนแก้รอบล่าสุด
 */
/**
 * แก้จำนวนนาทีที่มาสาย — ต้องมีเหตุผลเสมอ เพราะตัวเลขนี้กลายเป็นเงินที่หัก
 * เก็บค่าที่เครื่องบันทึกมาไว้ใน was ครั้งแรกที่แก้เท่านั้น
 */
export async function setLateMin(
  id: string,
  day: string,
  min: number,
  why: string,
  was?: number,
): Promise<HrSaveResult> {
  if (live) {
    const res = await saveTimeEdit(id, day, "late", min, was ?? null, why);
    if (!res.ok) return { ok: false, message: REVIEW_REASON[res.reason] ?? res.reason };
    refreshReviews();
    return { ok: true };
  }
  editTime(id, (r) => ({
    ...r,
    late: r.late.map((x) => (x.d === day ? { ...x, min, was: x.was ?? x.min } : x)),
  }));
  return { ok: true };
}

/** เติมเวลาเข้า/ออกที่พนักงานลืมกด — ฐานข้อมูลเป็นคนตรวจสิทธิ์และรอบที่ปิดแล้ว */
export async function fillMissingPunch(
  id: string,
  type: "in" | "out",
  day: string,
  time: string,
  why: string,
): Promise<HrSaveResult> {
  if (!live) return { ok: false, message: "ยังไม่ได้ต่อฐานข้อมูล" };
  const res = await fillPunch(id, type, day, time, why);
  if (!res.ok) return { ok: false, message: REVIEW_REASON[res.reason] ?? res.reason };
  /* การตอกบัตรที่เติมใหม่ต้องเข้ามาในหน้าจอด้วย ไม่ใช่เห็นแค่ตอนโหลดหน้าใหม่ */
  refreshRecords();
  refreshReviews();
  return { ok: true };
}

export async function setOtHours(
  id: string,
  day: string,
  hours: number,
  why = "ฝ่ายบุคคลปรับตามเวลาทำงานจริง",
  was?: number,
): Promise<HrSaveResult> {
  if (live) {
    const res = await saveTimeEdit(id, day, "ot", hours, was ?? null, why);
    if (!res.ok) return { ok: false, message: REVIEW_REASON[res.reason] ?? res.reason };
    refreshReviews();
    return { ok: true };
  }
  editTime(id, (r) => ({
    ...r,
    ot: r.ot.map((x) => (x.d === day ? { ...x, h: hours, was: x.was ?? x.h } : x)),
  }));
  return { ok: true };
}

/**
 * บันทึกเหตุผลของรายการที่ต้องตรวจ
 *
 * ระบุด้วยวันที่ ไม่ใช่ลำดับในอาเรย์ เพราะรายการที่แสดงถูกกรองตามรอบมาแล้ว
 * ลำดับที่เห็นบนจอกับลำดับจริงในข้อมูลจึงไม่ตรงกัน
 */
/**
 * สรุปผลการตรวจของวันที่มีปัญหา — "มาทำงานจริง" หรือ "ขาดงาน" พร้อมเหตุผล
 * ต่อฐานข้อมูลแล้วต้องขึ้นไปให้สำเร็จก่อน ไม่งั้นฝ่ายบุคคลอีกคนจะไม่เห็นว่าตรวจไปแล้ว
 * และยอดหักขาดงานของสองเครื่องจะไม่ตรงกัน
 */
export async function noteIssue(
  id: string,
  day: string,
  note: string,
  absent = false,
): Promise<HrSaveResult> {
  const before = store.get();
  editTime(id, (r) => ({
    ...r,
    issues: r.issues.map((x) => (x.d === day ? { ...x, note, absent } : x)),
  }));
  if (!live) return { ok: true };

  const res = await saveReview(id, day, note, absent);
  if (!res.ok) {
    store.set(before);
    tell();
    return { ok: false, message: REVIEW_REASON[res.reason] ?? res.reason };
  }
  refreshReviews();
  return { ok: true };
}

// ─── ใบลาของนักศึกษาฝึกงาน ───────────────────────────────────────

/** วันทำงานระหว่างสองวัน (รวมหัวท้าย) — วันหยุดไม่นับเป็นวันลา */
function workdaysBetween(from: string, to: string) {
  const out: string[] = [];
  for (let d = parseIsoDate(from); toIsoDate(d) <= to; d.setDate(d.getDate() + 1)) {
    const iso = toIsoDate(d);
    if (isWorkday(d, iso)) out.push(iso);
  }
  return out;
}

/**
 * ฝ่ายบุคคลอนุมัติหรือไม่อนุมัติใบลาของนักศึกษาฝึกงาน
 * อนุมัติแล้ววันลาลงเวลาทำงานของคนนั้นทันที สรุปเวลาทำงานจะเห็นเป็น "ลา" ไม่ใช่ขาดงาน
 */
export function decideInternLeave(id: string, ok: boolean, now: string, by = HR_ME) {
  store.update((s) => {
    const r = s.internLeave.find((x) => x.id === id && x.status === "pending");
    if (!r) return s;
    const internLeave = s.internLeave.map((x) =>
      x.id === id
        ? { ...x, status: ok ? ("approved" as const) : ("rejected" as const), by, decidedAt: now }
        : x,
    );
    if (!ok) return { ...s, internLeave };
    const cur = s.time[r.emp] ?? { late: [], leave: [], ot: [], issues: [] };
    const add = workdaysBetween(r.from, r.to)
      .filter((d) => !cur.leave.some((l) => l.d === d))
      .map((d) => ({ d, type: r.lt, span: "full" as const }));
    return {
      ...s,
      internLeave,
      time: { ...s.time, [r.emp]: { ...cur, leave: [...cur.leave, ...add] } },
    };
  });
}

// ─── CEO อนุมัติยอดเงินเดือน ─────────────────────────────────────

/** ฝ่ายบุคคลส่งยอดของกลุ่มหนึ่งให้ CEO อนุมัติ — ส่งซ้ำได้หลังถูกตีกลับ */
export async function sendPayrollToCeo(
  month: string,
  group: PayGroup,
  snap: { people: number; net: number; ss: number },
  now: string,
  by = HR_ME,
): Promise<EmpResult> {
  if (live) {
    const res = await sendPayroll(month, group, snap);
    refreshPayruns();
    return res.ok ? { ok: true } : { ok: false, message: paySay(res.reason) };
  }
  store.update((s) => ({
    ...s,
    payApprove: {
      ...s.payApprove,
      [payApproveKey(month, group)]: { status: "waiting", ...snap, sentBy: by, sentAt: now },
    },
  }));
  return { ok: true };
}

/**
 * CEO อนุมัติหรือตีกลับยอดที่ส่งมา — ตีกลับต้องมีเหตุผล ฝ่ายบุคคลจะเห็นบนป้ายสถานะ
 *
 * snap = ยอดที่ CEO เห็นบนจอตอนกด (อ่านจากผลคำนวณของรอบ ไม่ใช่ยอดที่เก็บไว้เอง)
 * บันทึกทับไว้ด้วย เพราะสิ่งที่อนุมัติคือเลขที่เห็น ถ้าเลขขยับทีหลังต้องรู้ได้ว่าขยับจากอะไร
 */
export async function decidePayroll(
  month: string,
  group: PayGroup,
  ok: boolean,
  reason: string,
  now: string,
  by = "CEO",
  snap?: { people: number; net: number; ss: number },
): Promise<EmpResult> {
  if (live) {
    const res = await decidePayrollRemote(month, group, ok, reason);
    refreshPayruns();
    return res.ok ? { ok: true } : { ok: false, message: paySay(res.reason) };
  }
  store.update((s) => {
    const key = payApproveKey(month, group);
    const cur = s.payApprove[key];
    if (!cur || cur.status !== "waiting") return s;
    return {
      ...s,
      payApprove: {
        ...s.payApprove,
        [key]: {
          ...cur,
          ...(ok && snap ? snap : {}),
          status: ok ? "approved" : "rejected",
          by,
          at: now,
          reason: ok ? "" : reason,
        },
      },
    };
  });
  return { ok: true };
}

/**
 * ยกเลิกการอนุมัติเอง เพราะยอดที่คิดได้ไม่ใช่ยอดที่ส่งไปแล้ว (ผู้ใช้กำหนด 23 ก.ย. 2569)
 *
 * CEO อนุมัติเลขหนึ่ง แล้วจ่ายอีกเลขหนึ่งไม่ได้ ตัวเลขขยับเมื่อไรการอนุมัติเดิมเป็นโมฆะทันที
 * กลับไปเป็นร่างพร้อมเหตุผล ไม่ใช่ "ตีกลับ" เพราะ CEO ไม่ได้เป็นคนสั่ง — ฝ่ายบุคคลต้องส่งใหม่
 * ยอดที่บันทึกไว้ล้างทิ้งด้วย ไม่งั้นรอบต่อไปจะเทียบกับเลขเก่าที่ไม่มีความหมายแล้ว
 */
export function voidPayApproval(month: string, group: PayGroup, why: string) {
  store.update((s) => {
    const key = payApproveKey(month, group);
    const cur = s.payApprove[key];
    if (!cur || (cur.status !== "waiting" && cur.status !== "approved")) return s;
    return { ...s, payApprove: { ...s.payApprove, [key]: { status: "draft", reason: why } } };
  });
}

// ─── ปิดรอบและเปิดรอบใหม่ ─────────────────────────────────────────

const BLANK_PERIOD: Omit<Period, "month"> = {
  closed: false,
  closedAt: "",
  closedBy: "",
  reopened: [],
  dayClosed: false,
  dayClosedAt: "",
  dayClosedBy: "",
  dayReopened: [],
  sum: null,
  daySum: null,
};

function editPeriod(list: Period[], month: string, fn: (p: Period) => Period) {
  const rows = list.some((p) => p.month === month)
    ? list
    : [...list, { month, ...BLANK_PERIOD }];
  return rows.map((p) => (p.month === month ? fn(p) : p));
}

/* ปิดรอบของกลุ่มเดียว อีกกลุ่มไม่ถูกแตะ — สองกลุ่มตรวจเสร็จคนละเวลากันได้ */
function closeIn(
  list: Period[],
  month: string,
  today: string,
  by: string,
  group: PayGroup,
  sum: CycleSum | null,
) {
  return editPeriod(list, month, (p) =>
    group === "day"
      ? { ...p, dayClosed: true, dayClosedAt: today, dayClosedBy: by, daySum: sum }
      : { ...p, closed: true, closedAt: today, closedBy: by, sum },
  );
}

function reopenIn(
  list: Period[],
  month: string,
  today: string,
  by: string,
  why: string,
  group: PayGroup,
) {
  return editPeriod(list, month, (p) =>
    group === "day"
      ? {
          ...p,
          dayClosed: false,
          dayClosedAt: "",
          dayClosedBy: "",
          dayReopened: [...p.dayReopened, { at: today, by, why }],
        }
      : {
          ...p,
          closed: false,
          closedAt: "",
          closedBy: "",
          reopened: [...p.reopened, { at: today, by, why }],
        },
  );
}

/** ต่อฐานข้อมูลแล้วการปิดหรือเปิดรอบพลาดได้จริง หน้าจอต้องได้รู้ว่าพลาดเพราะอะไร */
export type HrSaveResult = { ok: true } | { ok: false; message: string };

export type PeriodResult = { ok: true } | { ok: false; message: string };

/** เหตุที่ฐานข้อมูลไม่รับงานของสายเงินเดือน */
function paySay(reason: string) {
  return PAYRUN_REASON[reason] ?? "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง";
}

/** ผลของการเขียนทะเบียนพนักงาน — เหมือนกันทุกปุ่มในหน้าฝ่ายบุคคล */
export type EmpResult = { ok: true } | { ok: false; message: string };

function empSay(reason: string) {
  return EMP_REASON[reason] ?? "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง";
}

function say(reason: string) {
  return PERIOD_REASON[reason] ?? "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง";
}

/**
 * ปิดรอบเวลาทำงานของกลุ่มหนึ่ง — หน้าจอกันไว้แล้วว่าต้องไม่มีรายการค้างตรวจ
 * ฐานข้อมูลกันซ้ำว่าต้องเป็นฝ่ายบุคคล และรอบที่ปิดแล้วปิดอีกไม่ได้
 */
export async function closePeriod(
  month: string,
  today: string,
  group: PayGroup,
  by = HR_ME,
): Promise<PeriodResult> {
  if (live) {
    const res = await closePeriodRemote(month, group);
    refreshPeriods();
    return res.ok ? { ok: true } : { ok: false, message: say(res.reason) };
  }
  store.update((s) => ({ ...s, periods: closeIn(s.periods, month, today, by, group, null) }));
  return { ok: true };
}

/** เปิดรอบเวลาทำงานใหม่ — ต้องมีเหตุผลเสมอ ระบบเก็บเป็นประวัติ */
export async function reopenPeriod(
  month: string,
  today: string,
  why: string,
  group: PayGroup,
  by = HR_ME,
): Promise<PeriodResult> {
  if (live) {
    const res = await reopenPeriodRemote(month, group, why);
    refreshPeriods();
    return res.ok ? { ok: true } : { ok: false, message: say(res.reason) };
  }
  store.update((s) => ({ ...s, periods: reopenIn(s.periods, month, today, by, why, group) }));
  return { ok: true };
}

/**
 * ปิดรอบเงินเดือนของกลุ่มหนึ่ง พร้อมเก็บยอดที่ปิดไว้ในตัวรอบ
 * เก็บเป็นตัวเลข ณ วันที่ปิด ไม่คำนวณใหม่ตอนเปิดดู เพราะเงินเดือนของคนเปลี่ยนได้ภายหลัง
 */
export async function closePayrun(
  month: string,
  today: string,
  group: PayGroup,
  sum: CycleSum,
  by = HR_ME,
  /* บรรทัดรายคนพร้อมรหัสจริงในฐานข้อมูล — ฐานข้อมูลเอาไปตรวจกับข้อมูลดิบก่อนยอมให้ปิด */
  lines?: { employee_id: string; line: unknown; net: number }[],
): Promise<EmpResult> {
  if (live) {
    const res = await closePayrunRemote(month, group, sum, lines ?? []);
    refreshPayruns();
    if (res.ok) return { ok: true };
    const extra = res.reason === "mismatch" ? " — ตรวจตัวเลขเวลาทำงานอีกครั้ง" : "";
    return { ok: false, message: paySay(res.reason) + extra };
  }
  store.update((s) => {
    /*
     * ห้ามข้ามขั้น — ปิดรอบเงินเดือนได้ก็ต่อเมื่อปิดรอบเวลาทำงานของกลุ่มนั้นแล้ว
     * (ลำดับที่เจ้าของกำหนด: ปิดรอบเวลา → CEO อนุมัติ → ปิดเงินเดือน → ออกสลิป)
     * กันที่ชั้นสโตร์ ไม่ใช่เชื่อว่าหน้าจอซ่อนปุ่มให้แล้ว — เงินเดือนที่ปิดจากเวลาที่ยังแก้ได้
     * คือยอดที่เปลี่ยนได้ทีหลังทั้งที่สลิปออกไปแล้ว
     */
    const period = s.periods.find((x) => x.month === month);
    if (!closedIn(period, group)) return s;
    return { ...s, payruns: closeIn(s.payruns, month, today, by, group, sum) };
  });
  return { ok: true };
}

export function reopenPayrun(
  month: string,
  today: string,
  why: string,
  group: PayGroup,
  by = HR_ME,
) {
  store.update((s) => ({ ...s, payruns: reopenIn(s.payruns, month, today, by, why, group) }));
}

/**
 * เปิดรอบเงินเดือนกลับ (ผู้ใช้กำหนด 23 ก.ย. 2569)
 *
 * รอบที่ปิดและ CEO อนุมัติแล้วแก้เงียบ ๆ ไม่ได้ (HR-BR-03) ถ้าจำเป็นต้องแก้จริง
 * ต้องเป็นการเปิดรอบกลับที่ทำสามอย่างพร้อมกันในครั้งเดียว ไม่ใช่ทยอยทำทีละอย่าง
 *   1. เปิดรอบกลับพร้อมเหตุผล ใคร และเมื่อไร (เก็บใน reopened ของรอบ)
 *   2. ยกเลิกการอนุมัติของ CEO — ยอดต้องถูกส่งให้อนุมัติใหม่
 *   3. เพิกถอนสลิปที่เผยแพร่ไปแล้ว และล้างวันที่สร้าง เพื่อบังคับให้สร้างใหม่จากตัวเลขชุดใหม่
 * ทำในการอัปเดตเดียว ไม่งั้นจะมีจังหวะที่รอบเปิดแล้วแต่สลิปเก่ายังเผยแพร่อยู่
 *
 * ยอดที่ปิดไว้ (sum) ไม่ลบทิ้ง — ประวัติรอบต้องยังอ่านได้ว่าตอนปิดครั้งก่อนปิดไปเท่าไร
 */
export async function reopenPayrunWithReason(
  month: string,
  today: string,
  why: string,
  group: PayGroup,
  by = HR_ME,
): Promise<EmpResult> {
  const reason = why.trim();
  if (!reason) return { ok: false, message: "ต้องกรอกเหตุผล" };
  if (live) {
    const res = await reopenPayrunRemote(month, group, reason);
    refreshPayruns();
    return res.ok ? { ok: true } : { ok: false, message: paySay(res.reason) };
  }
  const day = group === "day";
  store.update((s) => {
    const run = s.payruns.find((p) => p.month === month);
    if (!run || !(day ? run.dayClosed : run.closed)) return s;
    const key = payApproveKey(month, group);
    const ap = s.payApprove[key];
    return {
      ...s,
      payruns: reopenIn(s.payruns, month, today, by, reason, group),
      /* กลับไปเป็นร่าง ไม่ใช่ "ตีกลับ" เพราะ CEO ไม่ได้เป็นคนสั่ง — เก็บเหตุผลไว้ให้เห็นบนป้ายสถานะ */
      payApprove: ap
        ? { ...s.payApprove, [key]: { status: "draft" as const, reason: `เปิดรอบกลับ · ${reason}` } }
        : s.payApprove,
      slips: s.slips.map((sp) =>
        sp.month !== month
          ? sp
          : day
            ? {
                ...sp,
                dayMadeAt: "",
                dayPublished: false,
                dayPublishedAt: "",
                dayBy: "",
                dayUnpublished: sp.dayPublished
                  ? [...sp.dayUnpublished, { at: today, by, why: `เปิดรอบกลับ · ${reason}` }]
                  : sp.dayUnpublished,
              }
            : {
                ...sp,
                madeAt: "",
                published: false,
                publishedAt: "",
                by: "",
                unpublished: sp.published
                  ? [...sp.unpublished, { at: today, by, why: `เปิดรอบกลับ · ${reason}` }]
                  : sp.unpublished,
              },
      ),
    };
  });
  return { ok: true };
}

// ─── ค่าที่ไม่มีสูตร ──────────────────────────────────────────────

/** บันทึก Incentive ค่าตำแหน่ง และรายการปรับปรุงของคนหนึ่งในรอบหนึ่ง */
export async function saveExtra(month: string, id: string, extra: Extra): Promise<HrSaveResult> {
  const before = store.get();
  store.update((s) => ({
    ...s,
    extras: { ...s.extras, [month]: { ...(s.extras[month] ?? {}), [id]: extra } },
  }));
  if (!live) return { ok: true };

  /* เงินเพิ่มและรายการปรับปรุงเป็นตัวตั้งของเงินที่จ่ายจริง เก็บไว้ในเครื่องเดียวไม่ได้ */
  const res = await saveExtraRemote(month, id, extra);
  if (!res.ok) {
    store.set(before);
    tell();
    return { ok: false, message: REVIEW_REASON[res.reason] ?? res.reason };
  }
  refreshExtras(month);
  return { ok: true };
}

// ─── สลิปเงินเดือน ────────────────────────────────────────────────

function editSlip(month: string, fn: (sp: Slip) => Slip) {
  store.update((s) => {
    const has = s.slips.some((x) => x.month === month);
    const rows = has
      ? s.slips
      : [
          ...s.slips,
          {
            month,
            published: false,
            madeAt: "",
            publishedAt: "",
            by: "",
            dayMadeAt: "",
            dayPublished: false,
            dayPublishedAt: "",
            dayBy: "",
            dayUnpublished: [],
            views: {},
            downloads: {},
            unpublished: [],
          },
        ];
    return { ...s, slips: rows.map((x) => (x.month === month ? fn(x) : x)) };
  });
}

/** สร้างสลิปของกลุ่มหนึ่ง — ทำได้เมื่อรอบเงินเดือนของกลุ่มนั้นปิดแล้ว (กันไว้ที่หน้าจอ) */
export function makeSlips(month: string, today: string, group: PayGroup) {
  editSlip(month, (sp) =>
    group === "day" ? { ...sp, dayMadeAt: today } : { ...sp, madeAt: today },
  );
}

export async function publishSlips(
  month: string,
  today: string,
  group: PayGroup,
  by = HR_ME,
): Promise<EmpResult> {
  if (live) {
    const res = await publishSlipsRemote(month, group);
    refreshPayruns();
    return res.ok ? { ok: true } : { ok: false, message: paySay(res.reason) };
  }
  /* พนักงานต้องรู้ทันทีที่เปิดให้ดู ไม่ต้องรอ HR เดินไปบอกทีละคน */
  editSlip(month, (sp) =>
    group === "day"
      ? { ...sp, dayPublished: true, dayPublishedAt: today, dayBy: by }
      : { ...sp, published: true, publishedAt: today, by },
  );
  return { ok: true };
}

/** ยกเลิกการเผยแพร่ — ต้องมีเหตุผล และเก็บเป็นประวัติไว้ทุกครั้ง */
export async function unpublishSlips(
  month: string,
  today: string,
  why: string,
  group: PayGroup,
  by = HR_ME,
): Promise<EmpResult> {
  if (live) {
    const res = await unpublishSlipsRemote(month, group, why.trim());
    refreshPayruns();
    return res.ok ? { ok: true } : { ok: false, message: paySay(res.reason) };
  }
  editSlip(month, (sp) =>
    group === "day"
      ? {
          ...sp,
          dayPublished: false,
          dayPublishedAt: "",
          dayBy: "",
          dayUnpublished: [...sp.dayUnpublished, { at: today, by, why }],
        }
      : {
          ...sp,
          published: false,
          publishedAt: "",
          by: "",
          unpublished: [...sp.unpublished, { at: today, by, why }],
        },
  );
  return { ok: true };
}

/**
 * นับครั้งที่เปิดดูและดาวน์โหลดสลิป
 *
 * นับเฉพาะรอบที่เผยแพร่แล้ว เพราะก่อนเผยแพร่คนที่เปิดคือ HR เองที่มาตรวจงาน
 * ไม่ใช่พนักงานเจ้าของสลิป การนับรวมกันจะทำให้ประวัติการเข้าถึงอ่านไม่ได้
 */
export function countView(month: string, id: string) {
  editSlip(month, (sp) =>
    sp.published ? { ...sp, views: { ...sp.views, [id]: (sp.views[id] ?? 0) + 1 } } : sp,
  );
}

export function countDownload(month: string, id: string) {
  editSlip(month, (sp) =>
    sp.published
      ? { ...sp, downloads: { ...sp.downloads, [id]: (sp.downloads[id] ?? 0) + 1 } }
      : sp,
  );
}
